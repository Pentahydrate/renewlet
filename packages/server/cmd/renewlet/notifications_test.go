package main

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestBuildDueNotificationForLocalDate(t *testing.T) {
	settings := defaultAppSettings()
	settings.ShowExpired = true
	settings.Timezone = "Asia/Shanghai"

	message := buildDueNotificationForLocalDate("2026-05-14", time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings, []notificationSubscription{
		{ID: "renewal", Name: "Renewal", Price: 18, Currency: "CNY", Status: "active", NextBillingDate: "2026-05-17", ReminderDays: 3},
		{ID: "trial", Name: "Trial", Price: 9.9, Currency: "USD", Status: "trial", NextBillingDate: "2026-06-01", TrialEndDate: "2026-05-15", ReminderDays: 1},
		{ID: "expired", Name: "Expired", Price: 12, Currency: "EUR", Status: "active", NextBillingDate: "2026-05-01", ReminderDays: 7},
	}, true)

	if !message.HasPayload {
		t.Fatal("expected notification payload")
	}
	if len(message.Items) != 3 {
		t.Fatalf("expected 3 notification items, got %d", len(message.Items))
	}
	if message.Items[0].Type != "renewal" || message.Items[1].Type != "trial" || message.Items[2].Type != "expired" {
		t.Fatalf("unexpected item types: %#v", message.Items)
	}
}

func TestBuildDueNotificationUsesEnglishLocale(t *testing.T) {
	settings := defaultAppSettings()
	settings.Locale = string(localeEnUS)
	settings.Timezone = "UTC"

	message := buildDueNotificationForLocalDate("2026-05-14", time.Date(2026, 5, 14, 1, 2, 3, 0, time.UTC), settings, []notificationSubscription{
		{ID: "renewal", Name: "Renewal", Price: 18, Currency: "USD", Status: "active", NextBillingDate: "2026-05-17", ReminderDays: 3},
	}, true)

	if message.Title != "Renewlet subscription reminder" {
		t.Fatalf("unexpected title %q", message.Title)
	}
	if !strings.Contains(message.Content, "Upcoming renewals") || !strings.Contains(message.Content, "3 days before") {
		t.Fatalf("expected English notification content, got %q", message.Content)
	}
}

func TestLocalScheduleDecisionUsesUserTimezone(t *testing.T) {
	now := time.Date(2026, 5, 14, 0, 1, 0, 0, time.UTC)
	decision := getLocalScheduleDecision(now, "Asia/Shanghai", "08:00", 2, false)

	if !decision.Due {
		t.Fatalf("expected schedule to be due, got reason %q", decision.Reason)
	}
	if decision.ScheduledLocalDate != "2026-05-14" {
		t.Fatalf("unexpected local date %q", decision.ScheduledLocalDate)
	}
	if decision.ScheduledInstantUTC != "2026-05-14T00:00:00Z" {
		t.Fatalf("unexpected instant %q", decision.ScheduledInstantUTC)
	}
}

func TestMergeSettingsSanitizesNotificationFields(t *testing.T) {
	settings, err := mergeSettings(defaultAppSettings(), json.RawMessage(`{
		"timezone": "Not/AZone",
		"notificationTimeLocal": "99:99",
		"enabledChannels": ["telegram", "telegram", "unknown", "email"],
		"exchangeRateProvider": "unknown",
		"webhookMethod": "DELETE",
		"webhookHeaders": `+strconv.Quote(legacyWebhookHeadersExample)+`,
		"webhookPayload": `+strconv.Quote(legacyWebhookPayloadExample)+`,
		"wechatMessageType": "xml",
		"barkServerUrl": ""
	}`))
	if err != nil {
		t.Fatal(err)
	}

	if settings.Timezone != "UTC" {
		t.Fatalf("expected timezone fallback, got %q", settings.Timezone)
	}
	if settings.NotificationTimeLocal != "08:00" {
		t.Fatalf("expected local time fallback, got %q", settings.NotificationTimeLocal)
	}
	if len(settings.EnabledChannels) != 2 || settings.EnabledChannels[0] != "telegram" || settings.EnabledChannels[1] != "email" {
		t.Fatalf("unexpected channels %#v", settings.EnabledChannels)
	}
	if settings.ExchangeRateProvider != "floatrates" {
		t.Fatalf("expected exchange-rate provider fallback, got %q", settings.ExchangeRateProvider)
	}
	if settings.WebhookMethod != "POST" || settings.WechatMessageType != "text" || settings.BarkServerURL != "https://api.day.app" {
		t.Fatalf("settings were not sanitized: %#v", settings)
	}
	if settings.WebhookHeaders != "" || settings.WebhookPayload != "" {
		t.Fatalf("expected legacy Webhook examples to be cleared, got headers=%q payload=%q", settings.WebhookHeaders, settings.WebhookPayload)
	}
}

