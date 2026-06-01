import {
  calendarFeedCreateRequestSchema,
  calendarFeedCreateResponseSchema,
  calendarFeedStatusResponseSchema,
  subscriptionCalendarFeedCreateResponseSchema,
} from "@renewlet/shared/schemas/calendar-feed";
import { buildRenewalCalendarEvent, buildRenewalCalendarIcs, type RenewalCalendarEvent } from "@renewlet/shared/ics";
import { effectiveReminderDays, isValidDateOnly } from "@renewlet/shared/runtime";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { ApiSubscription } from "@renewlet/shared/schemas/subscriptions";
import { getSettings, getSubscription, listSubscriptions, newId, nowIso, toApiSubscription } from "./db";
import { randomToken } from "./crypto";
import { requireAuth } from "./auth";
import { HttpError, json, ok, readJson, requestLocale } from "./http";
import { serverFormat, serverText } from "./server-i18n";
import type { CalendarFeedRow, Env } from "./types";

type CalendarFeedScope = CalendarFeedRow["scope"];

export async function readCalendarFeed(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await ensureCalendarFeedSchema(env, locale);
  const row = await getCalendarFeed(env, auth.user.id, "all", null);
  return json(calendarFeedStatusResponseSchema.parse({ calendarFeed: calendarFeedStatus(row, request) }));
}

export async function createCalendarFeed(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await readJson(request, calendarFeedCreateRequestSchema, locale);
  await ensureCalendarFeedSchema(env, locale);
  const existing = await getCalendarFeed(env, auth.user.id, "all", null);
  const row = existing ?? await insertCalendarFeed(env, {
    scope: "all",
    subscriptionId: null,
    userId: auth.user.id,
  });
  return json(calendarFeedCreateResponseSchema.parse({
    calendarFeed: {
      ...calendarFeedStatus(row, request),
      enabled: true,
    },
  }));
}

export async function deleteCalendarFeed(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await ensureCalendarFeedSchema(env, locale);
  await env.DB.prepare("DELETE FROM calendar_feeds WHERE user_id = ? AND scope = 'all'").bind(auth.user.id).run();
  return ok();
}

export async function readSubscriptionCalendarFeed(request: Request, env: Env, subscriptionId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await ensureCalendarFeedSchema(env, locale);
  const subscription = await getSubscription(env, auth.user.id, subscriptionId);
  if (!subscription) throw new HttpError(404, serverText(locale, "subscription.notFound"), "NOT_FOUND");
  const row = await getCalendarFeed(env, auth.user.id, "subscription", subscriptionId);
  return json(calendarFeedStatusResponseSchema.parse({ calendarFeed: calendarFeedStatus(row, request) }));
}

export async function createSubscriptionCalendarFeed(request: Request, env: Env, subscriptionId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await readJson(request, calendarFeedCreateRequestSchema, locale);
  await ensureCalendarFeedSchema(env, locale);
  const subscription = await getSubscription(env, auth.user.id, subscriptionId);
  if (!subscription) throw new HttpError(404, serverText(locale, "subscription.notFound"), "NOT_FOUND");
  const existing = await getCalendarFeed(env, auth.user.id, "subscription", subscriptionId);
  const row = existing ?? await insertCalendarFeed(env, {
    scope: "subscription",
    subscriptionId,
    userId: auth.user.id,
  });
  return json(subscriptionCalendarFeedCreateResponseSchema.parse({
    calendarFeed: {
      ...calendarFeedStatus(row, request),
      enabled: true,
    },
  }));
}

export async function deleteSubscriptionCalendarFeed(request: Request, env: Env, subscriptionId: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await ensureCalendarFeedSchema(env, locale);
  const subscription = await getSubscription(env, auth.user.id, subscriptionId);
  if (!subscription) throw new HttpError(404, serverText(locale, "subscription.notFound"), "NOT_FOUND");
  await env.DB.prepare("DELETE FROM calendar_feeds WHERE user_id = ? AND scope = 'subscription' AND subscription_id = ?")
    .bind(auth.user.id, subscriptionId)
    .run();
  return ok();
}

