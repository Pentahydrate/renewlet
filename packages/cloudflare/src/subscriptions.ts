import { subscriptionCreateBodySchema, subscriptionsListQuerySchema, subscriptionUpdateBodySchema } from "@renewlet/shared/schemas/subscriptions";
import { boolToInt, countSubscriptions, getSubscription, listSubscriptionsPage, newId, nowIso, parseJsonObject, parseSubscriptionCursor, subscriptionCursor, toApiSubscription } from "./db";
import { HttpError, json, ok, readJson, requestLocale } from "./http";
import { serverText } from "./server-i18n";
import { requireAuth } from "./auth";
import type { Env, SubscriptionRow } from "./types";
import { z } from "zod";

const subscriptionStorageBodySchema = subscriptionCreateBodySchema.refine((body) => body.nextBillingDate >= body.startDate, {
  path: ["nextBillingDate"],
  message: "NEXT_BILLING_DATE_BEFORE_START_DATE",
});

/** 读取当前用户订阅页；cursor 只决定分页位置，权限始终来自 Worker session。 */
export async function readSubscriptions(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const parsed = subscriptionsListQuerySchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (parsed.cursor && !parseSubscriptionCursor(parsed.cursor)) {
    throw new HttpError(400, serverText(requestLocale(request), "common.invalidRequestParameters"), "INVALID_CURSOR");
  }
  const rows = await listSubscriptionsPage(env, auth.user.id, { limit: parsed.limit + 1, cursor: parsed.cursor });
  const pageRows = rows.slice(0, parsed.limit);
  const nextCursor = rows.length > parsed.limit ? subscriptionCursor(pageRows[pageRows.length - 1]!) : null;
  return json({
    subscriptions: pageRows.map(toApiSubscription),
    nextCursor,
    total: await countSubscriptions(env, auth.user.id),
  });
}

