package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func buildCloudBackupExportZip(app core.App, user *core.Record) ([]byte, time.Time, error) {
	exportedAt := time.Now().UTC()
	payload, assets, err := buildCloudBackupExportPayload(app, user, exportedAt)
	if err != nil {
		return nil, exportedAt, err
	}
	var buffer bytes.Buffer
	zipWriter := zip.NewWriter(&buffer)
	for _, asset := range assets {
		writer, err := zipWriter.Create(asset.Path)
		if err != nil {
			_ = zipWriter.Close()
			return nil, exportedAt, err
		}
		if _, err := writer.Write(asset.Content); err != nil {
			_ = zipWriter.Close()
			return nil, exportedAt, err
		}
	}
	if err := writeCloudBackupZipJSON(zipWriter, "data.json", payload); err != nil {
		_ = zipWriter.Close()
		return nil, exportedAt, err
	}
	payloadData, ok := payload["data"].(map[string]interface{})
	if !ok {
		_ = zipWriter.Close()
		return nil, exportedAt, errors.New("CLOUD_BACKUP_EXPORT_DATA_INVALID")
	}
	subscriptions, ok := payloadData["subscriptions"].([]interface{})
	if !ok {
		_ = zipWriter.Close()
		return nil, exportedAt, errors.New("CLOUD_BACKUP_EXPORT_SUBSCRIPTIONS_INVALID")
	}
	manifest := map[string]interface{}{
		"kind":          "renewlet-export",
		"schemaVersion": 1,
		"exportedAt":    exportedAt.Format(time.RFC3339Nano),
		"subscriptions": len(subscriptions),
		"assets":        len(assets),
	}
	if err := writeCloudBackupZipJSON(zipWriter, "manifest.json", manifest); err != nil {
		_ = zipWriter.Close()
		return nil, exportedAt, err
	}
	if err := zipWriter.Close(); err != nil {
		return nil, exportedAt, err
	}
	return buffer.Bytes(), exportedAt, nil
}

type cloudBackupExportAsset struct {
	ID        string
	Path      string
	MimeType  string
	SizeBytes int64
	Content   []byte
}

func buildCloudBackupExportPayload(app core.App, user *core.Record, exportedAt time.Time) (map[string]interface{}, []cloudBackupExportAsset, error) {
	rows, err := listImportExistingSubscriptions(app, user.Id)
	if err != nil {
		return nil, nil, err
	}
	assets := []cloudBackupExportAsset{}
	subscriptions := make([]interface{}, 0, len(rows))
	for _, row := range rows {
		subscription := subscriptionAPIFromRecord(row)
		if logo, ok := subscription["logo"].(string); ok {
			if assetID := privateAssetIDFromPath(logo); assetID != "" {
				asset, err := readCloudBackupAsset(app, user.Id, assetID)
				if err == nil {
					subscription["logo"] = asset.Path
					assets = append(assets, asset)
				} else {
					delete(subscription, "logo")
				}
			}
		}
		subscriptions = append(subscriptions, subscription)
	}
	data := map[string]interface{}{
		"subscriptions": subscriptions,
	}
	// 云快照只导出可恢复的产品资料；账号安全主密钥和 session/MFA/passkey/recovery/ticket 都必须由用户重新建立。
	if settings, ok, err := cloudBackupExportSettings(app, user); err != nil {
		return nil, nil, err
	} else if ok {
		data["settings"] = settings
	}
	if config, ok, err := cloudBackupExportCustomConfig(app, user); err != nil {
		return nil, nil, err
	} else if ok {
		data["customConfig"] = config
	}
	if len(assets) > 0 {
		exportAssets := make([]interface{}, 0, len(assets))
		for _, asset := range assets {
			exportAssets = append(exportAssets, map[string]interface{}{
				"id":        asset.ID,
				"path":      asset.Path,
				"mimeType":  asset.MimeType,
				"sizeBytes": asset.SizeBytes,
			})
		}
		data["assets"] = exportAssets
	}
	return map[string]interface{}{
		"kind":          "renewlet-export",
		"schemaVersion": 1,
		"exportedAt":    exportedAt.Format(time.RFC3339Nano),
		"data":          data,
	}, assets, nil
}

