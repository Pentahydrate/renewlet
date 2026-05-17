package main

// notification_content.go 将订阅投影转换为可发送的通知内容。
//
// 架构位置：调度器、手动运行和测试发送共享同一套内容构建，确保历史记录、渠道文本和前端预览口径一致。
// 这里刻意按 date-only 计算提醒窗口，因为扣费日是用户本地业务日期，不应被 UTC instant 或 DST 影响。
//
// 注意： 调整 item type 或文案分组会影响所有渠道文本和 notification job result schema。
import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// listNotificationSubscriptions 读取通知计算所需的订阅投影。
func listNotificationSubscriptions(app core.App, userID string) ([]notificationSubscription, error) {
	rows, err := app.FindAllRecords("subscriptions", dbx.HashExp{"user": userID})
	if err != nil {
		return nil, err
	}
	subscriptions := make([]notificationSubscription, 0, len(rows))
	for _, row := range rows {
		subscriptions = append(subscriptions, notificationSubscriptionFromRecord(row))
	}
	return subscriptions, nil
}

func notificationSubscriptionFromRecord(row *core.Record) notificationSubscription {
	return notificationSubscription{
		ID:                     row.Id,
		Name:                   row.GetString("name"),
		LogoURL:                row.GetString("logo"),
		Price:                  row.GetFloat("price"),
		Currency:               row.GetString("currency"),
		Status:                 row.GetString("status"),
		NextBillingDate:        row.GetString("nextBillingDate"),
		TrialEndDate:           row.GetString("trialEndDate"),
		ReminderDays:           row.GetInt("reminderDays"),
		RepeatReminderEnabled:  row.GetBool("repeatReminderEnabled"),
		RepeatReminderInterval: normalizeRepeatReminderInterval(row.GetString("repeatReminderInterval")),
		RepeatReminderWindow:   normalizeRepeatReminderWindow(row.GetString("repeatReminderWindow")),
	}
}

// buildTestNotification 构造测试通知内容。
func buildTestNotification(now time.Time, settings appSettings) notificationMessage {
	locale := normalizeAppLocale(settings.Locale)
	return notificationMessage{
		Title:      tr(locale, "Renewlet 测试通知", "Renewlet test notification"),
		Content:    tr(locale, "如果你收到了这条消息，说明该通知渠道配置可用。", "If you received this message, this notification channel is working."),
		Timestamp:  formatNotificationTime(now, settings.Timezone),
		Items:      []notificationContentItem{},
		HasPayload: true,
	}
}

// buildDueNotification 根据当前时间和用户时区构造到期提醒。
func buildDueNotification(now time.Time, settings appSettings, subscriptions []notificationSubscription, includeExpired bool) notificationMessage {
	localDate := todayDateOnly(now, settings.Timezone)
	items := collectNotificationItems(localDate, settings, subscriptions, includeExpired)
	return buildNotificationContent(now, settings, items)
}

// buildDueNotificationForLocalDate 按指定本地日期构造提醒。
func buildDueNotificationForLocalDate(localDate string, now time.Time, settings appSettings, subscriptions []notificationSubscription, includeExpired bool) notificationMessage {
	items := collectNotificationItems(localDate, settings, subscriptions, includeExpired)
	return buildNotificationContent(now, settings, items)
}

func buildDueNotificationForSchedule(schedule localScheduleOccurrence, now time.Time, settings appSettings, subscriptions []notificationSubscription, includeExpired bool) notificationMessage {
	items := collectNotificationItemsForSchedule(schedule, settings, subscriptions, includeExpired)
	return buildNotificationContent(now, settings, items)
}

func collectNotificationItemsForSchedule(schedule localScheduleOccurrence, settings appSettings, subscriptions []notificationSubscription, includeExpired bool) []notificationContentItem {
	items := []notificationContentItem{}
	if schedule.ScheduledLocalTime == settings.NotificationTimeLocal {
		items = append(items, collectNotificationItems(schedule.ScheduledLocalDate, settings, subscriptions, includeExpired)...)
	}
	items = append(items, collectRepeatNotificationItems(schedule, settings, subscriptions)...)
	return items
}

