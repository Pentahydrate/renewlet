package main

// notification_scheduler.go 实现本地时间调度决策和全用户 cron 执行。
//
// 架构位置：cron tick、手动 force run 和历史概览都复用本文件的时间窗口判断，
// 保证“下一次检查”“今日是否发送”和 notification_jobs 唯一键含义一致。
//
// 状态机：
//   未到期 -> 跳过
//   到期 + 无渠道/无 payload -> 跳过 job
//   到期 + sending -> sent/failed
//   失败状态（failed）+ 可重试 -> 只重试失败渠道
//
// 注意： 这里按用户时区检查 today/yesterday，是为了覆盖 UTC tick 与用户本地跨日的边界窗口。
import (
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/pocketbase/pocketbase/core"
)

// registerNotificationCron 注册订阅提醒定时任务。
// TryLock 防止上一次发送尚未结束时重复 tick，避免同一用户在同一分钟收到重复通知。
func registerNotificationCron(app core.App) error {
	if !envBool("NOTIFICATION_SCHEDULER_ENABLED", true) {
		return nil
	}
	expr := envString("NOTIFICATION_SCHEDULER_CRON", "* * * * *")
	return app.Cron().Add("renewlet_notifications", expr, func() {
		if !notificationCronMu.TryLock() {
			log.Println("[notification-scheduler] previous run still active, skipping tick")
			return
		}
		defer notificationCronMu.Unlock()

		result, err := runNotificationCron(app, notificationCronOptions{})
		if err != nil {
			log.Printf("[notification-scheduler] run failed: %v", err)
			return
		}
		if result.Failed > 0 {
			log.Printf("[notification-scheduler] processed=%d sent=%d skipped=%d failed=%d", result.Processed, result.Sent, result.Skipped, result.Failed)
		}
	})
}

func todayDateOnly(now time.Time, timezone string) string {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	return now.In(loc).Format("2006-01-02")
}

func isValidDateOnly(value string) bool {
	if len(value) != len("2006-01-02") {
		return false
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func daysBetweenDateOnly(start, end string) int {
	startDate, err1 := time.Parse("2006-01-02", start)
	endDate, err2 := time.Parse("2006-01-02", end)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(endDate.Sub(startDate).Hours() / 24)
}

func addDateOnly(date string, days int) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02")
}

func isValidLocalTime(value string) bool {
	if len(value) != 5 || value[2] != ':' {
		return false
	}
	hour, errH := strconv.Atoi(value[:2])
	minute, errM := strconv.Atoi(value[3:])
	return errH == nil && errM == nil && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

func parseLocalTime(value string) (int, int) {
	hour, _ := strconv.Atoi(value[:2])
	minute, _ := strconv.Atoi(value[3:])
	return hour, minute
}

func getScheduleInstant(localDate, localTime, timezone string) (time.Time, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, err
	}
	day, err := time.Parse("2006-01-02", localDate)
	if err != nil {
		return time.Time{}, err
	}
	hour, minute := parseLocalTime(localTime)
	return time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, loc).UTC(), nil
}

// getLocalScheduleDecision 判断当前 tick 是否命中用户本地通知窗口。
// 同时检查昨天的本地日期，是为了覆盖 UTC tick 与用户时区跨日时的边界窗口。
func getLocalScheduleDecision(now time.Time, timezone string, localTime string, windowMinutes int, force bool) localScheduleDecision {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
		timezone = "UTC"
	}
	if !isValidLocalTime(localTime) {
		localTime = "08:00"
	}
	localNow := now.In(loc)
	today := localNow.Format("2006-01-02")
	if force {
		instant, _ := getScheduleInstant(today, localTime, timezone)
		return localScheduleDecision{
			localScheduleOccurrence: localScheduleOccurrence{ScheduledLocalDate: today, ScheduledLocalTime: localTime, TimeZone: timezone, ScheduledInstantUTC: instant.Format(time.RFC3339)},
			Due:                     true,
			Reason:                  "force",
		}
	}
	decision := buildScheduleDecision(now, today, localTime, timezone, windowMinutes)
	if decision.Due {
		return decision
	}
	yesterday := localNow.AddDate(0, 0, -1).Format("2006-01-02")
	// 例如用户在 UTC+14，而服务器按 UTC 分钟 tick；本地“昨天”的发送窗口可能仍落在当前 UTC 时间。
	yesterdayDecision := buildScheduleDecision(now, yesterday, localTime, timezone, windowMinutes)
	if yesterdayDecision.Due {
		return yesterdayDecision
	}
	return decision
}

