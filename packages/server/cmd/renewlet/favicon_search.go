package main

// favicon_search.go 为订阅 logo/icon 提供远端增强搜索。
//
// 架构位置：前端只提交搜索词，后端负责限流、短缓存、外部 HTML 拉取和候选 URL 归一。
// 外部搜索结果不稳定，因此所有网络失败都降级为空结果而不是破坏订阅编辑流程。
//
// 注意： 该模块会访问第三方站点；修改抓取源时必须同步 CSP connect-src、限流和缓存策略。
// PERF： 多实例部署时可将缓存和限流迁移到共享存储，减少外部网络波动带来的重复请求。
import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// cachedFaviconResult 是 favicon 增强搜索的短期缓存条目。
type cachedFaviconResult struct {
	ExpiresAt time.Time
	ImageURLs []string
}

// faviconRateBucket 是按用户/IP 维度的内存限流桶。
type faviconRateBucket struct {
	Count   int
	ResetAt time.Time
}

var (
	faviconCacheMu       sync.Mutex
	faviconCache         = map[string]cachedFaviconResult{}
	faviconRateLimitMu   sync.Mutex
	faviconRateLimitData = map[string]faviconRateBucket{}
)

var knownFaviconDomains = map[string]string{
	"netflix":      "netflix.com",
	"spotify":      "spotify.com",
	"youtube":      "youtube.com",
	"github":       "github.com",
	"notion":       "notion.so",
	"figma":        "figma.com",
	"slack":        "slack.com",
	"discord":      "discord.com",
	"dropbox":      "dropbox.com",
	"adobe":        "adobe.com",
	"microsoft":    "microsoft.com",
	"google":       "google.com",
	"amazon":       "amazon.com",
	"apple":        "apple.com",
	"twitter":      "twitter.com",
	"linkedin":     "linkedin.com",
	"zoom":         "zoom.us",
	"openai":       "openai.com",
	"chatgpt":      "openai.com",
	"copilot":      "github.com",
	"cursor":       "cursor.sh",
	"vercel":       "vercel.com",
	"railway":      "railway.app",
	"heroku":       "heroku.com",
	"digitalocean": "digitalocean.com",
	"aws":          "aws.amazon.com",
	"cloudflare":   "cloudflare.com",
	"stripe":       "stripe.com",
	"paypal":       "paypal.com",
	"twitch":       "twitch.tv",
	"hulu":         "hulu.com",
	"disney":       "disneyplus.com",
	"hbo":          "hbomax.com",
	"paramount":    "paramountplus.com",
	"peacock":      "peacocktv.com",
	"crunchyroll":  "crunchyroll.com",
	"bilibili":     "bilibili.com",
	"iqiyi":        "iqiyi.com",
	"youku":        "youku.com",
	"tencent":      "qq.com",
	"weixin":       "weixin.qq.com",
	"wechat":       "weixin.qq.com",
	"alipay":       "alipay.com",
	"jd":           "jd.com",
	"taobao":       "taobao.com",
	"meituan":      "meituan.com",
	"didi":         "didiglobal.com",
	"baidu":        "baidu.com",
	"bytedance":    "bytedance.com",
	"douyin":       "douyin.com",
	"tiktok":       "tiktok.com",
	"credit":       "visa.com",
	"visa":         "visa.com",
	"mastercard":   "mastercard.com",
	"bank":         "chase.com",
	"crypto":       "bitcoin.org",
	"bitcoin":      "bitcoin.org",
	"ethereum":     "ethereum.org",
	"usdt":         "tether.to",
}

