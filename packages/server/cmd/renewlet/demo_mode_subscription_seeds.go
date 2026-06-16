package main

import (
	"strings"
	"time"
)

const (
	// 固定检查日期只描述 seed 数据出处，不能被当成实时价格刷新状态。
	demoModePriceCheckedAt = "2026-05-18"
	demoModeLogoProvider   = "thesvg"
)

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

// 日期必须从 reset 时刻滚动生成，避免公开 demo 随时间推移全部过期而失去可验收的续费/提醒样本。
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
