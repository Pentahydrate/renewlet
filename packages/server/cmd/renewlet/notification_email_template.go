package main

// notification_email_template.go 渲染邮件渠道的 HTML 正文。
//
// 架构位置：HTML 放在 embedded .gohtml 模板，文案放在 embedded locale JSON catalog，
// Go 只负责准备 view model。这样既能保持严格邮件客户端兼容，也避免把布局写成巨大字符串。
//
// 注意： 不要把预渲染 HTML 传进模板；用户可控值必须继续交给 html/template 做上下文转义。
import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"math"
	"net/url"
	"os"
	"strings"
	"sync"
)

const (
	// 邮件正文必须有硬上限，避免异常订阅备注或通知内容让 SMTP 请求膨胀。
	emailMaxHTMLBytes     = 100 * 1024
	emailCompactTextRunes = 12000
)

// 模板与文案一起 embed，保证 Docker 单 binary 部署不依赖运行时文件路径。
//
//go:embed templates/email/*.gohtml i18n/email.*.json
var emailTemplateFS embed.FS

var (
	emailTemplateOnce sync.Once
	emailTemplateSet  *template.Template
	emailTemplateErr  error

	emailCatalogMu    sync.Mutex
	emailCatalogCache = map[appLocale]emailCatalog{}
)

type emailTheme struct {
	Primary      string
	PrimaryText  string
	PrimarySoft  string
	Background   string
	Surface      string
	SurfaceMuted string
	Border       string
	Text         string
	Muted        string
	Warning      string
	Danger       string
	Success      string
}

type emailCatalog struct {
	BrandTagline          string `json:"brandTagline"`
	Generated             string `json:"generated"`
	NoReminders           string `json:"noReminders"`
	TestNotification      string `json:"testNotification"`
	ReminderItems         string `json:"reminderItems"`
	Message               string `json:"message"`
	EmptyDetails          string `json:"emptyDetails"`
	GeneratedAt           string `json:"generatedAt"`
	Footer                string `json:"footer"`
	Truncated             string `json:"truncated"`
	UpcomingRenewals      string `json:"upcomingRenewals"`
	TrialEnding           string `json:"trialEnding"`
	Expired               string `json:"expired"`
	BillingDate           string `json:"billingDate"`
	TrialEnds             string `json:"trialEnds"`
	ExpiredSince          string `json:"expiredSince"`
	UpdateNextBillingDate string `json:"updateNextBillingDate"`
	DayBefore             string `json:"dayBefore"`
	DaysBefore            string `json:"daysBefore"`
	RepeatEvery           string `json:"repeatEvery"`
	PreheaderItems        string `json:"preheaderItems"`
	CTAViewSubscriptions  string `json:"ctaViewSubscriptions"`
	CTAOpenSettings       string `json:"ctaOpenSettings"`
}

type emailTemplateData struct {
	Lang         string
	Title        string
	Preheader    string
	StatusLabel  string
	HasGroups    bool
	ContentLines []string
	Groups       []emailTemplateGroup
	SummaryRows  []emailTemplateSummaryRow
	ShowCTA      bool
	CTAURL       string
	CTALabel     string
	Timestamp    string
	Copy         emailCatalog
	Theme        emailTheme
}

type emailTemplateSummaryRow struct {
	Label string
	Value string
}

type emailTemplateGroup struct {
	Label string
	Count int
	Items []emailTemplateItem
}

type emailTemplateItem struct {
	Name       string
	DateLabel  string
	TargetDate string
	Amount     string
	Currency   string
	Detail     string
	Accent     emailAccent
}

type emailAccent struct {
	Text string
}

func buildEmailHTMLMessage(settings appSettings, message notificationMessage) (string, error) {
	data, err := buildEmailTemplateData(settings, message, false)
	if err != nil {
		return "", err
	}
	body, err := renderEmailTemplate(data)
	if err != nil {
		return "", err
	}
	if len(body) <= emailMaxHTMLBytes {
		return body, nil
	}

	// 超限时降级为紧凑正文而不是直接失败，避免大量提醒项导致邮件渠道整批不可用。
	compactData, err := buildEmailTemplateData(settings, message, true)
	if err != nil {
		return "", err
	}
	return renderEmailTemplate(compactData)
}

