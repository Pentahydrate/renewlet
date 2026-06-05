package main

// notification_channels.go 负责非邮件通知渠道和渠道分发。
//
// 架构位置：统一 notificationMessage 在这里被转换为 Telegram/NotifyX/Webhook/WeCom/Bark 的外部请求。
// 外部服务失败被收敛为 channelFailure，调度层据此决定 sent/failed 和后续重试范围。
//
// 注意： Webhook、WeCom、Bark 都可能携带用户配置 URL，必须经过 SSRF/公网 HTTPS 防护后才能请求。
import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

var serverChanSCTPSendKeyRe = regexp.MustCompile(`^sctp(\d+)t`)

func sendToChannels(app core.App, channels []string, settings appSettings, message notificationMessage) sendSummary {
	summary := sendSummary{
		Attempted: append([]string(nil), channels...),
		Succeeded: []string{},
		Failed:    []channelFailure{},
	}
	for _, channel := range channels {
		// 串行发送牺牲一点延迟，换来确定性的 history 顺序，并降低同一分钟对多个外部服务的突发压力。
		if err := sendToChannel(app, channel, settings, message); err != nil {
			summary.Failed = append(summary.Failed, channelFailure{Channel: channel, Error: err.Error()})
		} else {
			summary.Succeeded = append(summary.Succeeded, channel)
		}
	}
	return summary
}

// sendToChannel 将统一消息分发到具体通知渠道。
// 注意： 新增渠道时必须同步 knownChannels、settings schema、前端渠道枚举和 history result schema。
func sendToChannel(app core.App, channel string, settings appSettings, message notificationMessage) error {
	_ = app
	locale := normalizeAppLocale(settings.Locale)
	switch channel {
	case "telegram":
		return sendTelegram(settings, message)
	case "notifyx":
		return sendNotifyx(settings, message)
	case "webhook":
		return sendWebhook(settings, message)
	case "wechat":
		return sendWeChatWork(settings, message)
	case "email":
		return sendEmail(settings, message)
	case "bark":
		return sendBark(settings, message)
	case "serverchan":
		return sendServerChan(settings, message)
	default:
		return errors.New(serverFormat(locale, "notification.channelUnknown", map[string]interface{}{"channel": channel}))
	}
}

// sendTelegram 发送 Telegram Bot 消息。
// Telegram/网络 429 或 5xx 会短重试，其他 4xx 直接失败，避免无效配置反复打扰外部 API。
func sendTelegram(settings appSettings, message notificationMessage) error {
	locale := normalizeAppLocale(settings.Locale)
	token, err := requireNonEmptyLocalized(locale, serverText(locale, "service.telegramBotToken"), settings.TelegramBotToken)
	if err != nil {
		return err
	}
	chatID, err := requireNonEmptyLocalized(locale, serverText(locale, "service.telegramChatID"), settings.TelegramChatID)
	if err != nil {
		return err
	}
	endpoint := "https://api.telegram.org/bot" + token + "/sendMessage"
	body := telegramSendMessageRequest{
		ChatID:                chatID,
		Text:                  buildTextMessage(message),
		DisableWebPagePreview: true,
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		resp, err := postJSON(endpoint, body, "Telegram Bot API", locale)
		if err == nil && responseOK(resp) {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			text := readResponseText(resp)
			lastErr = channelHTTPError(normalizeAppLocale(settings.Locale), "Telegram", resp.StatusCode, fallbackText(text, resp.Status))
			if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 {
				// 配置错误类 4xx 不重试，避免每轮 cron 都重复打到外部 API。
				break
			}
		}
		time.Sleep(time.Duration(500*(1<<attempt)) * time.Millisecond)
	}
	return lastErr
}