export async function calendarFeedIcs(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) throw new HttpError(404, serverText(locale, "calendarFeed.notFound"), "NOT_FOUND");
  let row: CalendarFeedRow | null;
  try {
    row = await env.DB.prepare(`
      SELECT id, user_id, scope, subscription_id, token, created_at, updated_at
      FROM calendar_feeds
      WHERE token = ?
      LIMIT 1
    `).bind(token).first<CalendarFeedRow>();
  } catch (error) {
    if (isUnreadableCalendarFeedTable(error)) {
      // 公开 feed 是 bearer URL，不承担迁移动作；漏迁移、旧表和无效 token 一样不给出表结构线索。
      throw new HttpError(404, serverText(locale, "calendarFeed.notFound"), "NOT_FOUND");
    }
    throw error;
  }
  if (!row) {
    // 公开 feed 是 bearer URL；缺失、撤销和猜测 token 都返回同一个 404，避免泄漏有效性。
    throw new HttpError(404, serverText(locale, "calendarFeed.notFound"), "NOT_FOUND");
  }

  const settings = await getSettings(env, row.user_id);
  const feedUrl = calendarFeedUrl(request, row.token);
  const rendered = await renderCalendarFeed(env, request, row, settings, feedUrl);
  return new Response(rendered.ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${rendered.filename}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function renderCalendarFeed(
  env: Env,
  request: Request,
  row: CalendarFeedRow,
  settings: ApiAppSettings,
  feedUrl: string,
): Promise<{ filename: string; ics: string }> {
  if (row.scope === "subscription") {
    const subscriptionId = row.subscription_id ?? "";
    const subscription = subscriptionId ? await getSubscription(env, row.user_id, subscriptionId) : null;
    if (!subscription) throw new HttpError(404, serverText(requestLocale(request), "calendarFeed.notFound"), "NOT_FOUND");
    const apiSubscription = toApiSubscription(subscription);
    return {
      filename: "renewlet-subscription.ics",
      ics: buildRenewalCalendarIcs({
        name: serverFormat(settings.locale, "calendarFeed.subscriptionCalendarName", { name: apiSubscription.name }),
        sourceUrl: feedUrl,
        generatedAt: new Date(),
        events: subscriptionCalendarEvents(apiSubscription, settings),
      }),
    };
  }

  const subscriptions = (await listSubscriptions(env, row.user_id)).map(toApiSubscription);
  return {
    filename: "renewlet-renewals.ics",
    ics: buildRenewalCalendarIcs({
      name: serverText(settings.locale, "calendarFeed.calendarName"),
      sourceUrl: feedUrl,
      generatedAt: new Date(),
      events: calendarEvents(subscriptions, settings),
    }),
  };
}

async function ensureCalendarFeedSchema(env: Env, locale: ReturnType<typeof requestLocale>): Promise<void> {
  try {
    const columns = await calendarFeedColumns(env);
    if (columns.length === 0) {
      await createCalendarFeedTable(env);
    } else if (!columns.includes("scope") || !columns.includes("token")) {
      await recreateCalendarFeedSchema(env);
    }
    await createCalendarFeedIndexes(env);
  } catch {
    throw new HttpError(500, serverText(locale, "calendarFeed.migrationRequired"), "MIGRATION_REQUIRED");
  }
}

async function calendarFeedColumns(env: Env): Promise<string[]> {
  const result = await env.DB.prepare("PRAGMA table_info(calendar_feeds)").all<{ name: string }>();
  return result.results.map((row) => row.name);
}

async function createCalendarFeedTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS calendar_feeds (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('all', 'subscription')),
      subscription_id TEXT REFERENCES subscriptions(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE CHECK (length(token) = 43),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (scope = 'all' AND subscription_id IS NULL)
        OR (scope = 'subscription' AND subscription_id IS NOT NULL)
      )
    )
  `).run();
}

async function recreateCalendarFeedSchema(env: Env): Promise<void> {
  // hash-only 旧表无法恢复明文订阅 URL；彻底切换时直接丢弃旧 feed，用户可在登录后重新生成。
  await env.DB.prepare("ALTER TABLE calendar_feeds RENAME TO calendar_feeds_legacy").run();
  await createCalendarFeedTable(env);
  await env.DB.prepare("DROP TABLE calendar_feeds_legacy").run();
}

async function createCalendarFeedIndexes(env: Env): Promise<void> {
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feeds_user_all_unique ON calendar_feeds (user_id) WHERE scope = 'all'").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feeds_token ON calendar_feeds (token)").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feeds_user_subscription_unique ON calendar_feeds (user_id, subscription_id) WHERE scope = 'subscription'").run();
}

async function insertCalendarFeed(env: Env, input: {
  scope: CalendarFeedScope;
  subscriptionId: string | null;
  userId: string;
}): Promise<CalendarFeedRow> {
  const token = randomToken();
  const timestamp = nowIso();
  const row: CalendarFeedRow = {
    id: newId("cal"),
    user_id: input.userId,
    scope: input.scope,
    subscription_id: input.subscriptionId,
    token,
    created_at: timestamp,
    updated_at: timestamp,
  };
  // ICS 订阅客户端无法携带 Renewlet 登录态；token 是用户可复制/重置的私有订阅地址，不再做一次性隐藏。
  await env.DB.prepare(`
    INSERT INTO calendar_feeds (id, user_id, scope, subscription_id, token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(row.id, row.user_id, row.scope, row.subscription_id, row.token, row.created_at, row.updated_at).run();
  return row;
}

