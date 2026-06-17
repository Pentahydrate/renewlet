package main

// Schema 测试保护 PocketBase collection 自愈、索引和迁移收敛。
// 字段默认值、date-only、autoRenew 和 Logo URL 契约改动必须先在这里证明旧库能被收敛到当前形状。

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func newSchemaTestApp(t *testing.T) *pocketbase.PocketBase {
	t.Helper()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir()})
	registerAuthHooks(app)
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = app.ResetBootstrapState()
	})
	return app
}

func TestEnsureSchemaCreatesContractFieldsAndIndexes(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	assertFields(t, app, "subscriptions", map[string]string{
		"user":                         core.FieldTypeRelation,
		"name":                         core.FieldTypeText,
		"logo":                         core.FieldTypeText,
		"price":                        core.FieldTypeNumber,
		"currency":                     core.FieldTypeText,
		"billingCycle":                 core.FieldTypeSelect,
		"customDays":                   core.FieldTypeNumber,
		"customCycleUnit":              core.FieldTypeSelect,
		"oneTimeTermCount":             core.FieldTypeNumber,
		"oneTimeTermUnit":              core.FieldTypeSelect,
		"category":                     core.FieldTypeText,
		"status":                       core.FieldTypeSelect,
		"pinned":                       core.FieldTypeBool,
		"publicHidden":                 core.FieldTypeBool,
		"paymentMethod":                core.FieldTypeText,
		"startDate":                    core.FieldTypeText,
		"nextBillingDate":              core.FieldTypeText,
		"autoRenew":                    core.FieldTypeBool,
		"autoCalculateNextBillingDate": core.FieldTypeBool,
		"trialEndDate":                 core.FieldTypeText,
		"website":                      core.FieldTypeURL,
		"notes":                        core.FieldTypeText,
		"tags":                         core.FieldTypeJSON,
		"extra":                        core.FieldTypeJSON,
		"reminderDays":                 core.FieldTypeNumber,
		"repeatReminderEnabled":        core.FieldTypeBool,
		"repeatReminderInterval":       core.FieldTypeSelect,
		"repeatReminderWindow":         core.FieldTypeSelect,
		"created":                      core.FieldTypeAutodate,
		"updated":                      core.FieldTypeAutodate,
	})
	assertFields(t, app, "settings", map[string]string{
		"user":     core.FieldTypeRelation,
		"settings": core.FieldTypeJSON,
		"created":  core.FieldTypeAutodate,
		"updated":  core.FieldTypeAutodate,
	})
	assertFields(t, app, "custom_configs", map[string]string{
		"user":    core.FieldTypeRelation,
		"config":  core.FieldTypeJSON,
		"created": core.FieldTypeAutodate,
		"updated": core.FieldTypeAutodate,
	})
	assertFields(t, app, "assets", map[string]string{
		"user":         core.FieldTypeRelation,
		"kind":         core.FieldTypeSelect,
		"file":         core.FieldTypeFile,
		"mimeType":     core.FieldTypeText,
		"sizeBytes":    core.FieldTypeNumber,
		"originalName": core.FieldTypeText,
		"created":      core.FieldTypeAutodate,
		"updated":      core.FieldTypeAutodate,
	})
	assertNumberField(t, app, "subscriptions", "price", false, 0, maxSubscriptionPrice)
	assertNumberField(t, app, "subscriptions", "reminderDays", false, disabledReminderDays, maxReminderDays)
	assertSelectFieldValues(t, app, "subscriptions", "billingCycle", "weekly", "monthly", "quarterly", "semi-annual", "annual", "custom", "one-time")
	assertSelectFieldValues(t, app, "subscriptions", "customCycleUnit", "day", "week", "month", "year")
	assertNumberField(t, app, "subscriptions", "oneTimeTermCount", false, 0, maxReminderDays)
	assertSelectFieldValues(t, app, "subscriptions", "oneTimeTermUnit", "day", "week", "month", "year")
	assertSelectFieldValues(t, app, "subscriptions", "status", "trial", "active", "expired", "paused", "cancelled")
	assertJSONFieldMaxSize(t, app, "subscriptions", "tags", maxSubscriptionTagsFieldSize)
	assertFileFieldMimeTypes(t, app, "assets", "file", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon")
	assertFields(t, app, "notification_jobs", map[string]string{
		"user":                core.FieldTypeRelation,
		"scheduledLocalDate":  core.FieldTypeText,
		"scheduledLocalTime":  core.FieldTypeText,
		"timeZone":            core.FieldTypeText,
		"scheduledInstantUtc": core.FieldTypeText,
		"status":              core.FieldTypeSelect,
		"attempts":            core.FieldTypeNumber,
		"lastError":           core.FieldTypeText,
		"result":              core.FieldTypeJSON,
		"created":             core.FieldTypeAutodate,
		"updated":             core.FieldTypeAutodate,
	})
	assertFields(t, app, "calendar_feeds", map[string]string{
		"user":           core.FieldTypeRelation,
		"scope":          core.FieldTypeSelect,
		"subscriptionId": core.FieldTypeText,
		"token":          core.FieldTypeText,
		"created":        core.FieldTypeAutodate,
		"updated":        core.FieldTypeAutodate,
	})
	assertFields(t, app, "public_status_pages", map[string]string{
		"user":       core.FieldTypeRelation,
		"token":      core.FieldTypeText,
		"showPrices": core.FieldTypeBool,
		"created":    core.FieldTypeAutodate,
		"updated":    core.FieldTypeAutodate,
	})

	assertIndex(t, app, "subscriptions", "idx_subscriptions_user")
	assertIndex(t, app, "subscriptions", "idx_subscriptions_user_logo")
	assertIndex(t, app, "subscriptions", "idx_subscriptions_user_auto_renew_due")
	assertIndex(t, app, "subscriptions", "idx_subscriptions_user_reminder_due")
	assertIndex(t, app, "subscriptions", "idx_subscriptions_user_trial_reminder")
	assertIndex(t, app, "subscriptions", "idx_subscriptions_user_repeat_reminder")
	assertIndex(t, app, "settings", "idx_settings_user_unique")
	assertIndex(t, app, "custom_configs", "idx_custom_configs_user_unique")
	assertIndex(t, app, "notification_jobs", "idx_notification_jobs_user_local_time_unique")
	assertIndex(t, app, "calendar_feeds", "idx_calendar_feeds_user_all_unique")
	assertIndex(t, app, "calendar_feeds", "idx_calendar_feeds_token_unique")
	assertIndex(t, app, "calendar_feeds", "idx_calendar_feeds_user_subscription_unique")
	assertIndex(t, app, "public_status_pages", "idx_public_status_pages_user_unique")
	assertIndex(t, app, "public_status_pages", "idx_public_status_pages_token_unique")
}

func TestEnsureSchemaSelfHealsExistingCollectionsWithoutAutodates(t *testing.T) {
	app := newSchemaTestApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	subscriptions := core.NewBaseCollection("subscriptions")
	if err := upsertField(subscriptions, userRelation(users)); err != nil {
		t.Fatal(err)
	}
	if err := upsertField(subscriptions, &core.TextField{Name: "name", Required: true}); err != nil {
		t.Fatal(err)
	}
	if err := app.Save(subscriptions); err != nil {
		t.Fatal(err)
	}

	jobs := core.NewBaseCollection("notification_jobs")
	if err := upsertField(jobs, userRelation(users)); err != nil {
		t.Fatal(err)
	}
	if err := upsertField(jobs, &core.TextField{Name: "scheduledInstantUtc", Required: true}); err != nil {
		t.Fatal(err)
	}
	if err := app.Save(jobs); err != nil {
		t.Fatal(err)
	}

	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	assertFields(t, app, "subscriptions", map[string]string{
		"created": core.FieldTypeAutodate,
		"updated": core.FieldTypeAutodate,
	})
	assertFields(t, app, "notification_jobs", map[string]string{
		"created": core.FieldTypeAutodate,
		"updated": core.FieldTypeAutodate,
	})
}

func TestBackfillSubscriptionAutoRenewOnlyForcesOneTimeFalse(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("schema-autorenew@example.com")
	user.SetPassword("password123")
	user.SetVerified(true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	subscriptions, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatal(err)
	}

	insert := func(name string, cycle string, autoRenew bool) string {
		t.Helper()
		record := core.NewRecord(subscriptions)
		record.Set("user", user.Id)
		record.Set("name", name)
		record.Set("price", 1)
		record.Set("currency", "USD")
		record.Set("billingCycle", cycle)
		record.Set("category", "productivity")
		record.Set("status", "active")
		record.Set("startDate", "2026-05-14")
		record.Set("nextBillingDate", "2026-06-14")
		record.Set("autoRenew", autoRenew)
		record.Set("autoCalculateNextBillingDate", true)
		record.Set("tags", []string{})
		record.Set("extra", emptyJSONPayload{})
		record.Set("reminderDays", 3)
		record.Set("repeatReminderEnabled", false)
		record.Set("repeatReminderInterval", defaultRepeatReminderInterval)
		record.Set("repeatReminderWindow", defaultRepeatReminderWindow)
		if err := app.SaveNoValidate(record); err != nil {
			t.Fatal(err)
		}
		return record.Id
	}

	manualID := insert("Manual", "monthly", false)
	autoID := insert("Auto", "monthly", true)
	oneTimeID := insert("One Time", "one-time", true)

	if err := backfillSubscriptionAutoRenew(app); err != nil {
		t.Fatal(err)
	}

	assertAutoRenew := func(id string, want bool) {
		t.Helper()
		record, err := app.FindRecordById("subscriptions", id)
		if err != nil {
			t.Fatal(err)
		}
		if got := record.GetBool("autoRenew"); got != want {
			t.Fatalf("autoRenew for %s = %v, want %v", id, got, want)
		}
	}
	assertAutoRenew(manualID, false)
	assertAutoRenew(autoID, true)
	assertAutoRenew(oneTimeID, false)
}

func TestEnsureSchemaSelfHealsSubscriptionLogoURLFieldToText(t *testing.T) {
	app := newSchemaTestApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	subscriptions := core.NewBaseCollection("subscriptions")
	if err := upsertField(subscriptions, userRelation(users)); err != nil {
		t.Fatal(err)
	}
	if err := upsertField(subscriptions, &core.TextField{Name: "name", Required: true}); err != nil {
		t.Fatal(err)
	}
	if err := upsertField(subscriptions, &core.URLField{Name: "logo"}); err != nil {
		t.Fatal(err)
	}
	if err := app.Save(subscriptions); err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("schema-logo@example.com")
	user.SetPassword("password123")
	user.SetVerified(true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(subscriptions)
	record.Set("user", user.Id)
	record.Set("name", "Logo Field")
	record.Set("logo", "https://example.com/logo.png")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	collection, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	field, ok := collection.Fields.GetByName("logo").(*core.TextField)
	if !ok {
		t.Fatalf("expected subscriptions.logo to be text after self-heal, got %T", collection.Fields.GetByName("logo"))
	}
	if field.Max != maxLogoReferenceLength {
		t.Fatalf("subscriptions.logo max = %d, want %d", field.Max, maxLogoReferenceLength)
	}
	savedRecord, err := app.FindRecordById("subscriptions", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if savedRecord.GetString("logo") != "https://example.com/logo.png" {
		t.Fatalf("expected existing logo value to survive self-heal, got %q", savedRecord.GetString("logo"))
	}
}

func TestEnsureSchemaCleansInvalidSubscriptionLogosButKeepsHttpLinks(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("schema-logo-cleanup@example.com")
	user.SetPassword("password123")
	user.SetVerified(true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	subscriptions, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatal(err)
	}

	insert := func(name string, logo string) string {
		t.Helper()
		record := core.NewRecord(subscriptions)
		record.Set("user", user.Id)
		record.Set("name", name)
		record.Set("price", 1)
		record.Set("currency", "USD")
		record.Set("billingCycle", "monthly")
		record.Set("category", "productivity")
		record.Set("status", "active")
		record.Set("startDate", "2026-05-14")
		record.Set("nextBillingDate", "2026-06-14")
		record.Set("autoRenew", true)
		record.Set("autoCalculateNextBillingDate", true)
		record.Set("tags", []string{})
		record.Set("extra", emptyJSONPayload{})
		record.Set("reminderDays", 3)
		record.Set("repeatReminderEnabled", false)
		record.Set("repeatReminderInterval", defaultRepeatReminderInterval)
		record.Set("repeatReminderWindow", defaultRepeatReminderWindow)
		record.Set("logo", logo)
		if err := app.SaveNoValidate(record); err != nil {
			t.Fatal(err)
		}
		return record.Id
	}

	httpID := insert("HTTP Logo", "http://example.com/logo.png")
	dataID := insert("Data Logo", "data:image/png;base64,aGVsbG8=")
	userinfoID := insert("Userinfo Logo", "https://user:pass@example.com/logo.png")
	privateID := insert("Private Logo", "/api/app/assets/2pbs0lgyypqhjoy")

	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	assertLogo := func(id string, want string) {
		t.Helper()
		record, err := app.FindRecordById("subscriptions", id)
		if err != nil {
			t.Fatal(err)
		}
		if got := record.GetString("logo"); got != want {
			t.Fatalf("logo for %s = %q, want %q", id, got, want)
		}
	}
	assertLogo(httpID, "http://example.com/logo.png")
	assertLogo(privateID, "/api/app/assets/2pbs0lgyypqhjoy")
	assertLogo(dataID, "")
	assertLogo(userinfoID, "")
}

func TestEnsureSchemaSelfHealsAssetsSvgMimeType(t *testing.T) {
	app := newSchemaTestApp(t)
	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("assets")
	if err != nil {
		t.Fatal(err)
	}
	field, ok := collection.Fields.GetByName("file").(*core.FileField)
	if !ok {
		t.Fatal("expected assets.file to be a file field")
	}
	field.MimeTypes = []string{"image/png", "image/jpeg", "image/webp"}
	if err := app.Save(collection); err != nil {
		t.Fatal(err)
	}

	if err := ensureSchema(app); err != nil {
		t.Fatal(err)
	}

	assertFileFieldMimeTypes(t, app, "assets", "file", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon")
}

func assertNumberField(t *testing.T, app core.App, collectionName string, fieldName string, required bool, min float64, max float64) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := collection.Fields.GetByName(fieldName).(*core.NumberField)
	if !ok {
		t.Fatalf("collection %s field %s is not a number field", collectionName, fieldName)
	}
	if field.Required != required {
		t.Fatalf("collection %s field %s required = %v, want %v", collectionName, fieldName, field.Required, required)
	}
	if field.Min == nil || *field.Min != min {
		t.Fatalf("collection %s field %s min = %v, want %v", collectionName, fieldName, field.Min, min)
	}
	if field.Max == nil || *field.Max != max {
		t.Fatalf("collection %s field %s max = %v, want %v", collectionName, fieldName, field.Max, max)
	}
}

func assertJSONFieldMaxSize(t *testing.T, app core.App, collectionName string, fieldName string, maxSize int64) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := collection.Fields.GetByName(fieldName).(*core.JSONField)
	if !ok {
		t.Fatalf("collection %s field %s is not a JSON field", collectionName, fieldName)
	}
	if field.MaxSize != maxSize {
		t.Fatalf("collection %s field %s max size = %d, want %d", collectionName, fieldName, field.MaxSize, maxSize)
	}
}

func assertSelectFieldValues(t *testing.T, app core.App, collectionName string, fieldName string, expected ...string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := collection.Fields.GetByName(fieldName).(*core.SelectField)
	if !ok {
		t.Fatalf("collection %s field %s is not a select field", collectionName, fieldName)
	}
	if len(field.Values) != len(expected) {
		t.Fatalf("collection %s field %s values = %#v, want %#v", collectionName, fieldName, field.Values, expected)
	}
	for i, value := range expected {
		if field.Values[i] != value {
			t.Fatalf("collection %s field %s values = %#v, want %#v", collectionName, fieldName, field.Values, expected)
		}
	}
}

func assertFields(t *testing.T, app core.App, collectionName string, fields map[string]string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	for name, fieldType := range fields {
		field := collection.Fields.GetByName(name)
		if field == nil {
			t.Fatalf("collection %s is missing field %s", collectionName, name)
		}
		if field.Type() != fieldType {
			t.Fatalf("collection %s field %s type = %s, want %s", collectionName, name, field.Type(), fieldType)
		}
	}
}

func assertFileFieldMimeTypes(t *testing.T, app core.App, collectionName string, fieldName string, expected ...string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	field, ok := collection.Fields.GetByName(fieldName).(*core.FileField)
	if !ok {
		t.Fatalf("collection %s field %s is not a file field", collectionName, fieldName)
	}
	for _, mimeType := range expected {
		found := false
		for _, actual := range field.MimeTypes {
			if actual == mimeType {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("collection %s field %s MIME types %#v missing %s", collectionName, fieldName, field.MimeTypes, mimeType)
		}
	}
}

func assertIndex(t *testing.T, app core.App, collectionName string, indexName string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	for _, index := range collection.Indexes {
		if strings.Contains(index, "`"+indexName+"`") {
			return
		}
	}
	t.Fatalf("collection %s is missing index %s", collectionName, indexName)
}