// sendNotifyx 发送 NotifyX 消息。
func sendNotifyx(settings appSettings, message notificationMessage) error {
	locale := normalizeAppLocale(settings.Locale)
	apiKey, err := requireNonEmptyLocalized(locale, serverText(locale, "service.notifyxAPIKey"), settings.NotifyxAPIKey)
	if err != nil {
		return err
	}
	endpoint := "https://www.notifyx.cn/api/v1/send/" + url.PathEscape(apiKey)
	resp, err := postJSON(endpoint, notifyxSendRequest{
		Title:       message.Title,
		Content:     message.Content,
		Description: message.Timestamp,
	}, "NotifyX API", locale)
	if err != nil {
		return err
	}
	if responseOK(resp) {
		return nil
	}
	text := readResponseText(resp)
	return channelHTTPError(normalizeAppLocale(settings.Locale), "NotifyX", resp.StatusCode, fallbackText(text, resp.Status))
}

// sendWebhook 发送用户自定义 Webhook。
// 注意： URL 必须经过 assertSafeOutboundURL，防止 Webhook 被用作 SSRF 到内网服务。
func sendWebhook(settings appSettings, message notificationMessage) error {
	locale := normalizeAppLocale(settings.Locale)
	rawURL, err := requireNonEmptyLocalized(locale, serverText(locale, "service.webhookURL"), settings.WebhookURL)
	if err != nil {
		return err
	}
	safeURL, err := assertSafeOutboundURL(rawURL, "Webhook URL", locale)
	if err != nil {
		return err
	}
	headers, err := parseHeaderJSON(settings.WebhookHeaders, locale)
	if err != nil {
		return err
	}
	if settings.WebhookMethod == "GET" {
		u := *safeURL
		q := u.Query()
		// GET Webhook 兼容只支持 query 的自动化平台；敏感订阅内容会进入对方访问日志，用户应优先选 POST。
		q.Set("title", message.Title)
		q.Set("content", message.Content)
		q.Set("timestamp", message.Timestamp)
		u.RawQuery = q.Encode()
		resp, err := sendHTTPRequest(http.MethodGet, u.String(), headers, nil, "Webhook", locale)
		if err != nil {
			return err
		}
		if responseOK(resp) {
			return nil
		}
		text := readResponseText(resp)
		return channelHTTPError(normalizeAppLocale(settings.Locale), "Webhook", resp.StatusCode, fallbackText(text, resp.Status))
	}

	body, err := json.Marshal(webhookDefaultPayload{
		Title:     message.Title,
		Content:   message.Content,
		Timestamp: message.Timestamp,
	})
	if err != nil {
		return err
	}
	rawPayload := strings.TrimSpace(applyTemplate(settings.WebhookPayload, message))
	if rawPayload != "" {
		// 用户模板只有在仍是合法 JSON 时才会覆盖默认 payload，避免把任意文本作为 application/json 发送。
		if json.Valid([]byte(rawPayload)) {
			body = []byte(rawPayload)
		}
	}
	if _, ok := headers["content-type"]; !ok {
		headers["content-type"] = "application/json"
	}
	resp, err := sendHTTPRequest(http.MethodPost, safeURL.String(), headers, body, "Webhook", locale)
	if err != nil {
		return err
	}
	if responseOK(resp) {
		return nil
	}
	text := readResponseText(resp)
	return channelHTTPError(normalizeAppLocale(settings.Locale), "Webhook", resp.StatusCode, fallbackText(text, resp.Status))
}