async function getCalendarFeed(
  env: Env,
  userId: string,
  scope: CalendarFeedScope,
  subscriptionId: string | null,
): Promise<CalendarFeedRow | null> {
  if (scope === "all") {
    return await env.DB.prepare(`
      SELECT id, user_id, scope, subscription_id, token, created_at, updated_at
      FROM calendar_feeds
      WHERE user_id = ? AND scope = 'all'
      LIMIT 1
    `).bind(userId).first<CalendarFeedRow>();
  }
  return await env.DB.prepare(`
    SELECT id, user_id, scope, subscription_id, token, created_at, updated_at
    FROM calendar_feeds
    WHERE user_id = ? AND scope = 'subscription' AND subscription_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId, subscriptionId).first<CalendarFeedRow>();
}

function isUnreadableCalendarFeedTable(error: unknown): boolean {
  return error instanceof Error && /(no such table:\s*calendar_feeds|no such column:\s*(id|scope|subscription_id|token))/i.test(error.message);
}

function calendarFeedStatus(row: CalendarFeedRow | null, request: Request) {
  return row ? {
    enabled: true,
    createdAt: row.created_at,
    feedUrl: calendarFeedUrl(request, row.token),
    updatedAt: row.updated_at,
  } : { enabled: false };
}

function calendarFeedUrl(request: Request, token: string): string {
  const url = new URL(request.url);
  return `${url.origin}/calendar/renewals.ics?token=${encodeURIComponent(token)}`;
}

function calendarEvents(subscriptions: ApiSubscription[], settings: ApiAppSettings): RenewalCalendarEvent[] {
  const today = dateOnlyInZone(new Date(), settings.timezone);
  return subscriptions
    .filter((subscription) => (
      subscription.billingCycle !== "one-time"
      && (subscription.status === "active" || subscription.status === "trial")
      && isValidDateOnly(subscription.nextBillingDate)
      && subscription.nextBillingDate >= today
    ))
    .map((subscription) => calendarEvent(subscription, settings));
}

function subscriptionCalendarEvents(subscription: ApiSubscription, settings: ApiAppSettings): RenewalCalendarEvent[] {
  return isValidDateOnly(subscription.nextBillingDate) ? [calendarEvent(subscription, settings)] : [];
}

function calendarEvent(subscription: ApiSubscription, settings: ApiAppSettings): RenewalCalendarEvent {
  const locale = settings.locale;
  return buildRenewalCalendarEvent({
    subscription,
    labels: {
      amount: formatAmount(subscription.price),
      billingCycle: billingCycleLabel(subscription.billingCycle, locale),
      category: subscription.category,
      paymentMethod: subscription.paymentMethod,
    },
    reminderDays: effectiveReminderDays(subscription.reminderDays, settings.notificationReminderDays),
    text: {
      amount: ({ amount, currency }) => serverFormat(locale, "calendarFeed.description.amount", { amount, currency }),
      billingCycle: (cycle) => serverFormat(locale, "calendarFeed.description.billingCycle", { cycle }),
      category: (category) => serverFormat(locale, "calendarFeed.description.category", { category }),
      paymentMethod: (paymentMethod) => serverFormat(locale, "calendarFeed.description.paymentMethod", { paymentMethod }),
      notes: (notes) => serverFormat(locale, "calendarFeed.description.notes", { notes }),
    },
  });
}

function billingCycleLabel(cycle: ApiSubscription["billingCycle"], locale: ApiAppSettings["locale"]): string {
  const key = `calendarFeed.billingCycle.${cycle}` as const;
  const label = serverText(locale, key);
  return label === key ? cycle : label;
}

function dateOnlyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return String(amount);
  const fixed = amount.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