// faviconSearch 处理 favicon/logo 远端增强搜索。
// 注意： 该接口会访问外部站点，必须保留限流、短缓存和结果数量上限。
func faviconSearch(e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	if e.Auth == nil {
		return e.UnauthorizedError(tr(locale, "请先登录", "Please sign in first"), nil)
	}
	values := e.Request.URL.Query()
	query := strings.TrimSpace(firstNonEmpty(values.Get("search"), values.Get("q")))
	if query == "" {
		return e.BadRequestError(tr(locale, "请输入要搜索的名称", "Enter a name to search"), nil)
	}
	if len([]rune(query)) > 80 {
		return e.BadRequestError(tr(locale, "搜索关键词不能超过 80 个字符", "Search keyword cannot exceed 80 characters"), nil)
	}

	kind := values.Get("kind")
	if kind != "icon" {
		kind = "logo"
	}

	if retryAfter := checkFaviconRateLimit(e); retryAfter > 0 {
		e.Response.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		return e.JSON(http.StatusTooManyRequests, rateLimitedResponse{
			Code:    "RATE_LIMITED",
			Message: tr(locale, "请求过于频繁，请稍后再试", "Too many requests. Please try again later"),
		})
	}

	cacheKey := kind + ":" + strings.ToLower(query)
	bypassCache := values.Get("nocache") == "1" || values.Get("noCache") == "1" || values.Get("force") == "1" || values.Get("refresh") == "1"
	if !bypassCache {
		if imageURLs, ok := getFaviconCache(cacheKey); ok {
			// 搜索结果是用户私有响应但不含敏感 token，短缓存能降低同一关键词反复外部抓取。
			setPrivateShortCache(e)
			return e.JSON(http.StatusOK, faviconSearchResponse{ImageURLs: imageURLs, Kind: kind})
		}
	}

	imageURLs := searchFaviconImages(query, kind)
	if len(imageURLs) > 0 {
		setFaviconCache(cacheKey, imageURLs)
	}
	setPrivateShortCache(e)
	return e.JSON(http.StatusOK, faviconSearchResponse{ImageURLs: imageURLs, Kind: kind})
}

// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// checkFaviconRateLimit 对 favicon 搜索做内存级限流。
// 注意： 这是单进程保护；多实例部署时需要在网关或共享存储层补全限流。
func checkFaviconRateLimit(e *core.RequestEvent) int {
	maxRequests := envInt("FAVICON_SEARCH_RATE_LIMIT_MAX", 30)
	windowMs := envInt("FAVICON_SEARCH_RATE_LIMIT_WINDOW_MS", 60000)
	if maxRequests <= 0 || windowMs <= 0 || e.Auth == nil {
		return 0
	}
	key := e.Auth.Id + ":" + clientIP(e.Request)
	now := time.Now()

	faviconRateLimitMu.Lock()
	defer faviconRateLimitMu.Unlock()

	bucket := faviconRateLimitData[key]
	if bucket.ResetAt.IsZero() || now.After(bucket.ResetAt) {
		faviconRateLimitData[key] = faviconRateBucket{Count: 1, ResetAt: now.Add(time.Duration(windowMs) * time.Millisecond)}
		return 0
	}
	if bucket.Count >= maxRequests {
		return maxInt(1, int(time.Until(bucket.ResetAt).Seconds()))
	}
	bucket.Count++
	faviconRateLimitData[key] = bucket
	return 0
}

// clientIP 从代理头或 RemoteAddr 提取客户端 IP。
func clientIP(req *http.Request) string {
	if forwarded := strings.TrimSpace(req.Header.Get("x-forwarded-for")); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if realIP := strings.TrimSpace(req.Header.Get("x-real-ip")); realIP != "" {
		return realIP
	}
	host := req.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx > -1 {
		return host[:idx]
	}
	return host
}

// getFaviconCache 读取 favicon 短期缓存，并返回副本防止调用方修改共享切片。
func getFaviconCache(key string) ([]string, bool) {
	faviconCacheMu.Lock()
	defer faviconCacheMu.Unlock()
	cached, ok := faviconCache[key]
	if !ok || time.Now().After(cached.ExpiresAt) {
		delete(faviconCache, key)
		return nil, false
	}
	return append([]string(nil), cached.ImageURLs...), true
}

// setFaviconCache 写入 favicon 短期缓存。
func setFaviconCache(key string, imageURLs []string) {
	faviconCacheMu.Lock()
	defer faviconCacheMu.Unlock()
	faviconCache[key] = cachedFaviconResult{
		ExpiresAt: time.Now().Add(5 * time.Minute),
		ImageURLs: append([]string(nil), imageURLs...),
	}
}

// setPrivateShortCache 设置用户私有短缓存。
// Vary: Authorization 防止共享缓存把某个用户的搜索结果复用给其他会话。
func setPrivateShortCache(e *core.RequestEvent) {
	e.Response.Header().Set("Cache-Control", "private, max-age=300")
	e.Response.Header().Set("Vary", "Authorization")
}

