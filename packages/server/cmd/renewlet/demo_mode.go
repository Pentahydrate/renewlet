package main

import (
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	demoModeEnvName          = "RENEWLET_DEMO_MODE"
	demoModeCollectionPage   = 200
	demoModeScheduleTimezone = "Asia/Shanghai"
	demoModePriceCheckedAt   = "2026-05-18"
	demoModeLogoProvider     = "thesvg"
)

type renewletDemoPolicy struct {
	Email            string
	Password         string
	Name             string
	ResetCron        string
	MaxSubscriptions int
	MaxAssets        int
}

type demoProtectedSettingsSnapshot struct {
	AIRecognition           aiRecognitionSettings
	EnabledChannels         []string
	TestPhone               string
	TelegramBotToken        string
	TelegramChatID          string
	NotifyxAPIKey           string
	WebhookURL              string
	WebhookMethod           string
	WebhookHeaders          string
	WebhookPayload          string
	WechatWebhookURL        string
	WechatMessageType       string
	WechatAddModeTag        bool
	WechatAtPhones          string
	WechatAtAll             bool
	SMTPHost                string
	SMTPPort                string
	SMTPSecure              bool
	SMTPUser                string
	SMTPPassword            string
	SMTPFrom                string
	SMTPReplyTo             string
	NotifyMultipleAddresses bool
	RecipientEmail          string
	BarkServerURL           string
	BarkDeviceKey           string
	BarkSilentPush          bool
	ServerChanSendKey       string
}

var demoModePolicy = renewletDemoPolicy{
	Email:            "demo@renewlet.local",
	Password:         "renewlet-demo",
	Name:             "Demo",
	ResetCron:        "0 */2 * * *",
	MaxSubscriptions: 80,
	MaxAssets:        20,
}

// Enabled 只读取单一公开开关；账号、密码、quota 和 reset 周期固定在后端，避免公开 demo 被部署者误配成不可恢复状态。
func (p renewletDemoPolicy) Enabled() bool {
	return envBool(demoModeEnvName, false)
}

func (p renewletDemoPolicy) SetupEnabled() bool {
	return !p.Enabled() && envBool("SETUP_ENABLED", true)
}

func registerDemoResetCron(app core.App) error {
	if !demoModePolicy.Enabled() {
		return nil
	}
	return app.Cron().Add("renewlet_demo_reset", demoModePolicy.ResetCron, func() {
		user, err := demoModePolicy.FindUser(app)
		if err != nil {
			slog.Error("demo mode reset skipped because demo user lookup failed", "error", err)
			return
		}
		if user == nil {
			user, err = demoModePolicy.EnsureUser(app)
			if err != nil {
				slog.Error("demo mode reset skipped because demo user repair failed", "error", err)
				return
			}
		}
		// reset 是公开 demo 的核心状态机：每个 tick 只回收固定 demo 账号的数据，绝不碰其他用户。
		if err := demoModePolicy.ResetUserData(app, user, time.Now().UTC()); err != nil {
			slog.Error("demo mode reset failed", "user", user.Id, "error", err)
		}
	})
}

func ensureDemoMode(app core.App) error {
	if !demoModePolicy.Enabled() {
		return nil
	}
	user, err := demoModePolicy.EnsureUser(app)
	if err != nil {
		return err
	}
	// 启动即 reset 让镜像重启和两小时 cron 具备同一份可重复 demo 基线。
	return demoModePolicy.ResetUserData(app, user, time.Now().UTC())
}

func (p renewletDemoPolicy) EnsureUser(app core.App) (*core.Record, error) {
	user, err := p.FindUser(app)
	if err != nil {
		return nil, err
	}
	if user == nil {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return nil, err
		}
		user = core.NewRecord(users)
	}
	user.Set("name", p.Name)
	user.SetEmail(p.Email)
	user.SetEmailVisibility(true)
	user.SetVerified(true)
	user.SetPassword(p.Password)
	user.Set("role", "user")
	user.Set("banned", false)
	user.Set("banReason", "")
	// 账号修复必须能覆盖被访客尝试改坏的密码/角色；SaveNoValidate 跳过 demo 保护 hook，但仍走 PocketBase 写入流程。
	if err := app.SaveNoValidate(user); err != nil {
		return nil, err
	}
	return user, nil
}

