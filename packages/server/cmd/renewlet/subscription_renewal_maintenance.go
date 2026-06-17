package main

// subscription_renewal_maintenance.go 注册 Docker/Go 自动续订维护任务。
//
// 维护任务按用户时区计算 today，并在通知生成前幂等推进 autoRenew 订阅，
// 避免已自动续订的记录仍用旧账单日进入 expired/renewal 通知。
import (
	"log/slog"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const subscriptionRenewalMaintenancePageSize = 500

var subscriptionRenewalCronMu sync.Mutex

func positiveRecurringBillingCycleFilter(field string) string {
	// 正向枚举让自动续订候选查询命中复合索引；!= one-time 在 D1/PocketBase 下都容易退化成宽扫描。
	return "(" + field + " = 'weekly' || " +
		field + " = 'monthly' || " +
		field + " = 'quarterly' || " +
		field + " = 'semi-annual' || " +
		field + " = 'annual' || " +
		field + " = 'custom')"
}

type subscriptionRenewalMaintenanceResult struct {
	UsersProcessed       int
	SubscriptionsUpdated int
}

func registerSubscriptionRenewalCron(app core.App) error {
	if !envBool("SUBSCRIPTION_RENEWAL_SCHEDULER_ENABLED", true) {
		return nil
	}
	expr := envString("SUBSCRIPTION_RENEWAL_SCHEDULER_CRON", "* * * * *")
	return app.Cron().Add("renewlet_subscription_renewals", expr, func() {
		if !subscriptionRenewalCronMu.TryLock() {
			// Cron tick 可能因慢数据库或大量用户重叠；跳过重入比并发推进同一订阅更安全。
			slog.Info("subscription renewal maintenance skipped overlapping tick")
			return
		}
		defer subscriptionRenewalCronMu.Unlock()

		result, err := renewAutoSubscriptionsForAllUsers(app, time.Now())
		if err != nil {
			slog.Error("subscription renewal maintenance failed", "error", err)
			return
		}
		if result.SubscriptionsUpdated > 0 {
			slog.Info("subscription renewal maintenance completed",
				"users", result.UsersProcessed,
				"updated", result.SubscriptionsUpdated,
			)
		}
	})
}

func renewAutoSubscriptionsForAllUsers(app core.App, now time.Time) (subscriptionRenewalMaintenanceResult, error) {
	result := subscriptionRenewalMaintenanceResult{}
	for offset := 0; ; offset += subscriptionRenewalMaintenancePageSize {
		users, err := app.FindRecordsByFilter("users", "banned = false", "created", subscriptionRenewalMaintenancePageSize, offset)
		if err != nil {
			return result, err
		}
		for _, user := range users {
			if demoModePolicy.IsUserRecord(user) {
				// demo 数据靠固定 reset 周期回到基线；自动续订会让访客看到的日期随后台 tick 漂移。
				continue
			}
			settings, err := currentUserSettings(app, user, nil)
			if err != nil {
				// settings 损坏不能让该用户永久跳过自动续订；回落默认时区后仍按持久层校验保存。
				settings = defaultAppSettings()
			}
			updated, err := renewAutoSubscriptionsForUser(app, user.Id, settings.Timezone, now)
			if err != nil {
				return result, err
			}
			result.UsersProcessed++
			result.SubscriptionsUpdated += updated
		}
		if len(users) < subscriptionRenewalMaintenancePageSize {
			return result, nil
		}
	}
}

func renewAutoSubscriptionsForUser(app core.App, userID string, timezone string, now time.Time) (int, error) {
	if userID == "" {
		return 0, nil
	}
	if demoModePolicy.IsUserID(app, userID) {
		// 手动通知概览也会调用该 helper；这里统一跳过，避免 demo 只读预览路径产生写库副作用。
		return 0, nil
	}
	today := todayDateOnly(now, timezone)
	updated := 0
	for {
		// 每轮都从第 0 页按 nextBillingDate 重新查；更新后记录会离开条件，避免 offset 跳过跨多期过期项。
		rows, err := app.FindRecordsByFilter(
			"subscriptions",
			"user = {:user} && autoRenew = true && "+positiveRecurringBillingCycleFilter("billingCycle")+" && nextBillingDate < {:today} && (status = 'active' || status = 'trial')",
			"nextBillingDate",
			subscriptionRenewalMaintenancePageSize,
			0,
			dbx.Params{"user": userID, "today": today},
		)
		if err != nil {
			return updated, err
		}
		for _, record := range rows {
			result, ok, err := advanceSubscriptionRenewal(subscriptionRenewalInputFromRecord(record), today, renewalModeAuto)
			if err != nil {
				return updated, err
			}
			if !ok {
				continue
			}
			record.Set("nextBillingDate", result.NextBillingDate)
			record.Set("status", result.Status)
			if err := app.Save(record); err != nil {
				return updated, err
			}
			updated++
		}
		if len(rows) < subscriptionRenewalMaintenancePageSize {
			return updated, nil
		}
	}
}