// collectNotificationItems 收集指定本地日期应该提醒的项目。
// 为什么用 date-only 差值：订阅扣费日是业务日期，不应受 UTC instant 或 DST 切换影响。
func collectNotificationItems(localDate string, settings appSettings, subscriptions []notificationSubscription, includeExpired bool) []notificationContentItem {
	items := []notificationContentItem{}
	for _, sub := range subscriptions {
		if isValidDateOnly(sub.NextBillingDate) {
			daysUntilNext := daysBetweenDateOnly(localDate, sub.NextBillingDate)
			if daysUntilNext < 0 {
				if settings.ShowExpired && includeExpired {
					items = append(items, newNotificationContentItem("expired", sub, sub.NextBillingDate, daysUntilNext, nil))
				}
			} else if daysUntilNext == sub.ReminderDays {
				items = append(items, newNotificationContentItem("renewal", sub, sub.NextBillingDate, daysUntilNext, nil))
			}
		}

		if sub.Status == "trial" && isValidDateOnly(sub.TrialEndDate) {
			daysUntilTrialEnd := daysBetweenDateOnly(localDate, sub.TrialEndDate)
			if daysUntilTrialEnd == sub.ReminderDays {
				items = append(items, newNotificationContentItem("trial", sub, sub.TrialEndDate, daysUntilTrialEnd, nil))
			}
		}
	}
	return items
}

func collectRepeatNotificationItems(schedule localScheduleOccurrence, settings appSettings, subscriptions []notificationSubscription) []notificationContentItem {
	scheduledInstant, err := time.Parse(time.RFC3339, schedule.ScheduledInstantUTC)
	if err != nil {
		return []notificationContentItem{}
	}
	items := []notificationContentItem{}
	for _, sub := range subscriptions {
		if !sub.RepeatReminderEnabled {
			continue
		}
		repeat := &repeatReminderSnapshot{
			Interval: normalizeRepeatReminderInterval(sub.RepeatReminderInterval),
			Window:   normalizeRepeatReminderWindow(sub.RepeatReminderWindow),
		}
		if isValidDateOnly(sub.NextBillingDate) && repeatReminderOccurrenceMatches(scheduledInstant, settings, sub.ReminderDays, sub.NextBillingDate, repeat) {
			items = append(items, newNotificationContentItem("renewal", sub, sub.NextBillingDate, daysBetweenDateOnly(schedule.ScheduledLocalDate, sub.NextBillingDate), repeat))
		}
		if sub.Status == "trial" && isValidDateOnly(sub.TrialEndDate) && repeatReminderOccurrenceMatches(scheduledInstant, settings, sub.ReminderDays, sub.TrialEndDate, repeat) {
			items = append(items, newNotificationContentItem("trial", sub, sub.TrialEndDate, daysBetweenDateOnly(schedule.ScheduledLocalDate, sub.TrialEndDate), repeat))
		}
	}
	return items
}

func newNotificationContentItem(itemType string, sub notificationSubscription, targetDate string, daysUntil int, repeat *repeatReminderSnapshot) notificationContentItem {
	status := normalizeSubscriptionStatus(sub.Status)
	if itemType == "trial" {
		status = "trial"
	}
	return notificationContentItem{
		Type:           itemType,
		SubscriptionID: sub.ID,
		Name:           sub.Name,
		LogoURL:        sub.LogoURL,
		Price:          sub.Price,
		Currency:       sub.Currency,
		Status:         status,
		TargetDate:     targetDate,
		ReminderDays:   sub.ReminderDays,
		DaysUntil:      daysUntil,
		RepeatReminder: repeat,
	}
}

func repeatReminderOccurrenceMatches(scheduledInstant time.Time, settings appSettings, reminderDays int, targetDate string, repeat *repeatReminderSnapshot) bool {
	targetInstant, err := getScheduleInstant(targetDate, settings.NotificationTimeLocal, settings.Timezone)
	if err != nil {
		return false
	}
	firstInstant, err := getScheduleInstant(addDateOnly(targetDate, -reminderDays), settings.NotificationTimeLocal, settings.Timezone)
	if err != nil {
		return false
	}
	if !scheduledInstant.After(firstInstant) || scheduledInstant.After(targetInstant) {
		return false
	}
	windowStart := firstInstant
	if duration, full := repeatReminderWindowDuration(repeat.Window); !full {
		candidate := targetInstant.Add(-duration)
		if candidate.After(windowStart) {
			windowStart = candidate
		}
	}
	if scheduledInstant.Before(windowStart) {
		return false
	}
	elapsed := scheduledInstant.Sub(firstInstant)
	interval := repeatReminderIntervalDuration(repeat.Interval)
	return interval > 0 && elapsed%interval == 0
}

