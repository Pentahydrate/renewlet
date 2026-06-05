package main

// notification_http.go 提供外发通知使用的 HTTP/JSON 工具。
//
// 架构位置：渠道发送层统一通过这里设置超时、TLS 下限、错误文本截断和 SSRF DNS 解析校验。
// 这些防护必须靠近网络边界，避免新渠道绕过安全策略。
//
// 注意： responseOK 会消费并关闭响应体；调用方读取错误详情时必须在 responseOK 之前完成。
import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var notificationHTTPClientFactory = defaultNotificationHTTPClient

func postJSON[T interface{}](endpoint string, payload T, serviceLabel string, locale appLocale) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return sendHTTPRequest(http.MethodPost, endpoint, map[string]string{"content-type": "application/json"}, body, serviceLabel, locale)
}

func sendHTTPRequest(method, endpoint string, headers map[string]string, body []byte, serviceLabel string, locale appLocale) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	client := notificationHTTPClientFactory()
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New(serverFormat(locale, "notification.httpRequestFailed", map[string]interface{}{"service": serviceLabel, "error": err}))
	}
	return resp, nil
}

func defaultNotificationHTTPClient() *http.Client {
	// 该函数只负责统一 HTTP 客户端策略；用户可配置 URL 必须在调用前先经过 assertSafeOutboundURL。
	return &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			// 外发通知只接受 TLS 1.2+，避免把 token/邮件内容发送到弱 TLS 连接。
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
	}
}

func channelHTTPError(locale appLocale, channel string, statusCode int, detail string) error {
	return errors.New(serverFormat(locale, "notification.httpSendFailed", map[string]interface{}{"channel": channel, "status": statusCode, "detail": detail}))
}

func readResponseText(resp *http.Response) string {
	if resp == nil || resp.Body == nil {
		return ""
	}
	defer resp.Body.Close()
	// 外部服务错误页可能很大；只取前 8KiB 足够诊断，同时避免历史 lastError 被异常响应撑爆。
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}
	var parsed struct {
		Description string `json:"description"`
		Detail      string `json:"detail"`
		Message     string `json:"message"`
		Error       string `json:"error"`
		Title       string `json:"title"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil {
		for _, value := range []string{parsed.Description, parsed.Detail, parsed.Message, parsed.Error, parsed.Title} {
			if strings.TrimSpace(value) != "" {
				return trimLongText(value)
			}
		}
	}
	return trimLongText(text)
}

func responseOK(resp *http.Response) bool {
	if resp == nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false
	}
	if resp.Body != nil {
		// 成功响应也要 drain/close，保证 Go transport 能复用连接，降低连续渠道发送的握手开销。
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	return true
}

func trimLongText(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 800 {
		return value[:800] + "..."
	}
	return value
}

func fallbackText(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func parseHeaderJSON(input string, locale appLocale) (map[string]string, error) {
	headers := map[string]string{}
	input = strings.TrimSpace(input)
	if input == "" {
		return headers, nil
	}
	var raw map[string]string
	if err := json.Unmarshal([]byte(input), &raw); err != nil {
		return nil, errors.New(serverText(locale, "validation.jsonParseFailed"))
	}
	for key, value := range raw {
		// 只接受 JSON string map，避免复杂 header 值在序列化时绕过 http.Header 的规范化。
		headers[key] = value
	}
	return headers, nil
}

func applyTemplate(template string, message notificationMessage) string {
	replacer := strings.NewReplacer(
		"{title}", message.Title,
		"{content}", message.Content,
		"{timestamp}", message.Timestamp,
	)
	return replacer.Replace(template)
}

func splitList(input string) []string {
	parts := strings.FieldsFunc(input, func(r rune) bool {
		return r == ',' || r == '\n' || r == ';'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// assertSafeOutboundURL 校验外发 URL，防止 SSRF。
// DNS 解析后再检查 IP，是为了拦截域名解析到内网/本机地址的情况。
// TODO： 若未来允许高风险内网部署场景，可改成自定义 DialContext 并固定解析后的 IP，进一步降低 DNS rebinding 窗口。
func assertSafeOutboundURL(rawURL, label string, locale appLocale) (*url.URL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Hostname() == "" {
		return nil, errors.New(serverFormat(locale, "url.invalid", map[string]interface{}{"label": label}))
	}
	if parsed.Scheme != "https" {
		return nil, errors.New(serverFormat(locale, "url.mustUseHttps", map[string]interface{}{"label": label}))
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return nil, errors.New(serverFormat(locale, "url.localhostNotAllowed", map[string]interface{}{"label": label}))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, errors.New(serverFormat(locale, "url.dnsLookupFailed", map[string]interface{}{"label": label}))
	}
	for _, ip := range ips {
		// 任何一个解析结果落到内网/本机都拒绝，避免服务端在多 A/AAAA 记录中选到危险地址。
		if isUnsafeOutboundIP(ip.IP) {
			return nil, errors.New(serverFormat(locale, "url.privateOrLocalNotAllowed", map[string]interface{}{"label": label}))
		}
	}
	return parsed, nil
}

func isUnsafeOutboundIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
