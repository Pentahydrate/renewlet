package main

// hooks.go 负责 PocketBase record 写入前的运行时规范化与校验。
//
// 架构位置：
//   - HTTP route 负责请求体 schema；PocketBase SDK、Admin UI、迁移脚本等写入会经过这里。
//   - 这里是数据库 JSON 字段进入持久层前的最后防线。
//
// 校验流转：
//   OnRecordValidate -> collection switch -> normalize/validate -> record.Set(规范化结果) -> e.Next()
//
// 注意： 新增 collection JSON 字段时要在这里接入同一套验证规则，否则绕过 HTTP API 的写入会产生脏数据。
import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const maxImageBytes = 2 * 1024 * 1024

var (
	// 正则只做形态门禁；真实日期/时间仍交给 time.Parse/isValidLocalTime 防止 2026-99-99 之类伪值。
	currencyCodeRe = regexp.MustCompile(`^[A-Z]{3}$`)
	dateOnlyRe     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	localTimeRe    = regexp.MustCompile(`^\d{2}:\d{2}$`)
	// 私有资产路径只允许 record id 字符集，避免把任意 /api 路径伪装成 logo 引用。
	privateAssetPathRe  = regexp.MustCompile(`^/api/app/assets/[A-Za-z0-9_-]+$`)
	calendarFeedTokenRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
)

type customConfigLabels struct {
	ZhCN string `json:"zh-CN"`
	EnUS string `json:"en-US"`
}

type customConfigItem struct {
	ID      string             `json:"id"`
	Value   string             `json:"value"`
	Labels  customConfigLabels `json:"labels"`
	Color   string             `json:"color,omitempty"`
	Icon    string             `json:"icon,omitempty"`
	Enabled *bool              `json:"enabled,omitempty"`
}

type customConfigPayload struct {
	Categories     []customConfigItem `json:"categories"`
	Statuses       []customConfigItem `json:"statuses"`
	PaymentMethods []customConfigItem `json:"paymentMethods"`
	Currencies     []customConfigItem `json:"currencies"`
}

// registerRecordHooks 注册所有 collection 的写入前规范化逻辑。
// 为什么放在 RecordValidate：同一规则可以覆盖自定义 API、PocketBase SDK 和管理后台写入。
func registerRecordHooks(app core.App) {
	app.OnRecordValidate().BindFunc(func(e *core.RecordEvent) error {
		switch e.Record.Collection().Name {
		case "subscriptions":
			if err := normalizeSubscriptionRecord(e.Record); err != nil {
				return err
			}
		case "settings":
			if err := normalizeSettingsRecord(e.Record); err != nil {
				return err
			}
		case "custom_configs":
			if err := normalizeCustomConfigRecord(e.Record); err != nil {
				return err
			}
		case "assets":
			if err := normalizeAssetRecord(e.Record); err != nil {
				return err
			}
		case "notification_jobs":
			if err := normalizeNotificationJobRecord(e.Record); err != nil {
				return err
			}
		case "calendar_feeds":
			if err := normalizeCalendarFeedRecord(app, e.Record); err != nil {
				return err
			}
		}
		return e.Next()
	})
}

