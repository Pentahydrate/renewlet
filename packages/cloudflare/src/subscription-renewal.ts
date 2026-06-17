import {
  advanceSubscriptionRenewal as advanceSharedSubscriptionRenewal,
  type RenewalMode,
  type SubscriptionRenewalInput,
  type SubscriptionRenewalResult,
} from "@renewlet/shared/subscription-renewal";
import { getSettings, nowIso, SUBSCRIPTION_COLUMNS } from "./db";
import type { Env, SubscriptionRow } from "./types";

const RENEWAL_MAINTENANCE_PAGE_SIZE = 500;
const RECURRING_BILLING_CYCLE_SQL = "billing_cycle IN ('weekly', 'monthly', 'quarterly', 'semi-annual', 'annual', 'custom')";

/**
 * 将 D1 订阅行推进为 shared 续订结果。
 *
 * Cloudflare 运行面只做 row -> shared input 映射，账单日算法本身不在 Worker 内复制分叉。
 */
export function advanceSubscriptionRenewal(
  row: SubscriptionRow,
  today: string,
  mode: RenewalMode,
): SubscriptionRenewalResult | null {
  return advanceSharedSubscriptionRenewal(subscriptionRenewalInputFromRow(row), today, mode);
}

/** Worker 续订维护按用户设置时区生成 date-only today；不能用 UTC 日期替代用户本地账单日。 */
export function dateOnlyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** scheduled 顶层先跑全用户自动续订，再进入通知调度，避免过期旧日期进入本轮提醒。 */
export async function renewAutoSubscriptionsForAllUsers(env: Env, now = new Date()): Promise<{ usersProcessed: number; subscriptionsUpdated: number }> {
  let usersProcessed = 0;
  let subscriptionsUpdated = 0;
  for (let offset = 0; ; offset += RENEWAL_MAINTENANCE_PAGE_SIZE) {
    const users = await env.DB.prepare("SELECT id FROM users WHERE banned = 0 ORDER BY id LIMIT ? OFFSET ?")
      .bind(RENEWAL_MAINTENANCE_PAGE_SIZE, offset)
      .all<{ id: string }>();
    for (const user of users.results) {
      subscriptionsUpdated += await renewAutoSubscriptionsForUser(env, user.id, now);
      usersProcessed += 1;
    }
    if (users.results.length < RENEWAL_MAINTENANCE_PAGE_SIZE) break;
  }
  return { usersProcessed, subscriptionsUpdated };
}

/** 单用户入口从 settings 读取时区；通知、手动运行和 Cron 都复用同一 today 计算。 */
export async function renewAutoSubscriptionsForUser(env: Env, userId: string, now = new Date()): Promise<number> {
  const settings = await getSettings(env, userId);
  return renewAutoSubscriptionsForUserInTimezone(env, userId, settings.timezone, now);
}

export async function renewAutoSubscriptionsForUserInTimezone(env: Env, userId: string, timezone: string, now = new Date()): Promise<number> {
  if (!userId) return 0;
  const today = dateOnlyInZone(now, timezone);
  let updated = 0;
  for (;;) {
    let pageUpdated = 0;
    const rows = await env.DB.prepare(`
      SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
      WHERE user_id = ? AND auto_renew = 1 AND ${RECURRING_BILLING_CYCLE_SQL}
        AND next_billing_date < ? AND (status = 'active' OR status = 'trial')
      ORDER BY next_billing_date ASC, id ASC
      LIMIT ?
    `).bind(userId, today, RENEWAL_MAINTENANCE_PAGE_SIZE).all<SubscriptionRow>();
    for (const row of rows.results) {
      const result = advanceSubscriptionRenewal(row, today, "auto");
      if (!result) continue;
      await persistRenewalResult(env, userId, row.id, result);
      updated += 1;
      pageUpdated += 1;
    }
    // 本轮更新后继续从头查，保证一次 cron 能追上跨多期过期订阅，同时不会依赖被改写的游标。
    if (pageUpdated === 0) return updated;
    if (rows.results.length < RENEWAL_MAINTENANCE_PAGE_SIZE) return updated;
  }
}

function subscriptionRenewalInputFromRow(row: SubscriptionRow): SubscriptionRenewalInput {
  return {
    billingCycle: row.billing_cycle as SubscriptionRenewalInput["billingCycle"],
    status: row.status as SubscriptionRenewalInput["status"],
    startDate: row.start_date,
    nextBillingDate: row.next_billing_date,
    autoRenew: row.billing_cycle !== "one-time" && row.auto_renew === 1,
    autoCalculateNextBillingDate: row.auto_calculate_next_billing_date === 1,
    customDays: row.custom_days,
    customCycleUnit: row.custom_cycle_unit,
  };
}

async function persistRenewalResult(env: Env, userId: string, id: string, result: SubscriptionRenewalResult): Promise<void> {
  const timestamp = nowIso();
  // 自动续订在通知内容生成前改写 next_billing_date；写入保持 owner 过滤，防止维护任务误碰其它用户行。
  await env.DB.prepare(`
    UPDATE subscriptions SET next_billing_date = ?, status = ?, updated_at = ?
    WHERE user_id = ? AND id = ?
  `).bind(result.nextBillingDate, result.status, timestamp, userId, id).run();
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "00";
}
