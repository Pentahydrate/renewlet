package main

// schema.go 维护 PocketBase collection 与应用级设置的强约束。
//
// 架构位置：
//   - migration/bootstrap 调用 ensureSchema，让本地开发、首次部署和升级路径复用同一套 schema 收敛。
//   - record hooks 与前端 Zod schema 依赖这些字段名、枚举值和索引语义。
//
// 注意： 字段重命名、索引唯一性和枚举收窄都会影响既有数据，必须按破坏性迁移处理。
import (
	"fmt"
	"net/mail"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	maxLogoReferenceLength       = 2048
	maxSubscriptionPrice         = 1_000_000_000
	maxSubscriptionTags          = 100
	maxSubscriptionTagLength     = 40
	maxSubscriptionTagsFieldSize = 16 * 1024
	subscriptionCleanupPageSize  = 500
)

// ensureSchema 创建/修正 PocketBase collection schema。
// 注意： 修改字段名会影响前端 schema、record hooks 和历史数据迁移，必须作为破坏性迁移处理。
func ensureSchema(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	if err := configureAppSettings(app); err != nil {
		return err
	}
	users.CreateRule = nil
	ownerRule := "id = @request.auth.id && @request.auth.banned = false"
	users.ListRule = types.Pointer(ownerRule)
	users.ViewRule = types.Pointer(ownerRule)
	users.UpdateRule = types.Pointer(ownerRule)
	users.DeleteRule = types.Pointer(ownerRule)
	if err := upsertField(users, &core.TextField{Name: "role", Max: 32}); err != nil {
		return err
	}
	if err := upsertField(users, &core.BoolField{Name: "banned"}); err != nil {
		return err
	}
	if err := upsertField(users, &core.TextField{Name: "banReason", Max: 500}); err != nil {
		return err
	}
	if err := app.Save(users); err != nil {
		return err
	}

	if err := ensureSubscriptionsCollection(app, users); err != nil {
		return err
	}
	if err := ensureSettingsCollection(app, users); err != nil {
		return err
	}
	if err := ensureCustomConfigsCollection(app, users); err != nil {
		return err
	}
	if err := ensureAssetsCollection(app, users); err != nil {
		return err
	}
	if err := ensureNotificationJobsCollection(app, users); err != nil {
		return err
	}
	if err := ensureCalendarFeedsCollection(app, users); err != nil {
		return err
	}
	if err := backfillAutodates(app, "subscriptions", "settings", "custom_configs", "assets", "notification_jobs", "calendar_feeds"); err != nil {
		return err
	}
	if err := deleteLegacyHashOnlyCalendarFeeds(app); err != nil {
		return err
	}
	return cleanupInvalidSubscriptionLogos(app)
}

func configureAppSettings(app core.App) error {
	settings := app.Settings()
	settings.Meta.AppName = envString("APP_NAME", "Renewlet")
	if appURL := strings.TrimSpace(os.Getenv("APP_URL")); appURL != "" {
		settings.Meta.AppURL = appURL
	}

	if from := strings.TrimSpace(os.Getenv("SMTP_FROM")); from != "" {
		if address, err := mail.ParseAddress(from); err == nil {
			if address.Name != "" {
				settings.Meta.SenderName = address.Name
			}
			settings.Meta.SenderAddress = address.Address
		}
	}

	if smtpHost := strings.TrimSpace(os.Getenv("SMTP_HOST")); smtpHost != "" {
		settings.SMTP.Enabled = true
		settings.SMTP.Host = smtpHost
		settings.SMTP.Port = envInt("SMTP_PORT", 587)
		settings.SMTP.Username = strings.TrimSpace(os.Getenv("SMTP_USER"))
		settings.SMTP.Password = os.Getenv("SMTP_PASSWORD")
		settings.SMTP.TLS = envBool("SMTP_TLS", envBool("SMTP_SECURE", false))
		settings.SMTP.AuthMethod = strings.TrimSpace(os.Getenv("SMTP_AUTH_METHOD"))
		if settings.SMTP.AuthMethod == "" {
			settings.SMTP.AuthMethod = "PLAIN"
		}
	}

	settings.RateLimits.Enabled = true

	if backupCron := strings.TrimSpace(os.Getenv("BACKUPS_CRON")); backupCron != "" {
		settings.Backups.Cron = backupCron
		settings.Backups.CronMaxKeep = envInt("BACKUPS_CRON_MAX_KEEP", 3)
	}

	return app.Save(settings)
}

func ensureField(collection *core.Collection, field core.Field) error {
	return upsertField(collection, field)
}