// normalizeSubscriptionRecord 校验并规范化订阅记录。
// 注意： billingCycle/customDays 的关系必须与前端 discriminated union 保持一致。
func normalizeSubscriptionRecord(record *core.Record) error {
	name := strings.TrimSpace(record.GetString("name"))
	if name == "" {
		return errors.New("SUBSCRIPTION_NAME_REQUIRED")
	}
	if len([]rune(name)) > 120 {
		return errors.New("SUBSCRIPTION_NAME_TOO_LONG")
	}
	record.Set("name", name)

	currency := strings.ToUpper(strings.TrimSpace(record.GetString("currency")))
	if !currencyCodeRe.MatchString(currency) {
		return errors.New("CURRENCY_CODE_INVALID")
	}
	record.Set("currency", currency)

	price := record.GetFloat("price")
	if price < 0 {
		return errors.New("SUBSCRIPTION_PRICE_NEGATIVE")
	}
	if price > maxSubscriptionPrice {
		return errors.New("SUBSCRIPTION_PRICE_TOO_HIGH")
	}

	billingCycle := record.GetString("billingCycle")
	customDays := record.GetInt("customDays")
	if billingCycle == "custom" {
		if customDays <= 0 {
			return errors.New("CUSTOM_DAYS_REQUIRED")
		}
	} else if customDays < 0 {
		return errors.New("CUSTOM_DAYS_NEGATIVE")
	} else if customDays > 0 {
		// 非 custom 周期清零 customDays，避免历史值影响前端统计和通知计算。
		record.Set("customDays", 0)
	}
	if billingCycle == "one-time" {
		// one-time 是买断/终身授权，不应参与自动续费日期推算；API 和 Admin UI 写入都在持久层兜底关闭。
		record.Set("autoCalculateNextBillingDate", false)
	}

	startDate := strings.TrimSpace(record.GetString("startDate"))
	if err := requireDateOnly(startDate, "START_DATE"); err != nil {
		return err
	}
	record.Set("startDate", startDate)
	nextBillingDate := strings.TrimSpace(record.GetString("nextBillingDate"))
	if err := requireDateOnly(nextBillingDate, "NEXT_BILLING_DATE"); err != nil {
		return err
	}
	// 两端都已通过 requireDateOnly，固定宽度 YYYY-MM-DD 的字典序等同于日历顺序；
	// 这里避免再次 Parse，保存边界仍能用 O(1) 字符串比较守住日期不变量。
	if nextBillingDate < startDate {
		return errors.New("NEXT_BILLING_DATE_BEFORE_START_DATE")
	}
	record.Set("nextBillingDate", nextBillingDate)
	if trialEndDate := strings.TrimSpace(record.GetString("trialEndDate")); trialEndDate != "" {
		if err := requireDateOnly(trialEndDate, "TRIAL_END_DATE"); err != nil {
			return err
		}
		record.Set("trialEndDate", trialEndDate)
	}

	logo := strings.TrimSpace(record.GetString("logo"))
	if err := validateOptionalLogoReference(logo); err != nil {
		return err
	}
	record.Set("logo", logo)
	if err := validateOptionalHTTPURL(record.GetString("website"), "WEBSITE_URL"); err != nil {
		return err
	}

	tags, err := normalizeTags(record.Get("tags"))
	if err != nil {
		return err
	}
	record.Set("tags", tags)

	if record.Get("extra") == nil || strings.TrimSpace(record.GetString("extra")) == "" {
		// 统一空 JSON 为 `{}`，避免前端 schema 在 null/空字符串之间做额外兼容。
		record.Set("extra", emptyJSONPayload{})
	}

	reminderDays := record.GetInt("reminderDays")
	if reminderDays < inheritReminderDays || reminderDays > maxReminderDays {
		return errors.New("REMINDER_DAYS_OUT_OF_RANGE")
	}

	repeatInterval := strings.TrimSpace(record.GetString("repeatReminderInterval"))
	if repeatInterval == "" {
		repeatInterval = defaultRepeatReminderInterval
	}
	if !isValidRepeatReminderInterval(repeatInterval) {
		return errors.New("REPEAT_REMINDER_INTERVAL_INVALID")
	}
	record.Set("repeatReminderInterval", repeatInterval)

	repeatWindow := strings.TrimSpace(record.GetString("repeatReminderWindow"))
	if repeatWindow == "" {
		repeatWindow = defaultRepeatReminderWindow
	}
	if !isValidRepeatReminderWindow(repeatWindow) {
		return errors.New("REPEAT_REMINDER_WINDOW_INVALID")
	}
	record.Set("repeatReminderWindow", repeatWindow)

	return nil
}

// normalizeSettingsRecord 校验 settings JSON 并写回规范化后的强类型结构。
func normalizeSettingsRecord(record *core.Record) error {
	settings, err := settingsFromValue(record.Get("settings"))
	if err != nil {
		return fmt.Errorf("SETTINGS_JSON_INVALID: %w", err)
	}
	record.Set("settings", settings)
	return nil
}

// normalizeCustomConfigRecord 校验用户自定义配置 JSON。
// 注意： 前端依赖这些配置驱动下拉选项，脏值会进一步污染 subscriptions.category/paymentMethod。
func normalizeCustomConfigRecord(record *core.Record) error {
	config, err := customConfigFromValue(record.Get("config"))
	if err != nil {
		return fmt.Errorf("CUSTOM_CONFIG_JSON_INVALID: %w", err)
	}
	if err := normalizeCustomConfigPayload(&config); err != nil {
		return err
	}
	record.Set("config", config)
	return nil
}