// sendWeChatWork 发送企业微信机器人消息。
func sendWeChatWork(settings appSettings, message notificationMessage) error {
	locale := normalizeAppLocale(settings.Locale)
	rawURL, err := requireNonEmptyLocalized(locale, localizedFieldLabel(locale, "wechatWebhookURL"), settings.WechatWebhookURL)
	if err != nil {
		return err
	}
	safeURL, err := assertSafeOutboundURL(rawURL, localizedFieldLabel(locale, "wechatWebhookURL"), locale)
	if err != nil {
		return err
	}
	content := buildTextMessage(message)
	if settings.WechatAddModeTag {
		content = "【Renewlet】\n" + content
	}
	if settings.WechatMessageType == "markdown" {
		resp, err := postJSON(safeURL.String(), wechatMarkdownRequest{
			MsgType:  "markdown",
			Markdown: wechatMarkdownMessage{Content: content},
		}, serverText(locale, "service.wecomAPI"), locale)
		if err != nil {
			return err
		}
		if responseOK(resp) {
			return nil
		}
		text := readResponseText(resp)
		return channelHTTPError(normalizeAppLocale(settings.Locale), "WeCom", resp.StatusCode, fallbackText(text, resp.Status))
	} else {
		phones := splitList(settings.WechatAtPhones)
		if settings.WechatAtAll {
			phones = append([]string{"@all"}, phones...)
		}
		resp, err := postJSON(safeURL.String(), wechatTextRequest{
			MsgType: "text",
			Text: wechatTextMessage{
				Content:             content,
				MentionedMobileList: phones,
			},
		}, serverText(locale, "service.wecomAPI"), locale)
		if err != nil {
			return err
		}
		if responseOK(resp) {
			return nil
		}
		text := readResponseText(resp)
		return channelHTTPError(normalizeAppLocale(settings.Locale), "WeCom", resp.StatusCode, fallbackText(text, resp.Status))
	}
}

// sendBark 发送 Bark 推送。
func sendBark(settings appSettings, message notificationMessage) error {
	locale := normalizeAppLocale(settings.Locale)
	parsed, err := buildBarkRequestURL(settings, message)
	if err != nil {
		return err
	}
	safeURL, err := assertSafeOutboundURL(parsed.String(), serverText(locale, "service.barkServerURL"), locale)
	if err != nil {
		return err
	}
	resp, err := sendHTTPRequest(http.MethodGet, safeURL.String(), nil, nil, "Bark API", locale)
	if err != nil {
		return err
	}
	if responseOK(resp) {
		return nil
	}
	text := readResponseText(resp)
	return channelHTTPError(locale, "Bark", resp.StatusCode, fallbackText(text, resp.Status))
}

// buildBarkRequestURL 构造 Bark GET 请求 URL。
func buildBarkRequestURL(settings appSettings, message notificationMessage) (*url.URL, error) {
	locale := normalizeAppLocale(settings.Locale)
	serverRaw, err := requireNonEmptyLocalized(locale, localizedFieldLabel(locale, "barkServerURL"), settings.BarkServerURL)
	if err != nil {
		return nil, err
	}
	deviceKey, err := requireNonEmptyLocalized(locale, localizedFieldLabel(locale, "barkDeviceKey"), settings.BarkDeviceKey)
	if err != nil {
		return nil, err
	}
	server := strings.TrimRight(serverRaw, "/")
	body := message.Content + "\n\n" + message.Timestamp
	rawURL := fmt.Sprintf("%s/%s/%s/%s", server, url.PathEscape(deviceKey), url.PathEscape(message.Title), url.PathEscape(body))
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	q := parsed.Query()
	q.Set("group", "Renewlet")
	if iconURL := barkNotificationIconURL(message); iconURL != "" {
		q.Set("icon", iconURL)
	}
	if settings.BarkSilentPush {
		q.Set("sound", "none")
	}
	parsed.RawQuery = q.Encode()
	return parsed, nil
}

// barkNotificationIconURL 在只有一个提醒项时尝试附带公开 HTTPS 图标。
func barkNotificationIconURL(message notificationMessage) string {
	if len(message.Items) != 1 {
		return ""
	}
	return safePublicHTTPSIconURL(message.Items[0].LogoURL)
}

// safePublicHTTPSIconURL 过滤不能暴露给第三方推送服务的图标 URL。
// 防御点：拒绝 localhost、内网 IP、非 HTTPS 和包含 userinfo 的 URL。
func safePublicHTTPSIconURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return ""
	}
	if ip := net.ParseIP(host); ip != nil && isUnsafeOutboundIP(ip) {
		return ""
	}
	return parsed.String()
}