// buildNotificationContent 将提醒项分组为可读消息。
func buildNotificationContent(now time.Time, settings appSettings, items []notificationContentItem) notificationMessage {
	locale := normalizeAppLocale(settings.Locale)
	renewals := []string{}
	trials := []string{}
	expired := []string{}
	for _, item := range items {
		line := formatNotificationItemLine(item, locale)
		switch item.Type {
		case "trial":
			trials = append(trials, line)
		case "expired":
			expired = append(expired, line)
		default:
			renewals = append(renewals, line)
		}
	}

	blocks := []string{}
	if len(renewals) > 0 {
		blocks = append(blocks, tr(locale, "即将续费：", "Upcoming renewals:")+"\n"+strings.Join(renewals, "\n"))
	}
	if len(trials) > 0 {
		blocks = append(blocks, tr(locale, "试用结束：", "Trial ending:")+"\n"+strings.Join(trials, "\n"))
	}
	if len(expired) > 0 {
		blocks = append(blocks, tr(locale, "已过期（未更新下次扣费日期）：", "Expired (next billing date not updated):")+"\n"+strings.Join(expired, "\n"))
	}
	hasPayload := len(blocks) > 0
	content := tr(locale, "今天没有需要提醒的订阅（你可以在设置页关闭“每日通知”，或调整各订阅的提醒天数）。", "No subscriptions need reminders today. You can disable daily notifications in Settings or adjust reminder days for subscriptions.")
	if hasPayload {
		content = strings.Join(blocks, "\n\n")
	}
	return notificationMessage{
		Title:      tr(locale, "Renewlet 订阅提醒", "Renewlet subscription reminder"),
		Content:    content,
		Timestamp:  formatNotificationTime(now, settings.Timezone),
		Items:      items,
		HasPayload: hasPayload,
	}
}

func formatNotificationItemLine(item notificationContentItem, locale appLocale) string {
	extra := fmt.Sprintf(tr(locale, "提前 %d 天提醒", "%d days before"), item.ReminderDays)
	if item.Type == "trial" {
		extra = fmt.Sprintf(tr(locale, "试用结束，提前 %d 天提醒", "trial ends, %d days before"), item.ReminderDays)
	} else if item.Type == "expired" {
		extra = tr(locale, "已过期", "expired")
	}
	if item.RepeatReminder != nil {
		extra += tr(locale, "；", "; ") + formatRepeatReminderText(item.RepeatReminder.Interval, locale)
	}
	if locale == localeEnUS {
		return fmt.Sprintf("- %s: %s, %s %s (%s)", item.Name, item.TargetDate, formatAmount(item.Price), item.Currency, extra)
	}
	return fmt.Sprintf("- %s：%s，%s %s（%s）", item.Name, item.TargetDate, formatAmount(item.Price), item.Currency, extra)
}

func formatRepeatReminderText(interval string, locale appLocale) string {
	hours := repeatReminderIntervalHours(interval)
	if locale == localeEnUS {
		unit := "hours"
		if hours == 1 {
			unit = "hour"
		}
		return fmt.Sprintf("repeat reminder, every %d %s", hours, unit)
	}
	return fmt.Sprintf("重复提醒，每 %d 小时", hours)
}

func formatAmount(amount float64) string {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return fmt.Sprintf("%v", amount)
	}
	fixed := strconv.FormatFloat(amount, 'f', 2, 64)
	fixed = strings.TrimSuffix(fixed, ".00")
	if strings.HasSuffix(fixed, "0") && strings.Contains(fixed, ".") {
		fixed = strings.TrimSuffix(fixed, "0")
	}
	return fixed
}

func formatNotificationTime(now time.Time, timezone string) string {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
		timezone = "UTC"
	}
	return now.In(loc).Format("2006-01-02 15:04:05") + " " + timezone
}

func normalizeSubscriptionStatus(status string) string {
	switch status {
	case "trial", "active", "paused", "cancelled":
		return status
	default:
		return "active"
	}
}