func upsertField(collection *core.Collection, field core.Field) error {
	existing := collection.Fields.GetByName(field.GetName())
	if existing != nil {
		if existing.Type() != field.Type() {
			return fmt.Errorf("collection %q field %q type mismatch: existing %q, expected %q", collection.Name, field.GetName(), existing.Type(), field.Type())
		}
		// 保留字段 id/system 标记，让 schema 收敛不会被 PocketBase 视为删除后重建字段。
		field.SetId(existing.GetId())
		if existing.GetSystem() {
			field.SetSystem(true)
		}
	}
	collection.Fields.Add(field)
	return nil
}

func upsertFieldAllowingTypeReplace(collection *core.Collection, field core.Field, allowedExistingType string) error {
	existing := collection.Fields.GetByName(field.GetName())
	if existing != nil && existing.Type() != field.Type() {
		if existing.Type() != allowedExistingType {
			return fmt.Errorf("collection %q field %q type mismatch: existing %q, expected %q", collection.Name, field.GetName(), existing.Type(), field.Type())
		}
		field.SetId(existing.GetId())
		if existing.GetSystem() {
			field.SetSystem(true)
		}
		collection.Fields.Add(field)
		return nil
	}
	return upsertField(collection, field)
}

func ensureAutodates(collection *core.Collection) error {
	if err := upsertField(collection, &core.AutodateField{Name: "created", OnCreate: true, System: true}); err != nil {
		return err
	}
	return upsertField(collection, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true, System: true})
}

func ensureCollection(app core.App, name string, configure func(*core.Collection) error) error {
	return ensureCollectionWithSave(app, name, func(collection *core.Collection) (bool, error) {
		return false, configure(collection)
	})
}

func ensureCollectionWithSave(app core.App, name string, configure func(*core.Collection) (bool, error)) error {
	collection, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		collection = core.NewBaseCollection(name)
	}
	saveWithoutValidation, err := configure(collection)
	if err != nil {
		return err
	}
	if saveWithoutValidation {
		// 少数兼容迁移需要先保存字段形态，再由 hooks/backfill 修复数据，因此允许跳过 collection validation。
		return app.SaveNoValidate(collection)
	}
	return app.Save(collection)
}

func backfillAutodates(app core.App, names ...string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, name := range names {
		// names 只来自内部常量列表，不接受用户输入；这里用 SQL 是为了一次性补齐旧库的系统时间字段。
		_, err := app.DB().NewQuery(fmt.Sprintf(
			"UPDATE `%s` SET `created` = CASE WHEN `created` = '' THEN {:now} ELSE `created` END, `updated` = CASE WHEN `updated` = '' THEN {:now} ELSE `updated` END",
			name,
		)).Bind(dbx.Params{"now": now}).Execute()
		if err != nil {
			return err
		}
	}
	return nil
}

func cleanupInvalidSubscriptionLogos(app core.App) error {
	for offset := 0; ; offset += subscriptionCleanupPageSize {
		rows, err := app.FindRecordsByFilter("subscriptions", "id != ''", "created", subscriptionCleanupPageSize, offset)
		if err != nil {
			return err
		}
		for _, record := range rows {
			if validateOptionalLogoReference(record.GetString("logo")) == nil {
				continue
			}
			// 破坏性切换只清空不再支持的持久化 Logo 形态；HTTP 外链仍是自托管 HTTP 场景的合法值。
			record.Set("logo", "")
			if err := app.SaveNoValidate(record); err != nil {
				return err
			}
		}
		if len(rows) < subscriptionCleanupPageSize {
			return nil
		}
	}
}

func ownerRules(collection *core.Collection) {
	// 所有业务 collection 都以 user relation 做隔离；route 层管理员能力不能绕过这里的默认 owner 边界。
	listRule := "user = @request.auth.id && @request.auth.banned = false"
	createRule := "@request.auth.id != '' && @request.auth.banned = false && user = @request.auth.id"
	collection.ListRule = types.Pointer(listRule)
	collection.ViewRule = types.Pointer(listRule)
	collection.CreateRule = types.Pointer(createRule)
	collection.UpdateRule = types.Pointer(listRule)
	collection.DeleteRule = types.Pointer(listRule)
}

func userRelation(users *core.Collection) *core.RelationField {
	return &core.RelationField{
		Name:          "user",
		CollectionId:  users.Id,
		CascadeDelete: true,
		MinSelect:     1,
		MaxSelect:     1,
		Required:      true,
	}
}