// searchFaviconImages 聚合搜索引擎、站点元信息和确定性 favicon URL。
// PERF： 当前按请求实时抓取外部页面；未来可把解析结果落入后端缓存或队列，降低外部网络抖动。
func searchFaviconImages(query string, kind string) []string {
	searchTerm := url.QueryEscape(strings.TrimSpace(query + " " + kind))
	timeout := 5 * time.Second
	maxResults := 24
	imageURLs := []string{}

	if html, err := fetchHTML("https://www.google.com/search?q="+searchTerm+"&tbm=isch&tbs=iar:xw,ift:png", timeout); err == nil {
		imageURLs = extractImageURLsFromHTML(html)
	}
	if len(imageURLs) < 8 {
		// 搜索引擎结果不稳定，因此再用 Brave 和站点自有 icon/meta 作为补充来源。
		if html, err := fetchHTML("https://search.brave.com/search?q="+searchTerm, timeout); err == nil {
			imageURLs = uniqueStrings(append(imageURLs, extractImageURLsFromHTML(html)...))
		}
	}

	fallbackTlds := []string{"com", "io", "co"}
	if kind == "logo" {
		fallbackTlds = []string{"com", "io", "co", "app", "org"}
	}
	if len(imageURLs) < maxResults {
		domains := buildFaviconCandidateDomains(query, fallbackTlds)
		siteURLs := []string{}
		for _, domain := range domains {
			if len(siteURLs) >= 16 {
				break
			}
			if html, err := fetchHTML("https://"+domain, timeout); err == nil {
				siteURLs = append(siteURLs, extractSiteAssetURLs(html, "https://"+domain, kind)...)
			}
		}
		imageURLs = uniqueStrings(append(imageURLs, siteURLs...))
		imageURLs = uniqueStrings(append(imageURLs, generateFaviconURLs(query, fallbackTlds)...))
	}

	if len(imageURLs) > maxResults {
		return imageURLs[:maxResults]
	}
	return imageURLs
}

// fetchHTML 拉取外部 HTML，并限制响应体大小。
// 该函数服务于增强搜索，失败应由调用方降级处理，不应中断主业务。
func fetchHTML(endpoint string, timeout time.Duration) (string, error) {
	client := http.Client{Timeout: timeout}
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	// HTML 只用于正则提取图片 URL，1MiB 上限足够覆盖搜索结果页并避免外部页面拖垮内存。
	return string(body), nil
}

// generateFaviconURLs 生成确定性的 favicon 候选 URL。
func generateFaviconURLs(query string, fallbackTlds []string) []string {
	domains := buildFaviconCandidateDomains(query, fallbackTlds)
	urls := make([]string, 0, len(domains)*4)
	for _, domain := range domains {
		urls = append(urls,
			"https://"+domain+"/favicon.ico",
			"https://"+domain+"/apple-touch-icon.png",
			"https://www.google.com/s2/favicons?domain="+domain+"&sz=128",
			"https://icons.duckduckgo.com/ip3/"+domain+".ico",
		)
	}
	return uniqueStrings(urls)
}

// buildFaviconCandidateDomains 从搜索词推导可能的品牌域名。
func buildFaviconCandidateDomains(query string, fallbackTlds []string) []string {
	domains := []string{}
	if domain := extractDomainFromQuery(query); domain != "" {
		domains = append(domains, domain)
	}
	keyword := normalizeFaviconKeyword(query)
	if keyword != "" {
		if known, ok := knownFaviconDomains[keyword]; ok {
			domains = append(domains, known)
		}
		for _, tld := range fallbackTlds {
			if tld = strings.TrimSpace(tld); tld != "" {
				domains = append(domains, keyword+"."+tld)
			}
		}
	}

	out := []string{}
	seen := map[string]struct{}{}
	for _, domain := range domains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		if domain == "" {
			continue
		}
		if _, ok := seen[domain]; !ok {
			seen[domain] = struct{}{}
			out = append(out, domain)
		}
		parts := strings.Split(domain, ".")
		if len(parts) == 2 && !strings.HasPrefix(domain, "www.") {
			www := "www." + domain
			if _, ok := seen[www]; !ok {
				seen[www] = struct{}{}
				out = append(out, www)
			}
		}
	}
	return out
}

func normalizeFaviconKeyword(input string) string {
	return strings.ToLower(strings.Join(strings.Fields(input), ""))
}