func buildEmailTemplateData(settings appSettings, message notificationMessage, compact bool) (emailTemplateData, error) {
	locale := normalizeAppLocale(settings.Locale)
	copy, err := loadEmailCatalog(locale)
	if err != nil {
		return emailTemplateData{}, err
	}
	itemCount := len(message.Items)
	hasReminderItems := itemCount > 0
	if compact {
		message.Items = nil
		message.Content = emailCompactContent(message.Content, copy)
	}

	groups := []emailTemplateGroup{}
	if len(message.Items) > 0 {
		groups = buildEmailTemplateGroups(message.Items, locale, copy, emailThemeFromSettings(settings))
	}
	statusLabel := copy.Generated
	if itemCount == 0 && !message.HasPayload {
		statusLabel = copy.NoReminders
	} else if itemCount == 0 {
		statusLabel = copy.TestNotification
	}

	contentLines := []string{}
	if len(groups) == 0 {
		contentLines = splitEmailContentLines(message.Content, copy)
	}
	showCTA, ctaURL, ctaLabel := emailCTAFromAppURL(os.Getenv("APP_URL"), hasReminderItems, copy)

	return emailTemplateData{
		Lang:         emailHTMLLang(locale),
		Title:        message.Title,
		Preheader:    emailPreheader(message, copy),
		StatusLabel:  statusLabel,
		HasGroups:    len(groups) > 0,
		ContentLines: contentLines,
		Groups:       groups,
		SummaryRows:  emailSummaryRows(itemCount, groups, copy),
		ShowCTA:      showCTA,
		CTAURL:       ctaURL,
		CTALabel:     ctaLabel,
		Timestamp:    message.Timestamp,
		Copy:         copy,
		Theme:        emailThemeFromSettings(settings),
	}, nil
}

func renderEmailTemplate(data emailTemplateData) (string, error) {
	templates, err := emailTemplates()
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	if err := templates.ExecuteTemplate(&out, "notification.gohtml", data); err != nil {
		return "", err
	}
	return out.String(), nil
}

func emailTemplates() (*template.Template, error) {
	emailTemplateOnce.Do(func() {
		emailTemplateSet, emailTemplateErr = template.ParseFS(emailTemplateFS, "templates/email/*.gohtml")
	})
	return emailTemplateSet, emailTemplateErr
}

func loadEmailCatalog(locale appLocale) (emailCatalog, error) {
	emailCatalogMu.Lock()
	defer emailCatalogMu.Unlock()
	if catalog, ok := emailCatalogCache[locale]; ok {
		return catalog, nil
	}
	data, err := emailTemplateFS.ReadFile(fmt.Sprintf("i18n/email.%s.json", locale))
	if err != nil {
		return emailCatalog{}, err
	}
	var catalog emailCatalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return emailCatalog{}, err
	}
	emailCatalogCache[locale] = catalog
	return catalog, nil
}

func buildEmailTemplateGroups(items []notificationContentItem, locale appLocale, copy emailCatalog, theme emailTheme) []emailTemplateGroup {
	grouped := map[string][]notificationContentItem{
		"renewal": {},
		"trial":   {},
		"expired": {},
	}
	for _, item := range items {
		itemType := item.Type
		if _, ok := grouped[itemType]; !ok {
			// 未知类型按续费处理，保证历史旧数据仍能渲染，而不是让整封邮件失败。
			itemType = "renewal"
		}
		grouped[itemType] = append(grouped[itemType], item)
	}

	// 邮件分组顺序固定，避免 map iteration 导致同一批提醒在不同运行中顺序抖动。
	order := []string{"renewal", "trial", "expired"}
	groups := make([]emailTemplateGroup, 0, len(order))
	for _, itemType := range order {
		rawItems := grouped[itemType]
		if len(rawItems) == 0 {
			continue
		}
		group := emailTemplateGroup{
			Label: emailGroupLabel(itemType, copy),
			Count: len(rawItems),
			Items: make([]emailTemplateItem, 0, len(rawItems)),
		}
		for _, item := range rawItems {
			group.Items = append(group.Items, emailTemplateItem{
				Name:       item.Name,
				DateLabel:  emailItemDateLabel(item.Type, copy),
				TargetDate: item.TargetDate,
				Amount:     formatAmount(item.Price),
				Currency:   item.Currency,
				Detail:     emailItemDetail(item, locale, copy),
				Accent:     emailItemAccent(item.Type, theme),
			})
		}
		groups = append(groups, group)
	}
	return groups
}