func ensureSubscriptionsCollection(app core.App, users *core.Collection) error {
	return ensureCollectionWithSave(app, "subscriptions", func(c *core.Collection) (bool, error) {
		ownerRules(c)
		minZero := 0.0
		maxPrice := float64(maxSubscriptionPrice)
		replaceLegacyLogoURLField := false
		if existingLogo := c.Fields.GetByName("logo"); existingLogo != nil && existingLogo.Type() == core.FieldTypeURL {
			replaceLegacyLogoURLField = true
		}
		fields := []core.Field{
			userRelation(users),
			&core.TextField{Name: "name", Required: true, Max: 120},
			&core.TextField{Name: "logo", Max: maxLogoReferenceLength},
			&core.NumberField{Name: "price", Min: &minZero, Max: &maxPrice},
			&core.TextField{Name: "currency", Required: true, Max: 8, Pattern: `^[A-Z]{3}$`},
			&core.SelectField{Name: "billingCycle", Required: true, Values: []string{"weekly", "monthly", "quarterly", "semi-annual", "annual", "custom", "one-time"}},
			&core.NumberField{Name: "customDays", OnlyInt: true, Min: &minZero},
			&core.TextField{Name: "category", Required: true, Max: 80},
			&core.SelectField{Name: "status", Required: true, Values: []string{"trial", "active", "expired", "paused", "cancelled"}},
			&core.BoolField{Name: "pinned"},
			&core.TextField{Name: "paymentMethod", Max: 80},
			&core.TextField{Name: "startDate", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.TextField{Name: "nextBillingDate", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.BoolField{Name: "autoCalculateNextBillingDate"},
			&core.TextField{Name: "trialEndDate", Max: 10, Pattern: `^$|^\d{4}-\d{2}-\d{2}$`},
			&core.URLField{Name: "website"},
			&core.TextField{Name: "notes", Max: 5000},
			&core.JSONField{Name: "tags", MaxSize: maxSubscriptionTagsFieldSize},
			&core.JSONField{Name: "extra", MaxSize: 65536},
			&core.NumberField{Name: "reminderDays", OnlyInt: true, Min: types.Pointer(float64(inheritReminderDays)), Max: types.Pointer(float64(maxReminderDays))},
			&core.BoolField{Name: "repeatReminderEnabled"},
			&core.SelectField{Name: "repeatReminderInterval", Values: []string{"1h", "3h", "6h", "12h", "24h"}},
			&core.SelectField{Name: "repeatReminderWindow", Values: []string{"24h", "48h", "72h", "full"}},
		}
		for _, field := range fields {
			if field.GetName() == "logo" {
				if err := upsertFieldAllowingTypeReplace(c, field, core.FieldTypeURL); err != nil {
					return false, err
				}
				continue
			}
			if err := upsertField(c, field); err != nil {
				return false, err
			}
		}
		if err := ensureAutodates(c); err != nil {
			return false, err
		}
		c.AddIndex("idx_subscriptions_user", false, "user", "")
		c.AddIndex("idx_subscriptions_user_next_billing", false, "user, nextBillingDate", "")
		return replaceLegacyLogoURLField, nil
	})
}

func ensureSettingsCollection(app core.App, users *core.Collection) error {
	return ensureCollection(app, "settings", func(c *core.Collection) error {
		ownerRules(c)
		if err := upsertField(c, userRelation(users)); err != nil {
			return err
		}
		if err := upsertField(c, &core.JSONField{Name: "settings", MaxSize: 65536}); err != nil {
			return err
		}
		if err := ensureAutodates(c); err != nil {
			return err
		}
		// 每个用户只能有一份 settings；route/service 用 upsert 语义，唯一索引是并发写入的最终保护。
		c.AddIndex("idx_settings_user_unique", true, "user", "")
		return nil
	})
}

func ensureCustomConfigsCollection(app core.App, users *core.Collection) error {
	return ensureCollection(app, "custom_configs", func(c *core.Collection) error {
		ownerRules(c)
		if err := upsertField(c, userRelation(users)); err != nil {
			return err
		}
		if err := upsertField(c, &core.JSONField{Name: "config", MaxSize: 65536}); err != nil {
			return err
		}
		if err := ensureAutodates(c); err != nil {
			return err
		}
		// 自定义配置与 settings 分开存储，避免大 JSON 配置保存失败时污染通知/主题等核心设置。
		c.AddIndex("idx_custom_configs_user_unique", true, "user", "")
		return nil
	})
}

func ensureAssetsCollection(app core.App, users *core.Collection) error {
	return ensureCollection(app, "assets", func(c *core.Collection) error {
		ownerRules(c)
		fields := []core.Field{
			userRelation(users),
			&core.SelectField{Name: "kind", Required: true, Values: []string{"logo", "icon"}},
			// Protected 文件只能通过自定义 /api/app/assets/{id} 读取，确保每次访问都重新校验 owner。
			&core.FileField{Name: "file", MaxSelect: 1, MaxSize: 2 * 1024 * 1024, MimeTypes: []string{"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"}, Protected: true, Required: true},
			&core.TextField{Name: "mimeType", Max: 100},
			&core.NumberField{Name: "sizeBytes", OnlyInt: true, Min: types.Pointer(0.0)},
			&core.TextField{Name: "originalName", Max: 255},
		}
		for _, field := range fields {
			if err := upsertField(c, field); err != nil {
				return err
			}
		}
		if err := ensureAutodates(c); err != nil {
			return err
		}
		c.AddIndex("idx_assets_user", false, "user", "")
		return nil
	})
}

func ensureNotificationJobsCollection(app core.App, users *core.Collection) error {
	return ensureCollection(app, "notification_jobs", func(c *core.Collection) error {
		ownerRules(c)
		fields := []core.Field{
			userRelation(users),
			&core.TextField{Name: "scheduledLocalDate", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.TextField{Name: "scheduledLocalTime", Required: true, Max: 5, Pattern: `^\d{2}:\d{2}$`},
			&core.TextField{Name: "timeZone", Required: true, Max: 128},
			&core.TextField{Name: "scheduledInstantUtc", Required: true, Max: 40},
			&core.SelectField{Name: "status", Required: true, Values: []string{"pending", "sending", "sent", "failed", "skipped"}},
			&core.NumberField{Name: "attempts", OnlyInt: true, Min: types.Pointer(0.0)},
			&core.TextField{Name: "lastError", Max: 2000},
			&core.JSONField{Name: "result", MaxSize: 65536},
		}
		for _, field := range fields {
			if err := upsertField(c, field); err != nil {
				return err
			}
		}
		if err := ensureAutodates(c); err != nil {
			return err
		}
		// 同一用户/本地日期/本地时间/时区只允许一个 job，是 cron 重试和并发 tick 的幂等锁。
		c.AddIndex("idx_notification_jobs_user_local_date", false, "user, scheduledLocalDate", "")
		c.AddIndex("idx_notification_jobs_user_local_time_unique", true, "user, scheduledLocalDate, scheduledLocalTime, timeZone", "")
		return nil
	})
}

func ensureCalendarFeedsCollection(app core.App, users *core.Collection) error {
	return ensureCollection(app, "calendar_feeds", func(c *core.Collection) error {
		ownerRules(c)
		if err := upsertField(c, userRelation(users)); err != nil {
			return err
		}
		if err := upsertField(c, &core.SelectField{Name: "scope", Required: true, Values: []string{"all", "subscription"}}); err != nil {
			return err
		}
		if err := upsertField(c, &core.TextField{Name: "subscriptionId", Max: 128}); err != nil {
			return err
		}
		// ICS 客户端无法携带 Renewlet 登录态；保存可恢复 token，换取刷新后仍可复制订阅 URL 的体验。
		if err := upsertField(c, &core.TextField{Name: "token", Required: true, Max: 128, Pattern: `^[A-Za-z0-9_-]{43}$`}); err != nil {
			return err
		}
		c.Fields.RemoveByName("tokenHash")
		if err := ensureAutodates(c); err != nil {
			return err
		}
		removeIndex(c, "idx_calendar_feeds_user_unique")
		removeIndex(c, "idx_calendar_feeds_token_hash_unique")
		removeIndex(c, "idx_calendar_feeds_user_subscription")
		// token 是公开 ICS route 的 bearer secret；用户维度唯一索引保护管理端展示，token 唯一索引保护公开读取。
		c.AddIndex("idx_calendar_feeds_user_all_unique", true, "user", "scope = 'all'")
		c.AddIndex("idx_calendar_feeds_token_unique", true, "token", "")
		c.AddIndex("idx_calendar_feeds_user_subscription_unique", true, "user, subscriptionId", "scope = 'subscription'")
		return nil
	})
}

func removeIndex(collection *core.Collection, name string) {
	needle := "`" + name + "`"
	indexes := collection.Indexes[:0]
	for _, index := range collection.Indexes {
		if !strings.Contains(index, needle) {
			indexes = append(indexes, index)
		}
	}
	collection.Indexes = indexes
}

func deleteLegacyHashOnlyCalendarFeeds(app core.App) error {
	records, err := app.FindAllRecords("calendar_feeds")
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return nil
		}
		return err
	}
	for _, record := range records {
		if strings.TrimSpace(record.GetString("token")) != "" {
			continue
		}
		// hash-only 旧 feed 无法反推 URL；便利优先的新模型选择删除旧记录，让用户登录后重新生成。
		if err := app.Delete(record); err != nil {
			return err
		}
	}
	return nil
}