// sendServerChan 发送 Server酱 Turbo / Server酱³ 推送。
func sendServerChan(settings appSettings, message notificationMessage) error {
	locale := normalizeAppLocale(settings.Locale)
	sendKey, err := requireNonEmptyLocalized(locale, serverText(locale, "service.serverchanSendKey"), settings.ServerChanSendKey)
	if err != nil {
		return err
	}
	endpoint, err := buildServerChanEndpoint(sendKey, locale)
	if err != nil {
		return err
	}
	resp, err := postServerChanJSON(endpoint, serverChanSendRequest{
		Title: message.Title,
		Desp:  message.Content + "\n\n" + message.Timestamp,
	}, locale)
	if err != nil {
		return err
	}
	return requireServerChanSuccess(resp, locale, sendKey)
}

func postServerChanJSON(endpoint string, payload serverChanSendRequest, locale appLocale) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	resp, err := notificationHTTPClientFactory().Do(req)
	if err != nil {
		return nil, errors.New(serverFormat(locale, "notification.httpRequestFailed", map[string]interface{}{"service": "ServerChan", "error": serverText(locale, "service.serverchanRequestFailed")}))
	}
	return resp, nil
}

func buildServerChanEndpoint(sendKey string, locale appLocale) (string, error) {
	sendKey = strings.TrimSpace(sendKey)
	if strings.HasPrefix(sendKey, "sctp") {
		// sctp SendKey 的数字子域名来自官方 Go SDK 和 Wallos 兼容实现，不允许用户配置任意 URL。
		matches := serverChanSCTPSendKeyRe.FindStringSubmatch(sendKey)
		if len(matches) != 2 {
			return "", errors.New(serverText(locale, "service.serverchanSendKeyInvalid"))
		}
		return fmt.Sprintf("https://%s.push.ft07.com/send/%s.send", matches[1], url.PathEscape(sendKey)), nil
	}
	return fmt.Sprintf("https://sctapi.ftqq.com/%s.send", url.PathEscape(sendKey)), nil
}

func requireServerChanSuccess(resp *http.Response, locale appLocale, sendKey string) error {
	if resp == nil {
		return channelHTTPError(locale, "ServerChan", 0, "")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return channelHTTPError(locale, "ServerChan", resp.StatusCode, fallbackText(redactServerChanSecret(serverChanJSONErrorDetail(body), sendKey), serverText(locale, "service.serverchanResponseInvalid")))
	}
	var result serverChanSendResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return channelHTTPError(locale, "ServerChan", resp.StatusCode, serverText(locale, "service.serverchanResponseInvalid"))
	}
	// Server酱可能 HTTP 2xx 但业务 code 失败；历史摘要必须按 code 判断真实发送结果。
	if result.Code == nil {
		return channelHTTPError(locale, "ServerChan", resp.StatusCode, serverText(locale, "service.serverchanResponseInvalid"))
	}
	if *result.Code != 0 {
		return channelHTTPError(locale, "ServerChan", resp.StatusCode, fallbackText(redactServerChanSecret(firstNonBlank(result.Message, result.Detail), sendKey), serverText(locale, "service.serverchanResponseInvalid")))
	}
	return nil
}

func serverChanJSONErrorDetail(body []byte) string {
	var result serverChanSendResponse
	if err := json.Unmarshal(body, &result); err == nil {
		return trimLongText(firstNonBlank(result.Message, result.Detail))
	}
	return ""
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func redactServerChanSecret(value, sendKey string) string {
	value = strings.TrimSpace(value)
	sendKey = strings.TrimSpace(sendKey)
	if sendKey != "" {
		value = strings.ReplaceAll(value, sendKey, "[redacted]")
		value = strings.ReplaceAll(value, url.PathEscape(sendKey), "[redacted]")
	}
	return trimLongText(value)
}
