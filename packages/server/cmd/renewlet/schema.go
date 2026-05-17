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
	maxLogoReferenceLength       = 64 * 1024
	maxSubscriptionPrice         = 1_000_000_000
	maxSubscriptionTags          = 100
	maxSubscriptionTagLength     = 40
	maxSubscriptionTagsFieldSize = 16 * 1024
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
	ownerRule := "id = @request.auth.id"
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
	return backfillAutodates(app, "subscriptions", "settings", "custom_configs", "assets", "notification_jobs")
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

func ownerRules(collection *core.Collection) {
	listRule := "user = @request.auth.id"
	createRule := "@request.auth.id != '' && user = @request.auth.id"
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
			&core.SelectField{Name: "billingCycle", Required: true, Values: []string{"weekly", "monthly", "quarterly", "semi-annual", "annual", "custom"}},
			&core.NumberField{Name: "customDays", OnlyInt: true, Min: &minZero},
			&core.TextField{Name: "category", Required: true, Max: 80},
			&core.SelectField{Name: "status", Required: true, Values: []string{"trial", "active", "paused", "cancelled"}},
			&core.TextField{Name: "paymentMethod", Max: 80},
			&core.TextField{Name: "startDate", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.TextField{Name: "nextBillingDate", Required: true, Max: 10, Pattern: `^\d{4}-\d{2}-\d{2}$`},
			&core.BoolField{Name: "autoCalculateNextBillingDate"},
			&core.TextField{Name: "trialEndDate", Max: 10, Pattern: `^$|^\d{4}-\d{2}-\d{2}$`},
			&core.URLField{Name: "website"},
			&core.TextField{Name: "notes", Max: 5000},
			&core.JSONField{Name: "tags", MaxSize: maxSubscriptionTagsFieldSize},
			&core.JSONField{Name: "extra", MaxSize: 65536},
			&core.NumberField{Name: "reminderDays", OnlyInt: true, Min: &minZero},
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
		c.AddIndex("idx_notification_jobs_user_local_date", false, "user, scheduledLocalDate", "")
		c.AddIndex("idx_notification_jobs_user_local_time_unique", true, "user, scheduledLocalDate, scheduledLocalTime, timeZone", "")
		return nil
	})
}