func emailSummaryRows(itemCount int, groups []emailTemplateGroup, copy emailCatalog) []emailTemplateSummaryRow {
	if len(groups) == 0 {
		return []emailTemplateSummaryRow{{
			Label: copy.ReminderItems,
			Value: fmt.Sprint(itemCount),
		}}
	}
	rows := make([]emailTemplateSummaryRow, 0, len(groups))
	for _, group := range groups {
		rows = append(rows, emailTemplateSummaryRow{
			Label: group.Label,
			Value: fmt.Sprint(group.Count),
		})
	}
	return rows
}

func emailCTAFromAppURL(rawAppURL string, hasReminderItems bool, copy emailCatalog) (bool, string, string) {
	appURL := strings.TrimSpace(rawAppURL)
	if appURL == "" {
		return false, "", ""
	}
	parsed, err := url.Parse(appURL)
	if err != nil {
		return false, "", ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if parsed.Host == "" || (scheme != "http" && scheme != "https") {
		return false, "", ""
	}

	targetPath := "/settings"
	label := copy.CTAOpenSettings
	if hasReminderItems {
		targetPath = "/subscriptions"
		label = copy.CTAViewSubscriptions
	}
	basePath := strings.TrimRight(parsed.Path, "/")
	if basePath == "" {
		parsed.Path = targetPath
	} else {
		// 支持应用挂在子路径下的反代部署，例如 https://example.com/renewlet。
		parsed.Path = basePath + targetPath
	}
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return true, parsed.String(), label
}

func emailThemeFromSettings(settings appSettings) emailTheme {
	h, s, l := emailThemeHSL(settings)
	primary := hslToHex(h, s, l)
	return emailTheme{
		Primary:      primary,
		PrimaryText:  contrastTextForHSL(h, s, l),
		PrimarySoft:  hslToHex(h, math.Min(s, 70), 94),
		Background:   "#F4F7F6",
		Surface:      "#FFFFFF",
		SurfaceMuted: "#F8FAF9",
		Border:       "#DDE6E2",
		Text:         "#17211F",
		Muted:        "#64748B",
		Warning:      "#D97706",
		Danger:       "#DC2626",
		Success:      primary,
	}
}

func emailThemeHSL(settings appSettings) (float64, float64, float64) {
	switch strings.TrimSpace(settings.ThemeVariant) {
	case "ocean":
		return 210, 90, 45
	case "sunset":
		return 25, 95, 48
	case "lavender":
		return 270, 70, 55
	case "rose":
		return 340, 75, 50
	case "custom":
		if validEmailCustomColor(settings.ThemeCustomColor) {
			return settings.ThemeCustomColor.H, settings.ThemeCustomColor.S, settings.ThemeCustomColor.L
		}
	}
	return 160, 84, 39
}

func validEmailCustomColor(color themeCustomColor) bool {
	values := []float64{color.H, color.S, color.L}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return color.H >= 0 && color.H <= 360 && color.S >= 0 && color.S <= 100 && color.L >= 0 && color.L <= 100
}

func emailItemAccent(itemType string, theme emailTheme) emailAccent {
	switch itemType {
	case "trial":
		return emailAccent{Text: theme.Warning}
	case "expired":
		return emailAccent{Text: theme.Danger}
	default:
		return emailAccent{Text: theme.Success}
	}
}

func emailHTMLLang(locale appLocale) string {
	if locale == localeEnUS {
		return "en"
	}
	return "zh-CN"
}

func emailPreheader(message notificationMessage, copy emailCatalog) string {
	if len(message.Items) > 0 {
		return fmt.Sprintf(copy.PreheaderItems, len(message.Items))
	}
	content := firstNonEmptyLine(message.Content)
	if content != "" {
		return content
	}
	return message.Title
}

func firstNonEmptyLine(input string) string {
	for _, line := range strings.Split(strings.ReplaceAll(input, "\r\n", "\n"), "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func emailGroupLabel(itemType string, copy emailCatalog) string {
	switch itemType {
	case "trial":
		return copy.TrialEnding
	case "expired":
		return copy.Expired
	default:
		return copy.UpcomingRenewals
	}
}

func emailItemDateLabel(itemType string, copy emailCatalog) string {
	switch itemType {
	case "trial":
		return copy.TrialEnds
	case "expired":
		return copy.ExpiredSince
	default:
		return copy.BillingDate
	}
}

func emailItemDetail(item notificationContentItem, _ appLocale, copy emailCatalog) string {
	if item.Type == "expired" {
		return copy.UpdateNextBillingDate
	}
	if item.RepeatReminder != nil && copy.RepeatEvery != "" {
		return fmt.Sprintf(copy.RepeatEvery, repeatReminderIntervalHours(item.RepeatReminder.Interval))
	}
	if item.ReminderDays == 1 && copy.DayBefore != "" {
		return fmt.Sprintf(copy.DayBefore, item.ReminderDays)
	}
	return fmt.Sprintf(copy.DaysBefore, item.ReminderDays)
}

func splitEmailContentLines(input string, copy emailCatalog) []string {
	normalized := strings.ReplaceAll(input, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := []string{}
	for _, line := range strings.Split(strings.TrimSpace(normalized), "\n") {
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return []string{copy.EmptyDetails}
	}
	return lines
}

func emailCompactContent(input string, copy emailCatalog) string {
	runes := []rune(input)
	if len(runes) <= emailCompactTextRunes {
		return input
	}
	return strings.TrimSpace(string(runes[:emailCompactTextRunes])) + "\n\n" + copy.Truncated
}

func hslToHex(h, s, l float64) string {
	h = math.Mod(h, 360)
	if h < 0 {
		h += 360
	}
	s = clamp01(s / 100)
	l = clamp01(l / 100)
	c := (1 - math.Abs(2*l-1)) * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := l - c/2

	// 这里手写 HSL->RGB 是为了邮件模板不依赖浏览器 CSS 颜色函数，老邮件客户端也能渲染 hex。
	r, g, b := 0.0, 0.0, 0.0
	switch {
	case h < 60:
		r, g, b = c, x, 0
	case h < 120:
		r, g, b = x, c, 0
	case h < 180:
		r, g, b = 0, c, x
	case h < 240:
		r, g, b = 0, x, c
	case h < 300:
		r, g, b = x, 0, c
	default:
		r, g, b = c, 0, x
	}
	return fmt.Sprintf("#%02X%02X%02X", byte(math.Round((r+m)*255)), byte(math.Round((g+m)*255)), byte(math.Round((b+m)*255)))
}

func contrastTextForHSL(h, s, l float64) string {
	r, g, b := hslToRGB(h, s, l)
	luminance := relativeLuminance(r, g, b)
	// 使用相对亮度选择黑/白文字，保证自定义主题色在邮件 CTA 上仍有基本可读性。
	if luminance > 0.52 {
		return "#111827"
	}
	return "#FFFFFF"
}

func hslToRGB(h, s, l float64) (float64, float64, float64) {
	h = math.Mod(h, 360)
	if h < 0 {
		h += 360
	}
	s = clamp01(s / 100)
	l = clamp01(l / 100)
	c := (1 - math.Abs(2*l-1)) * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := l - c/2
	r, g, b := 0.0, 0.0, 0.0
	switch {
	case h < 60:
		r, g, b = c, x, 0
	case h < 120:
		r, g, b = x, c, 0
	case h < 180:
		r, g, b = 0, c, x
	case h < 240:
		r, g, b = 0, x, c
	case h < 300:
		r, g, b = x, 0, c
	default:
		r, g, b = c, 0, x
	}
	return r + m, g + m, b + m
}

func relativeLuminance(r, g, b float64) float64 {
	return 0.2126*linearizedRGB(r) + 0.7152*linearizedRGB(g) + 0.0722*linearizedRGB(b)
}

func linearizedRGB(value float64) float64 {
	if value <= 0.03928 {
		return value / 12.92
	}
	return math.Pow((value+0.055)/1.055, 2.4)
}

func clamp01(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