// normalizeAssetRecord 校验上传资产记录。
// 为什么读取 MIME：文件扩展名和 Content-Type 都可伪造，必须按文件头重新判断。
func normalizeAssetRecord(record *core.Record) error {
	kind := record.GetString("kind")
	if kind != "logo" && kind != "icon" {
		return errors.New("ASSET_KIND_INVALID")
	}
	files := record.GetUnsavedFiles("file")
	if len(files) == 0 {
		return nil
	}
	if len(files) > 1 {
		return errors.New("ASSET_FILE_TOO_MANY")
	}
	file := files[0]
	if file.Size <= 0 || file.Size > maxImageBytes {
		return errors.New("ASSET_FILE_SIZE_INVALID")
	}
	mimeType, err := detectUploadMimeType(file.Reader)
	if err != nil {
		return err
	}
	if !isAllowedImageMime(mimeType) {
		return errors.New("ASSET_FILE_TYPE_INVALID")
	}
	record.Set("mimeType", mimeType)
	record.Set("sizeBytes", file.Size)
	record.Set("originalName", strings.TrimSpace(file.OriginalName))
	return nil
}

// normalizeNotificationJobRecord 校验通知任务记录和 result payload。
// 注意： notification history 前端直接解析 result union；这里不能允许任意 JSON 混入。
func normalizeNotificationJobRecord(record *core.Record) error {
	if err := requireDateOnly(record.GetString("scheduledLocalDate"), "NOTIFICATION_LOCAL_DATE"); err != nil {
		return err
	}
	if !localTimeRe.MatchString(record.GetString("scheduledLocalTime")) || !isValidLocalTime(record.GetString("scheduledLocalTime")) {
		return errors.New("NOTIFICATION_LOCAL_TIME_INVALID")
	}
	if _, err := time.LoadLocation(record.GetString("timeZone")); err != nil {
		return errors.New("NOTIFICATION_TIMEZONE_INVALID")
	}
	if _, err := time.Parse(time.RFC3339, record.GetString("scheduledInstantUtc")); err != nil {
		return errors.New("NOTIFICATION_UTC_TIME_INVALID")
	}
	if record.GetInt("attempts") < 0 {
		return errors.New("NOTIFICATION_ATTEMPTS_NEGATIVE")
	}
	resultData, err := jsonBytesFromValue(record.Get("result"))
	if err != nil {
		return fmt.Errorf("NOTIFICATION_RESULT_INVALID: %w", err)
	}
	resultText := strings.TrimSpace(string(resultData))
	if resultText == "" || resultText == "null" || resultText == "{}" {
		record.Set("result", emptyJSONPayload{})
	} else {
		var result notificationJobResult
		if err := decodeStrictJSONBytesInto(resultData, &result, localeZhCN, false); err != nil {
			return fmt.Errorf("NOTIFICATION_RESULT_INVALID: %w", err)
		}
		if result.Source != "cron" {
			return errors.New("NOTIFICATION_RESULT_SOURCE_INVALID")
		}
		record.Set("result", result)
	}
	return nil
}

// normalizeCalendarFeedRecord 保护日历 feed 的可恢复 URL 和 scoped owner 契约。
// 系统日历只能靠 URL 拉取 ICS；token 可展示给本人复制，但必须始终绑定到当前用户/订阅。
func normalizeCalendarFeedRecord(app core.App, record *core.Record) error {
	token := strings.TrimSpace(record.GetString("token"))
	if !calendarFeedTokenRe.MatchString(token) {
		return errors.New("CALENDAR_FEED_TOKEN_INVALID")
	}
	record.Set("token", token)

	scope := strings.TrimSpace(record.GetString("scope"))
	switch scope {
	case "all":
		record.Set("subscriptionId", "")
	case "subscription":
		subscriptionID := strings.TrimSpace(record.GetString("subscriptionId"))
		if subscriptionID == "" {
			return errors.New("CALENDAR_FEED_SUBSCRIPTION_REQUIRED")
		}
		userID := strings.TrimSpace(record.GetString("user"))
		if userID == "" {
			return errors.New("CALENDAR_FEED_USER_REQUIRED")
		}
		if _, err := app.FindFirstRecordByFilter("subscriptions", "id = {:id} && user = {:user}", dbx.Params{"id": subscriptionID, "user": userID}); err != nil {
			return errors.New("CALENDAR_FEED_SUBSCRIPTION_OWNER_INVALID")
		}
		record.Set("subscriptionId", subscriptionID)
	default:
		return errors.New("CALENDAR_FEED_SCOPE_INVALID")
	}
	return nil
}