func extractDomainFromQuery(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	if strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "https://") {
		parsed, err := url.Parse(input)
		if err != nil {
			return ""
		}
		return parsed.Hostname()
	}
	host := strings.ToLower(strings.Split(input, "/")[0])
	// 只接受普通域名形态，不解析裸 IP/端口；这里是 favicon 候选生成，不应扩大成通用 URL 解析器。
	if matched, _ := regexp.MatchString(`^[a-z0-9.-]+\.[a-z]{2,}$`, host); matched {
		return host
	}
	return ""
}

func extractImageURLsFromHTML(html string) []string {
	html = decodeURLEscapes(html)
	urls := []string{}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`https://encrypted-tbn\d+\.gstatic\.com/images\?[^"'\s<>]+`),
		regexp.MustCompile(`https://imgs\.search\.brave\.com/[^"'\s<>]+`),
		regexp.MustCompile(`https?://[^"'\s<>]+?\.(?:png|jpe?g|webp|gif|svg|ico)(?:\?[^"'\s<>]*)?`),
	}
	for _, pattern := range patterns {
		for _, match := range pattern.FindAllString(html, -1) {
			if isLikelyImageURL(match) {
				urls = append(urls, match)
			}
		}
	}
	return uniqueStrings(urls)
}

func extractSiteAssetURLs(html string, baseURL string, kind string) []string {
	html = decodeURLEscapes(html)
	urls := []string{}
	linkRe := regexp.MustCompile(`(?is)<link\b[^>]*>`)
	metaRe := regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	for _, tag := range linkRe.FindAllString(html, -1) {
		rel := strings.ToLower(htmlAttribute(tag, "rel"))
		if strings.Contains(rel, "icon") {
			if resolved := resolveAssetURL(htmlAttribute(tag, "href"), baseURL); resolved != "" {
				urls = append(urls, resolved)
			}
		}
	}
	for _, tag := range metaRe.FindAllString(html, -1) {
		key := strings.ToLower(firstNonEmpty(htmlAttribute(tag, "property"), htmlAttribute(tag, "name")))
		if key == "og:image" || key == "twitter:image" || key == "twitter:image:src" || key == "msapplication-tileimage" {
			if resolved := resolveAssetURL(htmlAttribute(tag, "content"), baseURL); resolved != "" {
				urls = append(urls, resolved)
			}
		}
	}
	_ = kind
	return uniqueStrings(urls)
}

func htmlAttribute(tag string, attr string) string {
	// 轻量解析单个 HTML tag 属性；完整 HTML parser 成本更高，而这里的抓取结果本来就是尽力增强。
	pattern := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(attr) + `\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>` + "`" + `]+))`)
	match := pattern.FindStringSubmatch(tag)
	if len(match) == 0 {
		return ""
	}
	for _, group := range match[1:] {
		if group != "" {
			return strings.TrimSpace(group)
		}
	}
	return ""
}

func resolveAssetURL(raw string, baseURL string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "data:") {
		return ""
	}
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if !parsed.IsAbs() {
		base, err := url.Parse(baseURL)
		if err != nil {
			return ""
		}
		parsed = base.ResolveReference(parsed)
	}
	resolved := parsed.String()
	if !isLikelyImageURL(resolved) {
		return ""
	}
	return resolved
}

func decodeURLEscapes(input string) string {
	// 搜索页常把 URL 中的 `=`/`&` 写成 JSON unicode escape；先解开再跑图片 URL 正则。
	return strings.NewReplacer(`\u003d`, "=", `\u003D`, "=", `\u0026`, "&", `\u0026`, "&").Replace(input)
}

func isLikelyImageURL(value string) bool {
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "data:image") {
		return false
	}
	if strings.HasPrefix(lower, "https://www.google.com/s2/favicons?") ||
		strings.HasPrefix(lower, "https://icons.duckduckgo.com/ip3/") ||
		strings.HasPrefix(lower, "https://imgs.search.brave.com/") ||
		(strings.Contains(lower, "encrypted-tbn") && strings.Contains(lower, ".gstatic.com/images?")) {
		return true
	}
	return regexp.MustCompile(`\.(png|jpe?g|webp|gif|svg|ico)(?:[?#].*)?$`).MatchString(lower)
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
