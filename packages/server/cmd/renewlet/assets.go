package main

// assets.go 提供受认证保护的用户上传资产读取接口。
//
// 架构位置：
//   - 图片写入走 PocketBase assets collection。
//   - 前端 AuthorizedImage 通过 `/api/app/assets/{id}` 携带认证读取私有文件。
//
// 注意： 不要直接暴露 PocketBase 文件公开 URL；Logo/Icon 可能属于用户私有数据，必须校验 record.user。
import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// handleAssetRead 读取当前用户拥有的资产文件并写入响应流。
// Cache-Control 使用 private immutable，是因为文件 ID 对应不可变上传结果，但不能被共享缓存复用。
func handleAssetRead(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	id := strings.TrimSpace(e.Request.PathValue("id"))
	if id == "" {
		return e.BadRequestError(tr(locale, "资产 ID 无效", "Invalid asset ID"), nil)
	}

	record, err := app.FindRecordById("assets", id)
	if err != nil {
		return e.NotFoundError(tr(locale, "资产不存在", "Asset not found"), err)
	}
	if record.GetString("user") != e.Auth.Id {
		// 对越权访问返回 404 而非 403，避免泄漏其他用户资产 ID 是否存在。
		return e.NotFoundError(tr(locale, "资产不存在", "Asset not found"), nil)
	}

	filename := record.GetString("file")
	if filename == "" {
		return e.NotFoundError(tr(locale, "资产文件不存在", "Asset file not found"), nil)
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return e.InternalServerError(tr(locale, "无法打开文件系统", "Could not open file storage"), err)
	}
	defer fsys.Close()

	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + filename)
	if err != nil {
		return e.NotFoundError(tr(locale, "资产文件不存在", "Asset file not found"), err)
	}
	defer reader.Close()

	contentType := strings.TrimSpace(record.GetString("mimeType"))
	if contentType == "" {
		contentType = reader.ContentType()
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	headers := e.Response.Header()
	headers.Set("Content-Type", contentType)
	headers.Set("Cache-Control", "private, max-age=31536000, immutable")
	headers.Set("X-Content-Type-Options", "nosniff")
	if strings.EqualFold(strings.TrimSpace(strings.Split(contentType, ";")[0]), "image/svg+xml") {
		// SVG 是可执行载体，单独加沙箱 CSP，允许内联样式但禁止脚本/外部对象。
		headers.Set("Content-Security-Policy", "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; sandbox")
	}
	if size := reader.Size(); size >= 0 {
		headers.Set("Content-Length", strconv.FormatInt(size, 10))
	}

	e.Response.WriteHeader(http.StatusOK)
	_, copyErr := io.Copy(e.Response, reader)
	return copyErr
}