func (p renewletDemoPolicy) FindUser(app core.App) (*core.Record, error) {
	user, err := app.FindAuthRecordByEmail("users", p.Email)
	if err != nil {
		if errorsIsNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return user, nil
}

func (p renewletDemoPolicy) ResetUserData(app core.App, user *core.Record, now time.Time) error {
	if !p.Enabled() || user == nil || !p.IsUserRecord(user) {
		return nil
	}
	return app.RunInTransaction(func(txApp core.App) error {
		// 删除和 seed 放在一个事务里，避免访客在 reset 窗口读到半套 settings/subscriptions 状态。
		for _, collection := range []string{
			"notification_jobs",
			"calendar_feeds",
			"public_status_pages",
			"cloud_backup_targets",
			"subscriptions",
			"settings",
			"custom_configs",
			"assets",
		} {
			if err := deleteDemoUserCollectionRecords(txApp, collection, user.Id); err != nil {
				return err
			}
		}
		if err := seedDemoSettings(txApp, user.Id); err != nil {
			return err
		}
		if err := seedDemoCustomConfig(txApp, user.Id); err != nil {
			return err
		}
		if err := seedDemoSubscriptions(txApp, user.Id, now); err != nil {
			return err
		}
		// Demo reset 会让已分享 token 失效，但不预生成公开页/日历 Feed，保持与普通部署一致的手动生成流程。
		return nil
	})
}

func deleteDemoUserCollectionRecords(app core.App, collection string, userID string) error {
	for {
		records, err := app.FindRecordsByFilter(
			collection,
			"user = {:user}",
			"created",
			demoModeCollectionPage,
			0,
			dbx.Params{"user": userID},
		)
		if err != nil {
			return err
		}
		for _, record := range records {
			if err := app.Delete(record); err != nil {
				return err
			}
		}
		if len(records) < demoModeCollectionPage {
			return nil
		}
	}
}

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

type demoSubscriptionSeed struct {
	Slug                         string
	LogoSlug                     string
	Name                         string
	Price                        float64
	Currency                     string
	BillingCycle                 string
	CustomDays                   int
	CustomCycleUnit              string
	OneTimeTermCount             int
	OneTimeTermUnit              string
	Category                     string
	Status                       string
	Pinned                       bool
	PublicHidden                 bool
	PaymentMethod                string
	StartDate                    string
	NextBillingDate              string
	AutoRenew                    bool
	AutoCalculateNextBillingDate bool
	TrialEndDate                 string
	Website                      string
	PricingSource                string
	Notes                        string
	Tags                         []string
	ReminderDays                 int
	RepeatReminderEnabled        bool
	RepeatReminderInterval       string
	RepeatReminderWindow         string
}

func demoSubscriptionSeeds(now time.Time) []demoSubscriptionSeed {
	return []demoSubscriptionSeed{
		{
			Slug:                         "chatgpt-plus",
			LogoSlug:                     "openai",
			Name:                         "ChatGPT Plus",
			Price:                        20,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "ai-tools",
			Status:                       "active",
			Pinned:                       true,
			PaymentMethod:                "visa",
			StartDate:                    demoDate(now, -90),
			NextBillingDate:              demoDate(now, 8),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://chatgpt.com",
			PricingSource:                "https://help.openai.com/en/articles/6950777-chatgpt-plus",
			Notes:                        demoPricingNote("ChatGPT Plus", "Plus", "monthly public plan price"),
			Tags:                         []string{"AI", "Research"},
			ReminderDays:                 3,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "github-copilot-pro",
			LogoSlug:                     "github-copilot",
			Name:                         "GitHub Copilot Pro",
			Price:                        10,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "dev-tools",
			Status:                       "active",
			Pinned:                       true,
			PaymentMethod:                "visa",
			StartDate:                    demoDate(now, -150),
			NextBillingDate:              demoDate(now, 19),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://github.com/features/copilot",
			PricingSource:                "https://github.com/features/copilot/plans",
			Notes:                        demoPricingNote("GitHub Copilot Pro", "Pro", "monthly individual plan price"),
			Tags:                         []string{"work", "ai"},
			ReminderDays:                 7,
			RepeatReminderEnabled:        true,
			RepeatReminderInterval:       "24h",
			RepeatReminderWindow:         "72h",
		},
		{
			Slug:                         "cursor-pro",
			LogoSlug:                     "cursor",
			Name:                         "Cursor Pro",
			Price:                        20,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "dev-tools",
			Status:                       "trial",
			Pinned:                       true,
			PaymentMethod:                "paypal",
			StartDate:                    demoDate(now, -5),
			NextBillingDate:              demoDate(now, 25),
			AutoRenew:                    false,
			AutoCalculateNextBillingDate: true,
			TrialEndDate:                 demoDate(now, 2),
			Website:                      "https://cursor.com",
			PricingSource:                "https://cursor.com/pricing",
			Notes:                        demoPricingNote("Cursor Pro", "Pro", "monthly public plan price"),
			Tags:                         []string{"editor", "ai"},
			ReminderDays:                 3,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "vercel-pro",
			LogoSlug:                     "vercel",
			Name:                         "Vercel Pro",
			Price:                        20,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "hosting-edge",
			Status:                       "active",
			Pinned:                       true,
			PaymentMethod:                "bank",
			StartDate:                    demoDate(now, -240),
			NextBillingDate:              demoDate(now, 14),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://vercel.com",
			PricingSource:                "https://vercel.com/pricing",
			Notes:                        demoPricingNote("Vercel Pro", "Pro", "per-user monthly plan price"),
			Tags:                         []string{"hosting", "frontend"},
			ReminderDays:                 7,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "supabase-pro",
			LogoSlug:                     "supabase",
			Name:                         "Supabase Pro",
			Price:                        25,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "data-backend",
			Status:                       "active",
			PaymentMethod:                "visa",
			StartDate:                    demoDate(now, -180),
			NextBillingDate:              demoDate(now, 28),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://supabase.com",
			PricingSource:                "https://supabase.com/pricing",
			Notes:                        demoPricingNote("Supabase Pro", "Pro", "monthly project plan price"),
			Tags:                         []string{"database", "backend"},
			ReminderDays:                 7,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "cloudflare-workers-paid",
			LogoSlug:                     "cloudflare",
			Name:                         "Cloudflare Workers Paid",
			Price:                        5,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "hosting-edge",
			Status:                       "active",
			PaymentMethod:                "paypal",
			StartDate:                    demoDate(now, -60),
			NextBillingDate:              demoDate(now, 3),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://workers.cloudflare.com",
			PricingSource:                "https://developers.cloudflare.com/workers/platform/pricing/",
			Notes:                        demoPricingNote("Cloudflare Workers Paid", "Paid", "monthly Workers paid plan price"),
			Tags:                         []string{"serverless", "edge"},
			ReminderDays:                 3,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "docker-pro",
			LogoSlug:                     "docker",
			Name:                         "Docker Pro",
			Price:                        108,
			Currency:                     "USD",
			BillingCycle:                 "annual",
			Category:                     "dev-tools",
			Status:                       "active",
			PaymentMethod:                "visa",
			StartDate:                    demoDate(now, -300),
			NextBillingDate:              demoDate(now, 65),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://www.docker.com",
			PricingSource:                "https://www.docker.com/pricing/",
			Notes:                        demoPricingNote("Docker Pro", "Pro", "annual total based on the public USD 9/month annual-billing price"),
			Tags:                         []string{"containers", "registry"},
			ReminderDays:                 14,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "figma-professional",
			LogoSlug:                     "figma",
			Name:                         "Figma Professional",
			Price:                        20,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "design-collaboration",
			Status:                       "active",
			PaymentMethod:                "visa",
			StartDate:                    demoDate(now, -33),
			NextBillingDate:              demoDate(now, 57),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://www.figma.com",
			PricingSource:                "https://www.figma.com/pricing/",
			Notes:                        demoPricingNote("Figma Professional", "Professional", "monthly public plan price"),
			Tags:                         []string{"design", "team"},
			ReminderDays:                 7,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "linear-basic",
			LogoSlug:                     "linear",
			Name:                         "Linear Basic",
			Price:                        10,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "dev-tools",
			Status:                       "active",
			PaymentMethod:                "paypal",
			StartDate:                    demoDate(now, -72),
			NextBillingDate:              demoDate(now, 21),
			AutoRenew:                    false,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://linear.app",
			PricingSource:                "https://linear.app/pricing",
			Notes:                        demoPricingNote("Linear Basic", "Basic", "per-user monthly plan price"),
			Tags:                         []string{"issues", "planning"},
			ReminderDays:                 7,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "sentry-team",
			LogoSlug:                     "sentry",
			Name:                         "Sentry Team",
			Price:                        26,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "observability",
			Status:                       "active",
			PaymentMethod:                "bank",
			StartDate:                    demoDate(now, -126),
			NextBillingDate:              demoDate(now, 6),
			AutoRenew:                    true,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://sentry.io",
			PricingSource:                "https://sentry.io/pricing/",
			Notes:                        demoPricingNote("Sentry Team", "Team", "monthly team plan price"),
			Tags:                         []string{"errors", "observability"},
			ReminderDays:                 3,
			RepeatReminderEnabled:        true,
			RepeatReminderInterval:       "24h",
			RepeatReminderWindow:         "72h",
		},
		{
			Slug:                         "clerk-pro",
			LogoSlug:                     "clerk",
			Name:                         "Clerk Pro",
			Price:                        25,
			Currency:                     "USD",
			BillingCycle:                 "monthly",
			Category:                     "security-auth",
			Status:                       "paused",
			PublicHidden:                 true,
			PaymentMethod:                "visa",
			StartDate:                    demoDate(now, -45),
			NextBillingDate:              demoDate(now, 18),
			AutoRenew:                    false,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://clerk.com",
			PricingSource:                "https://clerk.com/pricing",
			Notes:                        demoPricingNote("Clerk Pro", "Pro", "monthly public plan price"),
			Tags:                         []string{"auth", "users"},
			ReminderDays:                 -1,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
		{
			Slug:                         "sonarqube-cloud-team",
			LogoSlug:                     "sonarqube",
			Name:                         "SonarQube Cloud Team",
			Price:                        32,
			Currency:                     "EUR",
			BillingCycle:                 "monthly",
			Category:                     "security-auth",
			Status:                       "expired",
			PublicHidden:                 true,
			PaymentMethod:                "bank",
			StartDate:                    demoDate(now, -210),
			NextBillingDate:              demoDate(now, -4),
			AutoRenew:                    false,
			AutoCalculateNextBillingDate: true,
			Website:                      "https://www.sonarsource.com",
			PricingSource:                "https://www.sonarsource.com/plans-and-pricing/sonarqube-cloud/",
			Notes:                        demoPricingNote("SonarQube Cloud Team", "Team", "monthly public plan price"),
			Tags:                         []string{"quality", "security"},
			ReminderDays:                 -2,
			RepeatReminderEnabled:        false,
			RepeatReminderInterval:       defaultRepeatReminderInterval,
			RepeatReminderWindow:         defaultRepeatReminderWindow,
		},
	}
}

func (seed demoSubscriptionSeed) logoURL() string {
	return demoTheSVGLogo(seed.LogoSlug)
}

func demoTheSVGLogo(slug string) string {
	// demo seed 复用内置 Logo resolver 的 provider base，避免公开演示数据再次漂到失效 CDN 路径。
	return strings.TrimRight(mediaResolverBuiltInProviderBase(demoModeLogoProvider), "/") + "/public/icons/" + slug + "/default.svg"
}

func demoPricingNote(name string, planLabel string, priceBasis string) string {
	return name + " (" + planLabel + ") uses the official public price basis: " + priceBasis + ". Checked " + demoModePriceCheckedAt + ". Demo data only."
}

func demoDate(now time.Time, offsetDays int) string {
	loc, err := time.LoadLocation(demoModeScheduleTimezone)
	if err != nil {
		loc = time.UTC
	}
	return now.In(loc).AddDate(0, 0, offsetDays).Format("2006-01-02")
}

func (p renewletDemoPolicy) IsUserRecord(record *core.Record) bool {
	return p.Enabled() && record != nil && strings.EqualFold(strings.TrimSpace(record.Email()), p.Email)
}

func (p renewletDemoPolicy) IsUserID(app core.App, userID string) bool {
	if !p.Enabled() || strings.TrimSpace(userID) == "" {
		return false
	}
	user, err := app.FindRecordById("users", strings.TrimSpace(userID))
	return err == nil && p.IsUserRecord(user)
}

func (p renewletDemoPolicy) RejectAccountMutation(e *core.RequestEvent) error {
	if p.IsUserRecord(e.Auth) {
		return e.ForbiddenError(serverText(requestLocale(e.Request), "demo.operationDisabled"), nil)
	}
	return nil
}

func (p renewletDemoPolicy) RejectTargetUserMutation(e *core.RequestEvent, user *core.Record) error {
	if p.IsUserRecord(user) {
		return e.ForbiddenError(serverText(requestLocale(e.Request), "demo.operationDisabled"), nil)
	}
	return nil
}

func (p renewletDemoPolicy) RejectExternalSideEffect(e *core.RequestEvent) error {
	if p.IsUserRecord(e.Auth) {
		return e.ForbiddenError(serverText(requestLocale(e.Request), "demo.operationDisabled"), nil)
	}
	return nil
}

func (p renewletDemoPolicy) RejectSettingsSecretMutation(e *core.RequestEvent, current appSettings, next appSettings) error {
	if p.IsUserRecord(e.Auth) && demoProtectedSettingsChanged(current, next) {
		return e.ForbiddenError(serverText(requestLocale(e.Request), "demo.operationDisabled"), nil)
	}
	return nil
}

func demoModeExternalSideEffectGuard(handler func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// demo 访客共享同一账号；任何会触达第三方、远端存储或真实通知渠道的入口都必须在解码前短路。
		if err := demoModePolicy.RejectExternalSideEffect(e); err != nil {
			return err
		}
		return handler(e)
	}
}

func (p renewletDemoPolicy) EnforceRecordValidation(app core.App, record *core.Record) error {
	if !p.Enabled() || record == nil || record.Collection() == nil {
		return nil
	}
	switch record.Collection().Name {
	case "users":
		return p.enforceUserRecordValidation(record)
	case "settings":
		return p.enforceSettingsRecordValidation(app, record)
	case "subscriptions":
		return p.enforceOwnedRecordQuota(app, record, p.MaxSubscriptions, "DEMO_SUBSCRIPTION_QUOTA_EXCEEDED")
	case "assets":
		return p.enforceOwnedRecordQuota(app, record, p.MaxAssets, "DEMO_ASSET_QUOTA_EXCEEDED")
	case "cloud_backup_targets":
		return p.enforceCloudBackupTargetRecordValidation(app, record)
	default:
		return nil
	}
}

func (p renewletDemoPolicy) enforceUserRecordValidation(record *core.Record) error {
	if record.IsNew() {
		if strings.EqualFold(strings.TrimSpace(record.Email()), p.Email) {
			return errors.New("DEMO_ACCOUNT_PROTECTED")
		}
		return nil
	}
	original := record.Original()
	if strings.EqualFold(strings.TrimSpace(original.Email()), p.Email) || strings.EqualFold(strings.TrimSpace(record.Email()), p.Email) {
		// 账号保护放在持久层，覆盖 PocketBase collection REST、SDK 和管理后台，防止访客改密后锁死公共 demo。
		return errors.New("DEMO_ACCOUNT_PROTECTED")
	}
	return nil
}

func (p renewletDemoPolicy) enforceOwnedRecordQuota(app core.App, record *core.Record, maxRecords int, code string) error {
	if !record.IsNew() {
		return nil
	}
	userID := strings.TrimSpace(record.GetString("user"))
	if userID == "" || !p.IsUserID(app, userID) {
		return nil
	}
	total, err := app.CountRecords(record.Collection().Name, dbx.HashExp{"user": userID})
	if err != nil {
		return err
	}
	// quota 是 demo 公共账号的防滥用边界；业务 API、导入和 PocketBase REST 都必须落到这一处计数。
	if total >= int64(maxRecords) {
		return errors.New(code)
	}
	return nil
}

func (p renewletDemoPolicy) enforceSettingsRecordValidation(app core.App, record *core.Record) error {
	userID := strings.TrimSpace(record.GetString("user"))
	if userID == "" || !p.IsUserID(app, userID) {
		return nil
	}
	current := defaultAppSettings()
	if !record.IsNew() {
		settings, err := settingsFromValue(record.Original().Get("settings"))
		if err != nil {
			return err
		}
		current = settings
	}
	next, err := settingsFromValue(record.Get("settings"))
	if err != nil {
		return err
	}
	if demoProtectedSettingsChanged(current, next) {
		// settings 是整包保存；hook 只比较外部集成受保护子集，避免 demo 账号保存主题/预算时被误伤。
		return errors.New("DEMO_SETTINGS_PROTECTED")
	}
	return nil
}

func (p renewletDemoPolicy) enforceCloudBackupTargetRecordValidation(app core.App, record *core.Record) error {
	userID := strings.TrimSpace(record.GetString("user"))
	if userID == "" || !p.IsUserID(app, userID) {
		return nil
	}
	// 云备份 target 持有 write-only credential；hook 必须覆盖 REST/SDK/Admin UI，route 置灰不能作为安全边界。
	return errors.New("DEMO_CLOUD_BACKUP_TARGET_PROTECTED")
}

func (p renewletDemoPolicy) EnforceRecordDelete(record *core.Record) error {
	if p.IsUserRecord(record) {
		// 删除 demo 用户会级联清空账号本身，后续访客无法用固定凭据登录，只允许启动修复重新覆盖。
		return errors.New("DEMO_ACCOUNT_PROTECTED")
	}
	return nil
}

func demoProtectedSettingsChanged(current appSettings, next appSettings) bool {
	return !reflect.DeepEqual(demoProtectedSettingsSnapshotFrom(current), demoProtectedSettingsSnapshotFrom(next))
}

func demoProtectedSettingsSnapshotFrom(settings appSettings) demoProtectedSettingsSnapshot {
	settings = sanitizeSettings(settings)
	return demoProtectedSettingsSnapshot{
		AIRecognition:           settings.AIRecognition,
		EnabledChannels:         append([]string(nil), settings.EnabledChannels...),
		TestPhone:               strings.TrimSpace(settings.TestPhone),
		TelegramBotToken:        strings.TrimSpace(settings.TelegramBotToken),
		TelegramChatID:          strings.TrimSpace(settings.TelegramChatID),
		NotifyxAPIKey:           strings.TrimSpace(settings.NotifyxAPIKey),
		WebhookURL:              strings.TrimSpace(settings.WebhookURL),
		WebhookMethod:           strings.TrimSpace(settings.WebhookMethod),
		WebhookHeaders:          strings.TrimSpace(settings.WebhookHeaders),
		WebhookPayload:          strings.TrimSpace(settings.WebhookPayload),
		WechatWebhookURL:        strings.TrimSpace(settings.WechatWebhookURL),
		WechatMessageType:       strings.TrimSpace(settings.WechatMessageType),
		WechatAddModeTag:        settings.WechatAddModeTag,
		WechatAtPhones:          strings.TrimSpace(settings.WechatAtPhones),
		WechatAtAll:             settings.WechatAtAll,
		SMTPHost:                strings.TrimSpace(settings.SMTPHost),
		SMTPPort:                strings.TrimSpace(settings.SMTPPort),
		SMTPSecure:              settings.SMTPSecure,
		SMTPUser:                strings.TrimSpace(settings.SMTPUser),
		SMTPPassword:            strings.TrimSpace(settings.SMTPPassword),
		SMTPFrom:                strings.TrimSpace(settings.SMTPFrom),
		SMTPReplyTo:             strings.TrimSpace(settings.SMTPReplyTo),
		NotifyMultipleAddresses: settings.NotifyMultipleAddresses,
		RecipientEmail:          strings.TrimSpace(settings.RecipientEmail),
		BarkServerURL:           strings.TrimSpace(settings.BarkServerURL),
		BarkDeviceKey:           strings.TrimSpace(settings.BarkDeviceKey),
		BarkSilentPush:          settings.BarkSilentPush,
		ServerChanSendKey:       strings.TrimSpace(settings.ServerChanSendKey),
	}
}