func getNotificationScheduleDecision(now time.Time, settings appSettings, subscriptions []notificationSubscription, windowMinutes int, force bool) localScheduleDecision {
	regular := getLocalScheduleDecision(now, settings.Timezone, settings.NotificationTimeLocal, windowMinutes, force)
	if regular.Due || force {
		return regular
	}
	if repeat := getRepeatScheduleDecision(now, settings, subscriptions, windowMinutes); repeat.Due {
		return repeat
	}
	return regular
}

// buildScheduleDecision 将一个本地日期/时间转换为 UTC instant 并判断是否在窗口内。
func buildScheduleDecision(now time.Time, localDate string, localTime string, timezone string, windowMinutes int) localScheduleDecision {
	instant, err := getScheduleInstant(localDate, localTime, timezone)
	if err != nil {
		return localScheduleDecision{Due: false, Reason: "invalid_schedule"}
	}
	deltaMinutes := int(now.UTC().Sub(instant).Minutes())
	due := deltaMinutes >= 0 && deltaMinutes <= maxInt(windowMinutes, 0)
	reason := fmt.Sprintf("not_in_time_window(delta=%dm)", deltaMinutes)
	if deltaMinutes < 0 {
		reason = "before_scheduled_time"
	}
	return localScheduleDecision{
		localScheduleOccurrence: localScheduleOccurrence{
			ScheduledLocalDate:  localDate,
			ScheduledLocalTime:  localTime,
			TimeZone:            timezone,
			ScheduledInstantUTC: instant.Format(time.RFC3339),
		},
		Due:    due,
		Reason: reason,
	}
}

// getNextLocalScheduleOccurrence 返回下一次本地通知时间。
func getNextLocalScheduleOccurrence(now time.Time, timezone string, localTime string) localScheduleOccurrence {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
		timezone = "UTC"
	}
	if !isValidLocalTime(localTime) {
		localTime = "08:00"
	}
	localNow := now.In(loc)
	today := localNow.Format("2006-01-02")
	todayInstant, _ := getScheduleInstant(today, localTime, timezone)
	date := today
	if todayInstant.Before(now.UTC()) {
		date = localNow.AddDate(0, 0, 1).Format("2006-01-02")
	}
	instant, _ := getScheduleInstant(date, localTime, timezone)
	return localScheduleOccurrence{
		ScheduledLocalDate:  date,
		ScheduledLocalTime:  localTime,
		TimeZone:            timezone,
		ScheduledInstantUTC: instant.Format(time.RFC3339),
	}
}

// buildNotificationOverview 构建设置页展示的下一次检查、阻塞原因和未来提醒批次。
// PERF： 当前按未来 N 天逐日扫描订阅；订阅量明显增长后可改为按 nextBillingDate/trialEndDate 建索引查询。
func buildNotificationOverview(now time.Time, settings appSettings, subscriptions []notificationSubscription, days int) notificationOverview {
	days = maxInt(days, 1)
	dailyNextCheck := getNextLocalScheduleOccurrence(now, settings.Timezone, settings.NotificationTimeLocal)
	nextCheck := dailyNextCheck
	if repeatNext, ok := getNextRepeatScheduleOccurrence(now, settings, subscriptions); ok {
		if repeatInstant, err := time.Parse(time.RFC3339, repeatNext.ScheduledInstantUTC); err == nil {
			if dailyInstant, err := time.Parse(time.RFC3339, dailyNextCheck.ScheduledInstantUTC); err != nil || repeatInstant.Before(dailyInstant) {
				nextCheck = repeatNext
			}
		}
	}
	blockers := []string{}
	if len(settings.EnabledChannels) == 0 {
		blockers = append(blockers, "no_enabled_channels")
	}
	batchesByKey := map[string]*upcomingNotificationBatch{}
	for offset := 0; offset < days; offset++ {
		localDate := addDateOnly(dailyNextCheck.ScheduledLocalDate, offset)
		instant, _ := getScheduleInstant(localDate, settings.NotificationTimeLocal, settings.Timezone)
		occurrence := localScheduleOccurrence{
			ScheduledLocalDate:  localDate,
			ScheduledLocalTime:  settings.NotificationTimeLocal,
			TimeZone:            settings.Timezone,
			ScheduledInstantUTC: instant.Format(time.RFC3339),
		}
		items := collectNotificationItemsForSchedule(occurrence, settings, subscriptions, offset == 0)
		appendUpcomingBatch(batchesByKey, occurrence, items)
	}
	for _, batch := range collectUpcomingRepeatBatches(now, settings, subscriptions, days) {
		// 日常提醒和重复提醒可能落在同一分钟；统一走 appendUpcomingBatch 保持预览去重。
		appendUpcomingBatch(batchesByKey, batch.localScheduleOccurrence, batch.Items)
	}
	upcoming := make([]upcomingNotificationBatch, 0, len(batchesByKey))
	for _, batch := range batchesByKey {
		upcoming = append(upcoming, *batch)
	}
	sort.Slice(upcoming, func(i, j int) bool {
		return upcoming[i].ScheduledInstantUTC < upcoming[j].ScheduledInstantUTC
	})
	if len(upcoming) == 0 {
		blockers = append(blockers, "no_upcoming_items")
	}
	var nextBatch *upcomingNotificationBatch
	if len(upcoming) > 0 {
		nextBatch = &upcoming[0]
	}
	return notificationOverview{
		NextCheck:        nextCheck,
		NextContentBatch: nextBatch,
		Blockers:         blockers,
		EnabledChannels:  settings.EnabledChannels,
		UpcomingDays:     days,
		UpcomingBatches:  upcoming,
	}
}

