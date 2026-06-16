package main

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Demo seed 只生成可恢复的公开演示基线；真实通知、云备份和 AI 凭据必须保持空值，避免共享账号触发外部副作用。
func seedDemoSettings(app core.App, userID string) error {
	collection, err := app.FindCollectionByNameOrId("settings")
	if err != nil {
		return err
	}
	settings := defaultAppSettings()
	settings.AdminUsername = demoModePolicy.Name
	settings.Locale = string(localeZhCN)
	settings.DefaultCurrency = "CNY"
	settings.PublicStatusCurrency = "inherit"
	settings.MonthlyBudget = 800
	settings.Timezone = demoModeScheduleTimezone
	settings.NotificationTimeLocal = "09:00"
	// 公开 demo 允许浏览设置页，但默认不启用真实通知渠道，避免 reset 前的共享账号触达外部服务。
	settings.EnabledChannels = []string{}
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("settings", settings)
	return app.Save(record)
}

func seedDemoCustomConfig(app core.App, userID string) error {
	collection, err := app.FindCollectionByNameOrId("custom_configs")
	if err != nil {
		return err
	}
	config := customConfigPayload{
		Categories: []customConfigItem{
			demoConfigItem("cat_ai", "ai-tools", "AI 工具", "AI tools", "#7C3AED", "sparkles"),
			demoConfigItem("cat_dev", "dev-tools", "开发工具", "Developer tools", "#059669", "terminal"),
			demoConfigItem("cat_hosting", "hosting-edge", "托管与边缘", "Hosting and edge", "#2563EB", "cloud"),
			demoConfigItem("cat_data", "data-backend", "数据与后端", "Data and backend", "#0F766E", "database"),
			demoConfigItem("cat_design", "design-collaboration", "设计协作", "Design collaboration", "#DB2777", "pen-tool"),
			demoConfigItem("cat_observability", "observability", "可观测性", "Observability", "#D97706", "activity"),
			demoConfigItem("cat_security", "security-auth", "安全与认证", "Security and auth", "#DC2626", "shield-check"),
		},
		Statuses: []customConfigItem{},
		PaymentMethods: []customConfigItem{
			demoConfigItem("pay_visa", "visa", "Visa 信用卡", "Visa credit card", "#1D4ED8", "credit-card"),
			demoConfigItem("pay_alipay", "alipay", "支付宝", "Alipay", "#0EA5E9", "wallet"),
			demoConfigItem("pay_paypal", "paypal", "PayPal", "PayPal", "#0369A1", "badge-dollar-sign"),
			demoConfigItem("pay_bank", "bank", "银行转账", "Bank transfer", "#475569", "landmark"),
		},
		Currencies: []customConfigItem{
			demoConfigItem("cur_cny", "CNY", "人民币", "Chinese Yuan", "#DC2626", ""),
			demoConfigItem("cur_usd", "USD", "美元", "US Dollar", "#16A34A", ""),
			demoConfigItem("cur_eur", "EUR", "欧元", "Euro", "#2563EB", ""),
		},
	}
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("config", config)
	return app.Save(record)
}

func demoConfigItem(id string, value string, zhCN string, enUS string, color string, icon string) customConfigItem {
	return customConfigItem{
		ID:     id,
		Value:  value,
		Labels: customConfigLabels{ZhCN: zhCN, EnUS: enUS},
		Color:  color,
		Icon:   icon,
	}
}

func seedDemoSubscriptions(app core.App, userID string, now time.Time) error {
	collection, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		return err
	}
	for _, seed := range demoSubscriptionSeeds(now) {
		record := core.NewRecord(collection)
		record.Set("user", userID)
		record.Set("name", seed.Name)
		record.Set("logo", seed.logoURL())
		record.Set("price", seed.Price)
		record.Set("currency", seed.Currency)
		record.Set("billingCycle", seed.BillingCycle)
		record.Set("customDays", seed.CustomDays)
		record.Set("customCycleUnit", seed.CustomCycleUnit)
		record.Set("oneTimeTermCount", seed.OneTimeTermCount)
		record.Set("oneTimeTermUnit", seed.OneTimeTermUnit)
		record.Set("category", seed.Category)
		record.Set("status", seed.Status)
		record.Set("pinned", seed.Pinned)
		record.Set("publicHidden", seed.PublicHidden)
		record.Set("paymentMethod", seed.PaymentMethod)
		record.Set("startDate", seed.StartDate)
		record.Set("nextBillingDate", seed.NextBillingDate)
		record.Set("autoRenew", seed.AutoRenew)
		record.Set("autoCalculateNextBillingDate", seed.AutoCalculateNextBillingDate)
		record.Set("trialEndDate", seed.TrialEndDate)
		record.Set("website", seed.Website)
		record.Set("notes", seed.Notes)
		record.Set("tags", seed.Tags)
		// extra 是演示数据的可审计来源标记，测试用它区分可重建 seed 与访客临时新增记录。
		record.Set("extra", map[string]interface{}{
			"demo":           true,
			"slug":           seed.Slug,
			"pricingSource":  seed.PricingSource,
			"priceCheckedAt": demoModePriceCheckedAt,
		})
		record.Set("reminderDays", seed.ReminderDays)
		record.Set("repeatReminderEnabled", seed.RepeatReminderEnabled)
		record.Set("repeatReminderInterval", seed.RepeatReminderInterval)
		record.Set("repeatReminderWindow", seed.RepeatReminderWindow)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}
