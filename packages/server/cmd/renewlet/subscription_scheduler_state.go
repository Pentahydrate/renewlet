package main

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const subscriptionSchedulerStatesCollection = "subscription_scheduler_states"

type subscriptionSchedulerState struct {
	AutoRenewCount         int
	RepeatReminderCount    int
	LastAutoRenewLocalDate string
}

func getSubscriptionSchedulerState(app core.App, userID string) (subscriptionSchedulerState, error) {
	if userID == "" {
		return subscriptionSchedulerState{}, nil
	}
	record, err := app.FindFirstRecordByFilter(subscriptionSchedulerStatesCollection, "user = {:user}", dbx.Params{"user": userID})
	if err == nil {
		return subscriptionSchedulerStateFromRecord(record), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return subscriptionSchedulerState{}, err
	}
	return refreshSubscriptionSchedulerState(app, userID, false)
}

func refreshSubscriptionSchedulerState(app core.App, userID string, resetAutoRenewCheck bool) (subscriptionSchedulerState, error) {
	if userID == "" {
		return subscriptionSchedulerState{}, nil
	}
	autoRenewCount, err := app.CountRecords("subscriptions", dbx.NewExp("[[user]] = {:user} AND [[autoRenew]] = true", dbx.Params{"user": userID}))
	if err != nil {
		return subscriptionSchedulerState{}, err
	}
	repeatReminderCount, err := app.CountRecords("subscriptions", dbx.NewExp("[[user]] = {:user} AND [[repeatReminderEnabled]] = true", dbx.Params{"user": userID}))
	if err != nil {
		return subscriptionSchedulerState{}, err
	}
	collection, err := app.FindCollectionByNameOrId(subscriptionSchedulerStatesCollection)
	if err != nil {
		return subscriptionSchedulerState{}, err
	}
	record, err := app.FindFirstRecordByFilter(subscriptionSchedulerStatesCollection, "user = {:user}", dbx.Params{"user": userID})
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return subscriptionSchedulerState{}, err
		}
		record = core.NewRecord(collection)
		record.Set("user", userID)
	}
	record.Set("autoRenewCount", int(autoRenewCount))
	record.Set("repeatReminderCount", int(repeatReminderCount))
	if resetAutoRenewCheck {
		// 订阅写入后同一天的自动续订判定必须失效；否则新增过期 autoRenew 项会被 last-date gate 跳到明天。
		record.Set("lastAutoRenewLocalDate", "")
	}
	if err := app.Save(record); err != nil {
		return subscriptionSchedulerState{}, err
	}
	return subscriptionSchedulerStateFromRecord(record), nil
}

func markSubscriptionAutoRenewChecked(app core.App, userID string, localDate string) error {
	state, err := getSubscriptionSchedulerState(app, userID)
	if err != nil {
		return err
	}
	record, err := app.FindFirstRecordByFilter(subscriptionSchedulerStatesCollection, "user = {:user}", dbx.Params{"user": userID})
	if err != nil {
		return err
	}
	if state.LastAutoRenewLocalDate == localDate {
		return nil
	}
	record.Set("lastAutoRenewLocalDate", localDate)
	return app.Save(record)
}

func backfillSubscriptionSchedulerStates(app core.App) error {
	for offset := 0; ; offset += subscriptionRenewalMaintenancePageSize {
		users, err := app.FindRecordsByFilter("users", "id != ''", "created", subscriptionRenewalMaintenancePageSize, offset)
		if err != nil {
			return err
		}
		for _, user := range users {
			if _, err := refreshSubscriptionSchedulerState(app, user.Id, false); err != nil {
				return err
			}
		}
		if len(users) < subscriptionRenewalMaintenancePageSize {
			return nil
		}
	}
}

func subscriptionSchedulerStateFromRecord(record *core.Record) subscriptionSchedulerState {
	return subscriptionSchedulerState{
		AutoRenewCount:         record.GetInt("autoRenewCount"),
		RepeatReminderCount:    record.GetInt("repeatReminderCount"),
		LastAutoRenewLocalDate: record.GetString("lastAutoRenewLocalDate"),
	}
}
