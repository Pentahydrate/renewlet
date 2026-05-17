package main

// thesvg_search.go 查询内嵌 The SVG 品牌图标索引。
//
// 架构位置：索引数据来自 embedded static 包，route 只返回前端需要的窄 DTO，
// 避免客户端 bundle 持有完整索引和第三方 CDN 拼接规则。
//
// 注意： 调整 iconUrl 拼接规则会影响前端 logo 选择器和 CSP 图片来源。
import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	appstatic "github.com/zhiyingzzhou/renewlet/packages/server/internal/static"
)

// theSvgIcon 是内嵌 The SVG 索引的原始条目。
type theSvgIcon struct {
	Slug       string   `json:"slug"`
	Title      string   `json:"title"`
	Aliases    []string `json:"aliases"`
	Categories []string `json:"categories"`
	Variant    string   `json:"variant"`
	Hex        string   `json:"hex,omitempty"`
	License    string   `json:"license,omitempty"`
	URL        string   `json:"url,omitempty"`
	Guidelines string   `json:"guidelines,omitempty"`
}

// apiTheSvgIcon 是返回给前端的 The SVG 图标条目。
// IconURL 在后端拼出，避免前端了解第三方 CDN 路径规则。
type apiTheSvgIcon struct {
	Slug       string   `json:"slug"`
	Title      string   `json:"title"`
	IconURL    string   `json:"iconUrl"`
	Aliases    []string `json:"aliases"`
	Categories []string `json:"categories"`
	Hex        string   `json:"hex,omitempty"`
	License    string   `json:"license,omitempty"`
	URL        string   `json:"url,omitempty"`
	Guidelines string   `json:"guidelines,omitempty"`
}

var theSvgIcons = loadTheSvgIndex()

func loadTheSvgIndex() []theSvgIcon {
	var icons []theSvgIcon
	if err := json.Unmarshal(appstatic.TheSVGIndex, &icons); err != nil {
		// embedded 索引损坏时降级为空结果，让服务仍可启动，便于通过健康检查发现问题后修复镜像。
		return []theSvgIcon{}
	}
	return icons
}

// theSvgSearch 搜索内嵌 The SVG 品牌索引。
// 为什么走后端：索引体积和 CDN URL 规则都不应泄漏到客户端 bundle 的热路径。
func theSvgSearch(e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	values := e.Request.URL.Query()
	query := strings.ToLower(strings.TrimSpace(firstNonEmpty(values.Get("search"), values.Get("q"))))
	if query == "" {
		return e.BadRequestError(tr(locale, "请输入要搜索的名称", "Enter a name to search"), nil)
	}
	if len([]rune(query)) > 80 {
		return e.BadRequestError(tr(locale, "搜索关键词不能超过 80 个字符", "Search keyword cannot exceed 80 characters"), nil)
	}
	limit := clampInt(parseInt(values.Get("limit"), 32), 1, 48)

	icons := make([]apiTheSvgIcon, 0, limit)
	for _, icon := range theSvgIcons {
		if !matchesIcon(icon, query) {
			continue
		}
		icons = append(icons, apiTheSvgIcon{
			Slug:       icon.Slug,
			Title:      icon.Title,
			IconURL:    fmt.Sprintf("https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/%s/%s.svg", icon.Slug, icon.Variant),
			Aliases:    icon.Aliases,
			Categories: icon.Categories,
			Hex:        icon.Hex,
			License:    icon.License,
			URL:        icon.URL,
			Guidelines: icon.Guidelines,
		})
		if len(icons) >= limit {
			// 索引按生成脚本稳定顺序排列；达到 limit 即停止，避免每次搜索都扫描并分配完整结果集。
			break
		}
	}
	setPrivateShortCache(e)
	return e.JSON(http.StatusOK, theSvgIconsResponse{Icons: icons})
}

func matchesIcon(icon theSvgIcon, query string) bool {
	if strings.Contains(strings.ToLower(icon.Slug), query) || strings.Contains(strings.ToLower(icon.Title), query) {
		return true
	}
	for _, alias := range icon.Aliases {
		if strings.Contains(strings.ToLower(alias), query) {
			return true
		}
	}
	for _, category := range icon.Categories {
		if strings.Contains(strings.ToLower(category), query) {
			return true
		}
	}
	return false
}