// requireDateOnly 校验 YYYY-MM-DD 日期，不允许带时间或时区。
// 这是订阅扣费日和通知本地日期的共同边界，避免浏览器/服务器时区转换导致日期漂移。
func requireDateOnly(value string, label string) error {
	value = strings.TrimSpace(value)
	if !dateOnlyRe.MatchString(value) {
		return fmt.Errorf("%s_DATE_FORMAT", label)
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return fmt.Errorf("%s_DATE_INVALID", label)
	}
	return nil
}

// validateOptionalLogoReference 校验订阅 Logo 引用。
// Logo 外链只由浏览器展示，服务端不抓取用户 URL；userinfo 会污染审计日志且不应进入持久层。
func validateOptionalLogoReference(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if len([]rune(value)) > maxLogoReferenceLength {
		return errors.New("LOGO_URL_TOO_LONG")
	}
	if privateAssetPathRe.MatchString(value) {
		return nil
	}
	return validateOptionalLogoHTTPURL(value)
}

// validateOptionalHTTPURL 校验可选 HTTP(S) URL 字段。
func validateOptionalHTTPURL(value string, label string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s_INVALID", label)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s_SCHEME_INVALID", label)
	}
	return nil
}

func validateOptionalLogoHTTPURL(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("LOGO_URL_INVALID")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("LOGO_URL_SCHEME_INVALID")
	}
	if parsed.User != nil {
		return errors.New("LOGO_URL_USERINFO_INVALID")
	}
	return nil
}

