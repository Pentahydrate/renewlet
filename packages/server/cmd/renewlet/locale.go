package main

// locale.go 统一处理 API 文案的语言协商。
//
// 架构位置：
//   - 前端会发送 X-Renewlet-Locale，后端 route 和 Validate 使用 requestLocale 输出本地化错误。
//   - 没有显式 header 时回退到 Accept-Language，最后默认中文。
//
// 注意： 支持语言集合必须与前端 SUPPORTED_LOCALES 同步，否则错误文案和 UI 语言会分叉。
import (
	"net/http"
	"strconv"
	"strings"
)

type appLocale string

const (
	localeZhCN appLocale = "zh-CN"
	localeEnUS appLocale = "en-US"
)

// normalizeAppLocale 将设置值或外部输入归一为受支持语言。
func normalizeAppLocale(value string) appLocale {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch {
	case normalized == "zh-cn" || normalized == "zh" || strings.HasPrefix(normalized, "zh-"):
		return localeZhCN
	case normalized == "en-us" || normalized == "en" || strings.HasPrefix(normalized, "en-"):
		return localeEnUS
	default:
		return localeZhCN
	}
}

// isSupportedAppLocale 判断字符串是否是后端支持的精确 locale。
func isSupportedAppLocale(value string) bool {
	return value == string(localeZhCN) || value == string(localeEnUS)
}

// matchAcceptedLocale 从 Accept-Language 单个 tag 中匹配支持语言。
func matchAcceptedLocale(value string) (appLocale, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch {
	case normalized == "zh-cn" || normalized == "zh" || strings.HasPrefix(normalized, "zh-"):
		return localeZhCN, true
	case normalized == "en-us" || normalized == "en" || strings.HasPrefix(normalized, "en-"):
		return localeEnUS, true
	default:
		return localeZhCN, false
	}
}

// requestLocale 从请求头选择本地化语言。
// X-Renewlet-Locale 优先级高于 Accept-Language，确保前端设置页语言能控制 API 错误文案。
func requestLocale(req *http.Request) appLocale {
	if req == nil {
		return localeZhCN
	}
	if locale := strings.TrimSpace(req.Header.Get("X-Renewlet-Locale")); isSupportedAppLocale(locale) {
		return appLocale(locale)
	}
	return acceptLanguageLocale(req.Header.Get("Accept-Language"))
}

// acceptLanguageLocale 解析 Accept-Language，并选择 q 值最高的支持语言。
func acceptLanguageLocale(header string) appLocale {
	bestLocale := localeZhCN
	bestQ := -1.0
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		tag := part
		q := 1.0
		if idx := strings.Index(part, ";"); idx >= 0 {
			tag = strings.TrimSpace(part[:idx])
			for _, param := range strings.Split(part[idx+1:], ";") {
				param = strings.TrimSpace(param)
				if !strings.HasPrefix(param, "q=") {
					continue
				}
				if parsed, err := strconv.ParseFloat(strings.TrimPrefix(param, "q="), 64); err == nil {
					q = parsed
				}
			}
		}
		locale, ok := matchAcceptedLocale(tag)
		if !ok {
			continue
		}
		if q > bestQ {
			bestLocale = locale
			bestQ = q
		}
	}
	return bestLocale
}

// tr 返回当前 locale 对应文案。
func tr(locale appLocale, zhCN string, enUS string) string {
	if locale == localeEnUS {
		return enUS
	}
	return zhCN
}

// localizedDisabledBanReason 返回账号禁用原因。
func localizedDisabledBanReason(locale appLocale) string {
	return tr(locale, "账号已被管理员禁用", "Account disabled by an administrator")
}