/** 新建订阅走 shared create schema，确保 D1 写入边界与 Go/PocketBase API 保持同形。 */
export async function createSubscription(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = parseSubscriptionBodyForStorage(await readJson(request, subscriptionCreateBodySchema, locale), locale);
  const timestamp = nowIso();
  const row = toSubscriptionRow(newId("sub"), auth.user.id, body, timestamp, timestamp);
  await env.DB.prepare(`
    INSERT INTO subscriptions (
      id, user_id, name, logo, price, currency, billing_cycle, custom_days, custom_cycle_unit, category, status, pinned, payment_method,
      start_date, next_billing_date, auto_calculate_next_billing_date, trial_end_date, website, notes, tags_json,
      reminder_days, repeat_reminder_enabled, repeat_reminder_interval, repeat_reminder_window, extra_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(...subscriptionRowValues(row)).run();
  return json({ subscription: toApiSubscription(row) }, { status: 201 });
}

/** 更新订阅先合并为完整 create body，再转换为 D1 row，模拟 PocketBase hook 的最终规范化效果。 */
export async function updateSubscription(request: Request, env: Env, id: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const existing = await getSubscription(env, auth.user.id, id);
  if (!existing) throw new HttpError(404, serverText(locale, "subscription.notFound"));
  const patch = await readJson(request, subscriptionUpdateBodySchema, locale);
  const timestamp = nowIso();
  // Worker 没有 PocketBase hook 可二次归一；更新必须先回 API body，再合并 patch 走同一套 create schema。
  const mergedBody = parseSubscriptionBodyForStorage({ ...toBody(existing), ...stripUndefined(patch) }, locale);
  const merged = toSubscriptionRow(existing.id, auth.user.id, mergedBody, existing.created_at, timestamp);
  await env.DB.prepare(`
    UPDATE subscriptions SET
      name = ?, logo = ?, price = ?, currency = ?, billing_cycle = ?, custom_days = ?, custom_cycle_unit = ?, category = ?, status = ?,
      pinned = ?, payment_method = ?, start_date = ?, next_billing_date = ?, auto_calculate_next_billing_date = ?,
      trial_end_date = ?, website = ?, notes = ?, tags_json = ?, reminder_days = ?, repeat_reminder_enabled = ?,
      repeat_reminder_interval = ?, repeat_reminder_window = ?, extra_json = ?, updated_at = ?
    WHERE user_id = ? AND id = ?
  `).bind(
    merged.name,
    merged.logo,
    merged.price,
    merged.currency,
    merged.billing_cycle,
    merged.custom_days,
    merged.custom_cycle_unit,
    merged.category,
    merged.status,
    merged.pinned,
    merged.payment_method,
    merged.start_date,
    merged.next_billing_date,
    merged.auto_calculate_next_billing_date,
    merged.trial_end_date,
    merged.website,
    merged.notes,
    merged.tags_json,
    merged.reminder_days,
    merged.repeat_reminder_enabled,
    merged.repeat_reminder_interval,
    merged.repeat_reminder_window,
    merged.extra_json,
    timestamp,
    auth.user.id,
    id,
  ).run();
  return json({ subscription: toApiSubscription(merged) });
}

export async function deleteSubscription(request: Request, env: Env, id: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const result = await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ? AND id = ?").bind(auth.user.id, id).run();
  if ((result.meta.changes ?? 0) === 0) throw new HttpError(404, serverText(locale, "subscription.notFound"));
  return ok();
}

export type SubscriptionBody = ReturnType<typeof subscriptionCreateBodySchema.parse>;

export function normalizeSubscriptionBodyForStorage(body: unknown): SubscriptionBody {
  const parsed = subscriptionStorageBodySchema.parse(body);
  // Worker 没有 PocketBase hook；这里承接 Go 持久层同款规范化，供 create/update/import 三条写入路径共用。
  if (parsed.billingCycle === "custom") {
    return {
      ...parsed,
      customDays: parsed.customDays ?? 1,
      customCycleUnit: parsed.customCycleUnit ?? "day",
    };
  }
  return {
    ...parsed,
    customDays: null,
    customCycleUnit: null,
    autoCalculateNextBillingDate: parsed.billingCycle === "one-time" ? false : parsed.autoCalculateNextBillingDate,
  };
}

function parseSubscriptionBodyForStorage(body: unknown, locale: ReturnType<typeof requestLocale>): SubscriptionBody {
  try {
    return normalizeSubscriptionBodyForStorage(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, serverText(locale, "common.invalidPayload"), "INVALID_PAYLOAD", error.flatten());
    }
    throw error;
  }
}

/** 把 D1 row 还原成 shared 写入 body，用于 PATCH 合并而不是直接拼 SQL 字段。 */
function toBody(row: SubscriptionRow): SubscriptionBody {
  return {
    name: row.name,
    logo: row.logo,
    price: row.price,
    currency: row.currency,
    billingCycle: row.billing_cycle as SubscriptionBody["billingCycle"],
    customDays: row.custom_days,
    customCycleUnit: row.custom_cycle_unit,
    category: row.category,
    status: row.status as SubscriptionBody["status"],
    pinned: row.pinned === 1,
    paymentMethod: row.payment_method,
    startDate: row.start_date,
    nextBillingDate: row.next_billing_date,
    autoCalculateNextBillingDate: row.auto_calculate_next_billing_date === 1,
    trialEndDate: row.trial_end_date,
    website: row.website,
    notes: row.notes,
    tags: JSON.parse(row.tags_json) as string[],
    reminderDays: row.reminder_days,
    repeatReminderEnabled: row.repeat_reminder_enabled === 1,
    repeatReminderInterval: row.repeat_reminder_interval as SubscriptionBody["repeatReminderInterval"],
    repeatReminderWindow: row.repeat_reminder_window as SubscriptionBody["repeatReminderWindow"],
    extra: parseJsonObject(row.extra_json),
  };
}

/** 将 shared 订阅 body 映射到 D1 行；所有 snake_case、null 和整数布尔都集中在这里。 */
export function toSubscriptionRow(
  id: string,
  userId: string,
  body: SubscriptionBody,
  createdAt: string,
  updatedAt: string,
): SubscriptionRow {
  return {
    id,
    user_id: userId,
    name: body.name,
    logo: body.logo ?? null,
    price: body.price,
    currency: body.currency,
    billing_cycle: body.billingCycle,
    // 非 custom 周期必须把自定义字段清空，否则后续编辑会把旧自定义周期“复活”。
    custom_days: body.billingCycle === "custom" ? body.customDays ?? 1 : null,
    custom_cycle_unit: body.billingCycle === "custom" ? body.customCycleUnit ?? "day" : null,
    category: body.category,
    status: body.status,
    pinned: boolToInt(body.pinned),
    payment_method: body.paymentMethod ?? null,
    start_date: body.startDate,
    next_billing_date: body.nextBillingDate,
    // Worker 没有 PocketBase hook；one-time 的跨运行面约束必须在 D1 写入边界兜底。
    auto_calculate_next_billing_date: boolToInt(body.billingCycle === "one-time" ? false : body.autoCalculateNextBillingDate),
    trial_end_date: body.trialEndDate ?? null,
    website: body.website ?? null,
    notes: body.notes ?? null,
    tags_json: JSON.stringify(body.tags ?? []),
    reminder_days: body.reminderDays,
    repeat_reminder_enabled: boolToInt(body.repeatReminderEnabled),
    repeat_reminder_interval: body.repeatReminderInterval,
    repeat_reminder_window: body.repeatReminderWindow,
    // extra 不走 UI 展示；它给 seed/import 留稳定幂等键，编辑订阅时必须随原记录保留。
    extra_json: JSON.stringify(body.extra ?? {}),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function subscriptionRowValues(row: SubscriptionRow): unknown[] {
  return [
    row.id, row.user_id, row.name, row.logo, row.price, row.currency, row.billing_cycle, row.custom_days, row.custom_cycle_unit,
    row.category, row.status, row.pinned, row.payment_method, row.start_date, row.next_billing_date,
    row.auto_calculate_next_billing_date, row.trial_end_date, row.website, row.notes, row.tags_json,
    row.reminder_days, row.repeat_reminder_enabled, row.repeat_reminder_interval, row.repeat_reminder_window,
    row.extra_json, row.created_at, row.updated_at,
  ];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