func normalizeTags(value interface{}) ([]string, error) {
	raw, err := stringSliceFromJSONValue(value)
	if err != nil {
		return nil, errors.New("TAGS_MUST_BE_STRING_ARRAY")
	}
	if len(raw) > maxSubscriptionTags {
		return nil, errors.New("TAGS_TOO_MANY")
	}
	seen := map[string]struct{}{}
	tags := make([]string, 0, len(raw))
	for _, item := range raw {
		tag := strings.TrimSpace(item)
		if tag == "" {
			continue
		}
		if len([]rune(tag)) > maxSubscriptionTagLength {
			return nil, errors.New("TAG_TOO_LONG")
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		// 标签去重发生在持久层，且保持大小写敏感，避免把用户刻意区分的缩写合并掉。
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	return tags, nil
}

// stringSliceFromJSONValue 兼容 PocketBase JSON 字段在不同入口下的运行时形态。
// 注意： 该函数只接受字符串数组语义；不要为了兼容旧数据而把非字符串静默转成字符串。
func stringSliceFromJSONValue(value interface{}) ([]string, error) {
	if value == nil {
		return []string{}, nil
	}
	switch v := value.(type) {
	case []string:
		return v, nil
	case []interface{}:
		return stringsFromInterfaceSlice(v)
	case types.JSONArray[string]:
		return []string(v), nil
	case types.JSONArray[interface{}]:
		return stringsFromInterfaceSlice([]interface{}(v))
	case types.JSONRaw:
		return decodeJSONStringArray([]byte(v))
	case json.RawMessage:
		return decodeJSONStringArray([]byte(v))
	case []byte:
		return decodeJSONStringArray(v)
	case string:
		if strings.TrimSpace(v) == "" {
			return []string{}, nil
		}
		return decodeJSONStringArray([]byte(v))
	default:
		data, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		return decodeJSONStringArray(data)
	}
}

// stringsFromInterfaceSlice 将通用切片收窄为字符串切片。
func stringsFromInterfaceSlice(rows []interface{}) ([]string, error) {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		text, ok := row.(string)
		if !ok {
			return nil, errors.New("expected string array")
		}
		out = append(out, text)
	}
	return out, nil
}

// decodeJSONStringArray 从 JSON 文本读取字符串数组。
func decodeJSONStringArray(data []byte) ([]string, error) {
	if len(strings.TrimSpace(string(data))) == 0 {
		return []string{}, nil
	}
	var raw []string
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if raw == nil {
		return []string{}, nil
	}
	return raw, nil
}

// customConfigFromValue 从 PocketBase JSON 字段读取强类型自定义配置。
func customConfigFromValue(value interface{}) (customConfigPayload, error) {
	var config customConfigPayload
	data, err := jsonBytesFromValue(value)
	if err != nil || len(strings.TrimSpace(string(data))) == 0 {
		return config, err
	}
	if err := decodeStrictJSONBytesInto(data, &config, localeZhCN, false); err != nil {
		return config, err
	}
	return config, nil
}

// normalizeCustomConfigPayload 校验所有配置分组。
// TODO： 如果后续允许更多配置分组，应在前端 schema、后端 payload 和默认配置中一起新增。
func normalizeCustomConfigPayload(config *customConfigPayload) error {
	groups := []struct {
		name  string
		items *[]customConfigItem
	}{
		{name: "categories", items: &config.Categories},
		{name: "statuses", items: &config.Statuses},
		{name: "paymentMethods", items: &config.PaymentMethods},
		{name: "currencies", items: &config.Currencies},
	}
	for _, group := range groups {
		if *group.items == nil {
			*group.items = []customConfigItem{}
		}
		if len(*group.items) > 200 {
			return fmt.Errorf("CUSTOM_CONFIG_GROUP_TOO_LARGE:%s", group.name)
		}
		for i := range *group.items {
			if err := normalizeCustomConfigItem(&(*group.items)[i]); err != nil {
				return fmt.Errorf("CUSTOM_CONFIG_ITEM_INVALID:%s:%w", group.name, err)
			}
		}
	}
	return nil
}

// normalizeCustomConfigItem 校验单个配置项的稳定字段。
func normalizeCustomConfigItem(item *customConfigItem) error {
	item.ID = strings.TrimSpace(item.ID)
	item.Value = strings.TrimSpace(item.Value)
	item.Labels.ZhCN = strings.TrimSpace(item.Labels.ZhCN)
	item.Labels.EnUS = strings.TrimSpace(item.Labels.EnUS)
	item.Color = strings.TrimSpace(item.Color)
	item.Icon = strings.TrimSpace(item.Icon)
	if item.ID == "" || item.Value == "" || item.Labels.ZhCN == "" || item.Labels.EnUS == "" {
		return errors.New("CONFIG_ITEM_REQUIRED_FIELDS")
	}
	if len([]rune(item.ID)) > 128 || len([]rune(item.Value)) > 128 || len([]rune(item.Labels.ZhCN)) > 128 || len([]rune(item.Labels.EnUS)) > 128 {
		return errors.New("CONFIG_ITEM_FIELDS_TOO_LONG")
	}
	return nil
}

// detectUploadMimeType 读取文件头判断真实 MIME。
// 注意： 调用方传入的是 PocketBase 文件 reader，需要在这里打开并关闭，避免泄漏文件句柄。
func detectUploadMimeType(reader interface {
	Open() (io.ReadSeekCloser, error)
}) (string, error) {
	f, err := reader.Open()
	if err != nil {
		return "", errors.New("ASSET_FILE_READ_FAILED")
	}
	defer f.Close()

	data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil {
		return "", errors.New("ASSET_FILE_READ_FAILED")
	}
	if isSVGDocument(data) {
		return "image/svg+xml", nil
	}
	if isICODocument(data) {
		return "image/x-icon", nil
	}
	if len(data) > 512 {
		data = data[:512]
	}
	return http.DetectContentType(data), nil
}

func isSVGDocument(data []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(bytes.TrimSpace(data)))
	for {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		if start, ok := token.(xml.StartElement); ok {
			// 只看第一个 XML start element，允许 XML 声明/注释，同时拒绝伪装成 SVG 的其他 XML。
			return strings.EqualFold(start.Name.Local, "svg") &&
				(start.Name.Space == "" || start.Name.Space == "http://www.w3.org/2000/svg")
		}
	}
}

func isICODocument(data []byte) bool {
	if len(data) < 6 {
		return false
	}
	// ICO 头：reserved=0、type=1、imageCount>0；比扩展名可靠，且无需解析完整图片目录。
	return data[0] == 0x00 &&
		data[1] == 0x00 &&
		data[2] == 0x01 &&
		data[3] == 0x00 &&
		(data[4] != 0x00 || data[5] != 0x00)
}

// isAllowedImageMime 限制可上传图片格式。
func isAllowedImageMime(mimeType string) bool {
	normalizedMimeType := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	switch normalizedMimeType {
	case "image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon":
		return true
	default:
		return false
	}
}
