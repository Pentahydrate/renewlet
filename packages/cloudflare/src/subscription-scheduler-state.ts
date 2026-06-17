import { nowIso } from "./db";
import type { Env, SubscriptionSchedulerStateRow } from "./types";

const emptySchedulerState: Omit<SubscriptionSchedulerStateRow, "user_id"> = {
  auto_renew_count: 0,
  repeat_reminder_count: 0,
  last_auto_renew_local_date: "",
  created_at: "",
  updated_at: "",
};

export async function getSubscriptionSchedulerState(env: Env, userId: string): Promise<SubscriptionSchedulerStateRow> {
  const row = await readSubscriptionSchedulerState(env, userId);
  if (row) return normalizeSchedulerState(row);
  await refreshSubscriptionSchedulerState(env, userId, { resetAutoRenewCheck: false });
  return normalizeSchedulerState(await readSubscriptionSchedulerState(env, userId) ?? { user_id: userId, ...emptySchedulerState });
}

export async function refreshSubscriptionSchedulerState(
  env: Env,
  userId: string,
  options: { resetAutoRenewCheck?: boolean } = {},
): Promise<void> {
  if (!userId) return;
  const timestamp = nowIso();
  // 订阅写入会改变“今天是否已检查自动续订”的含义；重算 gate 时清空日期，下一次 cron 才能重新判定新数据。
  const resetLastChecked = options.resetAutoRenewCheck === true
    ? "last_auto_renew_local_date = '',"
    : "";
  await env.DB.prepare(`
    INSERT INTO subscription_scheduler_state (
      user_id, auto_renew_count, repeat_reminder_count, last_auto_renew_local_date, created_at, updated_at
    )
    SELECT
      ?,
      COALESCE(SUM(CASE WHEN auto_renew = 1 THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN repeat_reminder_enabled = 1 THEN 1 ELSE 0 END), 0),
      '',
      ?,
      ?
    FROM subscriptions
    WHERE user_id = ?
    ON CONFLICT(user_id) DO UPDATE SET
      auto_renew_count = excluded.auto_renew_count,
      repeat_reminder_count = excluded.repeat_reminder_count,
      ${resetLastChecked}
      updated_at = excluded.updated_at
  `).bind(userId, timestamp, timestamp, userId).run();
}

export async function markAutoRenewCheckedForLocalDate(env: Env, userId: string, localDate: string): Promise<void> {
  if (!userId || !localDate) return;
  const result = await env.DB.prepare(`
    UPDATE subscription_scheduler_state
    SET last_auto_renew_local_date = ?, updated_at = ?
    WHERE user_id = ?
  `).bind(localDate, nowIso(), userId).run();
  if ((result.meta.changes ?? 0) > 0) return;
  await refreshSubscriptionSchedulerState(env, userId, { resetAutoRenewCheck: false });
  await env.DB.prepare(`
    UPDATE subscription_scheduler_state
    SET last_auto_renew_local_date = ?, updated_at = ?
    WHERE user_id = ?
  `).bind(localDate, nowIso(), userId).run();
}

async function readSubscriptionSchedulerState(env: Env, userId: string): Promise<SubscriptionSchedulerStateRow | null> {
  if (!userId) return null;
  return await env.DB.prepare(`
    SELECT user_id, auto_renew_count, repeat_reminder_count, last_auto_renew_local_date, created_at, updated_at
    FROM subscription_scheduler_state
    WHERE user_id = ?
  `).bind(userId).first<SubscriptionSchedulerStateRow>();
}

function normalizeSchedulerState(row: SubscriptionSchedulerStateRow): SubscriptionSchedulerStateRow {
  return {
    ...row,
    auto_renew_count: numberValue(row.auto_renew_count),
    repeat_reminder_count: numberValue(row.repeat_reminder_count),
    last_auto_renew_local_date: row.last_auto_renew_local_date ?? "",
  };
}

function numberValue(value: number | string | null): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value) || 0;
  return 0;
}