func cloudBackupExportSettings(app core.App, user *core.Record) (map[string]interface{}, bool, error) {
	record, err := app.FindFirstRecordByFilter("settings", "user = {:user}", dbx.Params{"user": user.Id})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	settings := settingsFromRecord(record)
	data, err := json.Marshal(settings)
	if err != nil {
		return nil, false, err
	}
	var out map[string]interface{}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, false, err
	}
	// 普通云快照永远剔除通知、AI、Webhook 等 secret；新增外部渠道字段必须进入这组边界。
	for _, key := range []string{
		"testPhone", "telegramBotToken", "telegramChatId", "notifyxApiKey", "webhookUrl", "webhookHeaders", "webhookPayload",
		"wechatWebhookUrl", "wechatAtPhones", "smtpHost", "smtpPort", "smtpSecure", "smtpUser", "smtpPassword",
		"smtpFrom", "smtpReplyTo", "recipientEmail", "barkServerUrl", "barkDeviceKey", "serverchanSendKey",
		"discordWebhookUrl", "discordBotUsername", "discordBotAvatarUrl", "pushplusToken",
	} {
		delete(out, key)
	}
	if ai, ok := out["aiRecognition"].(map[string]interface{}); ok {
		ai["baseUrl"] = ""
		ai["apiKey"] = ""
	}
	return out, true, nil
}

func cloudBackupExportCustomConfig(app core.App, user *core.Record) (interface{}, bool, error) {
	record, err := app.FindFirstRecordByFilter("custom_configs", "user = {:user}", dbx.Params{"user": user.Id})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	data, err := jsonBytesFromValue(record.Get("config"))
	if err != nil || len(bytes.TrimSpace(data)) == 0 {
		return nil, false, err
	}
	var config interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, false, err
	}
	return config, true, nil
}

func readCloudBackupAsset(app core.App, userID string, assetID string) (cloudBackupExportAsset, error) {
	record, err := app.FindRecordById("assets", assetID)
	if err != nil {
		return cloudBackupExportAsset{}, err
	}
	if record.GetString("user") != userID {
		return cloudBackupExportAsset{}, errors.New("ASSET_NOT_FOUND")
	}
	filename := record.GetString("file")
	if filename == "" {
		return cloudBackupExportAsset{}, errors.New("ASSET_FILE_MISSING")
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		return cloudBackupExportAsset{}, err
	}
	defer fsys.Close()
	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + filename)
	if err != nil {
		return cloudBackupExportAsset{}, err
	}
	defer reader.Close()
	content, err := io.ReadAll(io.LimitReader(reader, maxImageBytes+1))
	if err != nil {
		return cloudBackupExportAsset{}, err
	}
	if len(content) > maxImageBytes {
		return cloudBackupExportAsset{}, errors.New("ASSET_TOO_LARGE")
	}
	mimeType := strings.TrimSpace(record.GetString("mimeType"))
	if mimeType == "" {
		mimeType = reader.ContentType()
	}
	return cloudBackupExportAsset{
		ID:        assetID,
		Path:      "assets/" + assetID + extensionFromCloudBackupMime(mimeType, filename),
		MimeType:  mimeType,
		SizeBytes: int64(len(content)),
		Content:   content,
	}, nil
}

func writeCloudBackupZipJSON(zipWriter *zip.Writer, name string, value interface{}) error {
	writer, err := zipWriter.Create(name)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func privateAssetIDFromPath(value string) string {
	const prefix = "/api/app/assets/"
	if !strings.HasPrefix(value, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, prefix))
}

func extensionFromCloudBackupMime(mimeType string, filename string) string {
	mimeType = strings.ToLower(mimeType)
	switch {
	case strings.Contains(mimeType, "svg"):
		return ".svg"
	case strings.Contains(mimeType, "webp"):
		return ".webp"
	case strings.Contains(mimeType, "jpeg"):
		return ".jpg"
	case strings.Contains(mimeType, "png"):
		return ".png"
	case strings.Contains(mimeType, "icon"):
		return ".ico"
	default:
		ext := path.Ext(filename)
		if len(ext) > 8 {
			return ""
		}
		return ext
	}
}