// runNotificationCron 执行一次全用户通知调度。
// 状态机：
//
//	未到期 -> 跳过
//	到期 + 无渠道/无 payload -> 跳过 job
//	到期 + sending -> sent/failed
//	失败状态（failed）+ 可重试 -> 只重试失败渠道
func runNotificationCron(app core.App, options notificationCronOptions) (notificationCronResult, error) {
	options = resolveCronOptions(options)
	settingsRows, err := app.FindAllRecords("settings")
	if err != nil {
		return notificationCronResult{}, err
	}
	subscriptionRows, err := app.FindAllRecords("subscriptions")
	if err != nil {
		return notificationCronResult{}, err
	}
	subsByUser := map[string][]notificationSubscription{}
	for _, row := range subscriptionRows {
		userID := row.GetString("user")
		if userID == "" {
			continue
		}
		// 先按 user 分组，避免每个 settings 用户都全表扫描 subscriptions。
		subsByUser[userID] = append(subsByUser[userID], notificationSubscriptionFromRecord(row))
	}

	results := []notificationCronUserResult{}
	for _, row := range settingsRows {
		userID := row.GetString("user")
		if userID == "" {
			continue
		}
		settings := settingsFromRecord(row)
		subscriptions := subsByUser[userID]
		schedule := getNotificationScheduleDecision(options.Now, settings, subscriptions, options.WindowMinutes, options.Force)
		if !schedule.Due {
			results = append(results, notificationCronUserResult{
				UserID: userID,
				Action: "skipped",
				Reason: fmt.Sprintf("%s(localDate=%s, localTime=%s, timeZone=%s, window=%dm)", schedule.Reason, schedule.ScheduledLocalDate, schedule.ScheduledLocalTime, schedule.TimeZone, options.WindowMinutes),
			})
			continue
		}

		due := buildDueNotificationForSchedule(schedule.localScheduleOccurrence, options.Now, settings, subscriptions, true)
		existingJob, _ := getNotificationJob(app, userID, schedule.ScheduledLocalDate, schedule.ScheduledLocalTime, schedule.TimeZone)
		if existingJob != nil && (existingJob.GetString("status") == notificationStatusSent || existingJob.GetString("status") == notificationStatusSkipped) {
			reason := "already_sent"
			if existingJob.GetString("status") == notificationStatusSkipped {
				reason = "already_skipped"
			}
			results = append(results, notificationCronUserResult{UserID: userID, Action: "skipped", Reason: reason})
			continue
		}
		if existingJob != nil && existingJob.GetString("status") == notificationStatusSending {
			age := options.Now.Sub(existingJob.GetDateTime("updated").Time()).Minutes()
			// sending 可能来自上次进程崩溃或外部 API 长时间卡住；未过 stale 窗口时跳过，过期后允许接管重试。
			if age < float64(options.StaleSendingMinutes) && !options.Force {
				results = append(results, notificationCronUserResult{UserID: userID, Action: "skipped", Reason: "already_sending"})
				continue
			}
		}
		attempts := 0
		if existingJob != nil {
			attempts = existingJob.GetInt("attempts")
		}
		if !options.Force && existingJob != nil && existingJob.GetString("status") == notificationStatusFailed && options.MaxRetries == 0 {
			results = append(results, notificationCronUserResult{UserID: userID, Action: "skipped", Reason: "retries_disabled"})
			continue
		}
		if !options.Force && existingJob != nil && existingJob.GetString("status") == notificationStatusFailed && attempts >= options.MaxRetries {
			results = append(results, notificationCronUserResult{UserID: userID, Action: "skipped", Reason: "max_retries_reached"})
			continue
		}

		finalReason := ""
		if len(settings.EnabledChannels) == 0 {
			finalReason = "no_enabled_channels"
		} else if !due.HasPayload && !options.Force {
			finalReason = "no_due_items"
		}
		previousChannels := jobChannels{}
		if existingJob != nil && existingJob.GetString("status") == notificationStatusFailed {
			// 失败任务只重试失败渠道，已成功渠道不再重复推送。
			previousChannels = readJobChannels(existingJob)
		}
		channelsToSend := channelsToSend(existingJob, previousChannels, settings.EnabledChannels)
		// 失败渠道被禁用后没有可重试对象，此时把任务收敛为 sent，避免历史永远停在 failed。
		noRetryableChannels := existingJob != nil && existingJob.GetString("status") == notificationStatusFailed && len(channelsToSend) == 0

		if !options.DryRun && !noRetryableChannels {
			var created bool
			var err error
			if existingJob == nil {
				// createNotificationJob 依赖唯一索引处理并发；若另一个进程抢先创建，则本用户本轮跳过。
				existingJob, created, err = createNotificationJob(app, userID, schedule, notificationStatusSending, 1)
				if err != nil {
					return notificationCronResult{}, err
				}
				if !created {
					results = append(results, notificationCronUserResult{UserID: userID, Action: "skipped", Reason: "job_already_exists"})
					continue
				}
			} else if err := markNotificationJobSending(app, existingJob, attempts+1); err != nil {
				return notificationCronResult{}, err
			}
		}

		if options.DryRun {
			action := "sent"
			reason := "dry_run"
			if finalReason != "" {
				action = "skipped"
				reason = finalReason
			}
			// dry-run 只返回决策，不创建/更新 job，便于外部 Cron 调试时不污染幂等历史。
			results = append(results, notificationCronUserResult{UserID: userID, Action: action, Reason: reason})
			continue
		}

		if finalReason != "" {
			// 即使没有可发送内容也写入 skipped job，前端历史才能解释“本次 cron 已检查但无提醒”。
			result := createJobResult(finalReason, schedule.localScheduleOccurrence, settings, due, options, jobChannels{})
			if err := finalizeNotificationJob(app, existingJob, userID, schedule, notificationStatusSkipped, "", result); err != nil {
				return notificationCronResult{}, err
			}
			results = append(results, notificationCronUserResult{UserID: userID, Action: "skipped", Reason: finalReason})
			continue
		}

		if noRetryableChannels {
			channels := mergeChannelResults(previousChannels, sendSummary{}, settings.EnabledChannels)
			result := createJobResult("", schedule.localScheduleOccurrence, settings, due, options, channels)
			if err := finalizeNotificationJob(app, existingJob, userID, schedule, notificationStatusSent, "", result); err != nil {
				return notificationCronResult{}, err
			}
			results = append(results, notificationCronUserResult{UserID: userID, Action: "sent"})
			continue
		}

		summary := sendToChannels(app, channelsToSend, settings, due)
		channels := mergeChannelResults(previousChannels, summary, settings.EnabledChannels)
		status := notificationStatusSent
		lastError := ""
		reason := ""
		if len(channels.Failed) > 0 {
			status = notificationStatusFailed
			reason = "some_channels_failed"
			parts := make([]string, 0, len(channels.Failed))
			for _, failure := range channels.Failed {
				parts = append(parts, failure.Channel+": "+failure.Error)
			}
			lastError = strings.Join(parts, " | ")
		}
		result := createJobResult(reason, schedule.localScheduleOccurrence, settings, due, options, channels)
		if err := finalizeNotificationJob(app, existingJob, userID, schedule, status, lastError, result); err != nil {
			return notificationCronResult{}, err
		}
		action := "sent"
		if status == notificationStatusFailed {
			action = "failed"
		}
		results = append(results, notificationCronUserResult{UserID: userID, Action: action, Reason: reason})
	}

	return summarizeCronResult(options, results), nil
}

// resolveCronOptions 填充 cron 默认参数。
func resolveCronOptions(options notificationCronOptions) notificationCronOptions {
	if options.Now.IsZero() {
		options.Now = time.Now().UTC()
	}
	if options.WindowMinutes == 0 {
		options.WindowMinutes = maxInt(envInt("NOTIFICATION_CRON_WINDOW_MINUTES", 2), 0)
	}
	if options.MaxRetries == 0 {
		options.MaxRetries = maxInt(envInt("NOTIFICATION_MAX_RETRIES", 3), 0)
	}
	if options.StaleSendingMinutes == 0 {
		options.StaleSendingMinutes = maxInt(envInt("NOTIFICATION_STALE_SENDING_MINUTES", 15), 1)
	}
	return options
}