func TestMergeSettingsPreservesSupportedExchangeRateProvider(t *testing.T) {
	settings, err := mergeSettings(defaultAppSettings(), json.RawMessage(`{
		"exchangeRateProvider": "floatrates"
	}`))
	if err != nil {
		t.Fatal(err)
	}

	if settings.ExchangeRateProvider != "floatrates" {
		t.Fatalf("expected exchange-rate provider to be preserved, got %q", settings.ExchangeRateProvider)
	}
}

func TestBuildBarkRequestURLAddsSinglePublicSubscriptionIcon(t *testing.T) {
	settings := defaultAppSettings()
	settings.BarkDeviceKey = "device-key"
	settings.BarkSilentPush = true

	requestURL, err := buildBarkRequestURL(settings, notificationMessage{
		Title:     "Renewlet 订阅提醒",
		Content:   "即将续费：\nAWS",
		Timestamp: "2026-05-14 08:00",
		Items: []notificationContentItem{{
			Name:    "AWS",
			LogoURL: "https://cdn.example.com/icons/aws.png?size=128",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	query := requestURL.Query()
	if got := query.Get("icon"); got != "https://cdn.example.com/icons/aws.png?size=128" {
		t.Fatalf("expected Bark icon query to use subscription logo, got %q", got)
	}
	if got := query.Get("group"); got != "Renewlet" {
		t.Fatalf("expected Bark group, got %q", got)
	}
	if got := query.Get("sound"); got != "none" {
		t.Fatalf("expected silent Bark sound, got %q", got)
	}
}

func TestBuildBarkRequestURLSkipsUnsafeOrAmbiguousIcons(t *testing.T) {
	settings := defaultAppSettings()
	settings.BarkDeviceKey = "device-key"
	cases := []struct {
		name  string
		items []notificationContentItem
	}{
		{name: "no items", items: nil},
		{name: "multiple items", items: []notificationContentItem{
			{Name: "AWS", LogoURL: "https://cdn.example.com/aws.png"},
			{Name: "OpenAI", LogoURL: "https://cdn.example.com/openai.png"},
		}},
		{name: "empty logo", items: []notificationContentItem{{Name: "AWS"}}},
		{name: "private asset path", items: []notificationContentItem{{Name: "AWS", LogoURL: "/api/app/assets/abc"}}},
		{name: "data url", items: []notificationContentItem{{Name: "AWS", LogoURL: "data:image/png;base64,abc"}}},
		{name: "blob url", items: []notificationContentItem{{Name: "AWS", LogoURL: "blob:http://example.com/abc"}}},
		{name: "plain http", items: []notificationContentItem{{Name: "AWS", LogoURL: "http://cdn.example.com/aws.png"}}},
		{name: "localhost", items: []notificationContentItem{{Name: "AWS", LogoURL: "https://localhost/aws.png"}}},
		{name: "loopback ip", items: []notificationContentItem{{Name: "AWS", LogoURL: "https://127.0.0.1/aws.png"}}},
		{name: "private ip", items: []notificationContentItem{{Name: "AWS", LogoURL: "https://10.0.0.1/aws.png"}}},
		{name: "userinfo", items: []notificationContentItem{{Name: "AWS", LogoURL: "https://user@example.com/aws.png"}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			requestURL, err := buildBarkRequestURL(settings, notificationMessage{
				Title:     "Renewlet 订阅提醒",
				Content:   "即将续费",
				Timestamp: "2026-05-14 08:00",
				Items:     tc.items,
			})
			if err != nil {
				t.Fatal(err)
			}
			if got := requestURL.Query().Get("icon"); got != "" {
				t.Fatalf("expected no Bark icon query, got %q", got)
			}
		})
	}
}

func TestNotificationContentItemLogoURLIsInternalOnly(t *testing.T) {
	payload, err := json.Marshal(notificationContentItem{
		Name:    "AWS",
		LogoURL: "https://cdn.example.com/aws.png",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "LogoURL") || strings.Contains(string(payload), "cdn.example.com") {
		t.Fatalf("expected logo url to be omitted from notification JSON, got %s", payload)
	}
}
