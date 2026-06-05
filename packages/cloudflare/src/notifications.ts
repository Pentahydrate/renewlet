import { z } from "zod";
import {
  buildNotificationEmail,
  type NotificationEmailItem,
  type NotificationEmailMessage,
} from "@renewlet/shared/email-template";
import {
  notificationHistoryResponseSchema,
  notificationsRunBodySchema,
  notificationsTestBodySchema,
  type NotificationHistoryStatusFilter,
} from "@renewlet/shared/schemas/notifications";
import { effectiveReminderDays, isDisabledReminderDays } from "@renewlet/shared/runtime";
import { appSettingsSchema, settingsUpdateBodySchema, type ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { ApiSubscription } from "@renewlet/shared/schemas/subscriptions";
import { cleanBuiltInIconSourceSettingsPatch, mergeBuiltInIconSourceSettings } from "@renewlet/shared/built-in-icons";
import { getSettings, listSubscriptions, newId, nowIso, NOTIFICATION_JOB_COLUMNS, parseJobResult, toApiSubscription } from "./db";
import { HttpError, json, ok, readOptionalJson, readJson, requestLocale, type AppLocale } from "./http";
import { DEFAULT_SERVER_I18N_LOCALE, serverFormat, serverText } from "./server-i18n";
import { requireAuth } from "./auth";
import { notificationSmtpConfig, sendSmtpEmail } from "./smtp";
import { assertSafeOutboundUrl } from "./outbound-url-policy";
import { sendServerChan } from "./notification-serverchan";
import type { Env, NotificationJobRow } from "./types";

const CRON_USER_PAGE_SIZE = 50;
const CRON_USER_CONCURRENCY = 5;

type Channel = ApiAppSettings["enabledChannels"][number];

type NotificationMessage = NotificationEmailMessage;
type ScheduleOccurrence = ReturnType<typeof scheduleOccurrence>;

/** 发送单渠道测试通知；settings 来自表单快照，只临时合并校验，不写入 D1。 */
export async function notificationTest(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, notificationsTestBodySchema, locale);
  const settings = await effectiveSettings(env, auth.user.id, body.settings);
  const message = buildTestMessage(new Date(), settings);
  await sendChannel(env, body.channel, settings, message, locale, requestAppUrl(request));
  return ok();
}

/** 手动运行当前用户通知任务；force 只影响本次 due 判断，仍复用真实发送与审计链路。 */
export async function notificationRun(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readOptionalJson(request, notificationsRunBodySchema, locale);
  const result = await runForUser(env, auth.user.id, body.force === true, body.settings, "manual", locale, { appUrl: requestAppUrl(request) });
  if (!result.sent) return json({ ok: true, sent: false, reason: "no_due_items" });
  return json({ ok: true, sent: true, summary: result.summary });
}

/** 返回当前用户通知概览和历史审计；分页与状态过滤都在 user_id 约束内完成。 */
export async function notificationHistory(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const status = parseHistoryStatus(url.searchParams.get("status"));
  const limit = clamp(parseIntOr(url.searchParams.get("limit"), 20), 1, 50);
  const offset = Math.max(0, parseIntOr(url.searchParams.get("offset"), 0));
  const settings = await getSettings(env, auth.user.id);
  const subscriptions = (await listSubscriptions(env, auth.user.id)).map(toApiSubscription);
  const overview = buildOverview(new Date(), settings, subscriptions);
  const params: unknown[] = [auth.user.id];
  let filter = "WHERE user_id = ?";
  if (status !== "all") {
    filter += " AND status = ?";
    params.push(status);
  }
  params.push(limit + 1, offset);
  const rows = await env.DB.prepare(`SELECT ${NOTIFICATION_JOB_COLUMNS} FROM notification_jobs ${filter} ORDER BY scheduled_instant_utc DESC, created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params)
    .all<NotificationJobRow>();
  const hasMore = rows.results.length > limit;
  const jobs = rows.results.slice(0, limit).map(toHistoryJob);
  const latestJob = await latestJobForUser(env, auth.user.id);
  const latestFailedJob = await latestJobForUser(env, auth.user.id, "failed");
  return json(notificationHistoryResponseSchema.parse({
    summary: {
      ...overview.summary,
      latestJob: latestJob ? toHistoryJob(latestJob) : null,
      latestFailedJob: latestFailedJob ? toHistoryJob(latestFailedJob) : null,
    },
    upcoming: overview.upcoming,
    history: { jobs, status, limit, offset, hasMore },
  }));
}

/** Cloudflare Cron 入口按用户分页并发执行，避免一次 Worker tick 放大 D1 与外部通知 provider 压力。 */
export async function runScheduledNotifications(env: Env): Promise<void> {
  for (let offset = 0; ; offset += CRON_USER_PAGE_SIZE) {
    const users = await env.DB.prepare("SELECT id FROM users WHERE banned = 0 ORDER BY id LIMIT ? OFFSET ?")
      .bind(CRON_USER_PAGE_SIZE, offset)
      .all<{ id: string }>();
    // Cron 运行在 Worker 平台限额内；分页加固定并发避免一次 tick 把 D1/通知 provider 打满。
    await runBounded(users.results, CRON_USER_CONCURRENCY, (user) => runScheduledForUser(env, user.id).catch(() => undefined));
    if (users.results.length < CRON_USER_PAGE_SIZE) break;
  }
}

/** 简单有界并发执行器；Worker 单次 Cron 不能为每个用户同时打开外部通知请求。 */
async function runBounded<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      await task(item);
    }
  });
  await Promise.all(workers);
}

async function runScheduledForUser(env: Env, userId: string): Promise<void> {
  const settings = await getSettings(env, userId);
  const now = new Date();
  const localDate = dateOnlyInZone(now, settings.timezone);
  const localTime = localTimeInZone(now, settings.timezone);
  if (localTime !== settings.notificationTimeLocal) return;
  const occurrence = scheduleOccurrence(localDate, settings.notificationTimeLocal, settings.timezone);
  const timestamp = nowIso();
  // Cron 每分钟触发且可能重试；唯一键把“某用户某本地日期时间”压成一次发送窗口。
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO notification_jobs (
      id, user_id, scheduled_local_date, scheduled_local_time, time_zone, scheduled_instant_utc,
      status, attempts, last_error, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, '{}', ?, ?)
  `).bind(newId("job"), userId, occurrence.scheduledLocalDate, occurrence.scheduledLocalTime, occurrence.timeZone, occurrence.scheduledInstantUtc, timestamp, timestamp).run();
  if ((insert.meta.changes ?? 0) === 0) return;
  // Cron 没有 request origin；邮件 CTA 只在手动请求能确定公开域名时生成。
  await runForUser(env, userId, false, undefined, "cron", DEFAULT_SERVER_I18N_LOCALE, { occurrence });
}

async function runForUser(
  env: Env,
  userId: string,
  force: boolean,
  settingsPatch: SettingsPatch | undefined,
  source: "cron" | "manual",
  locale: AppLocale,
  options: { occurrence?: ScheduleOccurrence; appUrl?: string } = {},
): Promise<{ sent: boolean; summary: SendSummary }> {
  const settings = await effectiveSettings(env, userId, settingsPatch);
  const subscriptions = (await listSubscriptions(env, userId)).map(toApiSubscription);
  const now = new Date();
  const schedule = options.occurrence ?? scheduleOccurrence(dateOnlyInZone(now, settings.timezone), settings.notificationTimeLocal, settings.timezone);
  const message = buildDueMessage(now, settings, subscriptions, true);
  if (!message.hasPayload && !force) {
    // cron 空跑也要写 skipped，历史页才能解释“调度正常但没有到期内容”。
    if (source === "cron") await finalizeJob(env, userId, schedule, "skipped", 0, null, {});
    return { sent: false, summary: { attempted: [], succeeded: [], failed: [] } };
  }
  if (settings.enabledChannels.length === 0) {
    throw new HttpError(400, serverText(locale, "notification.noEnabledChannels"));
  }
  const summary = await sendChannels(env, settings.enabledChannels, settings, message, locale, options.appUrl);
  const status = summary.failed.length > 0 && summary.succeeded.length === 0 ? "failed" : "sent";
  await finalizeJob(env, userId, schedule, status, summary.attempted.length, summary.failed[0]?.error ?? null, {
    // 历史详情保存的是产品可解释结果，不保存 provider token 或完整外部响应。
    source: "cron",
    reason: null,
    force,
    windowMinutes: 1,
    triggeredAtUtc: now.toISOString(),
    schedule,
    settings: {
      timezone: settings.timezone,
      locale: settings.locale,
      notificationTimeLocal: settings.notificationTimeLocal,
      enabledChannels: settings.enabledChannels,
      showExpired: settings.showExpired,
    },
    message,
    channels: summary,
  });
  return { sent: true, summary };
}

type SettingsPatch = z.infer<typeof settingsUpdateBodySchema>;

/** 合并临时设置 patch 只服务“测试发送/手动运行”，不会写回 D1 用户设置。 */
async function effectiveSettings(env: Env, userId: string, patch?: SettingsPatch): Promise<ApiAppSettings> {
  const current = await getSettings(env, userId);
  const stripped = stripUndefined(patch ?? {});
  return appSettingsSchema.parse({
    ...current,
    ...stripped,
    builtInIconSources: mergeBuiltInIconSourceSettings(current.builtInIconSources, cleanBuiltInIconSourceSettingsPatch(stripped.builtInIconSources)),
  });
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

interface SendSummary {
  attempted: Channel[];
  succeeded: Channel[];
  failed: Array<{ channel: Channel; error: string }>;
}

async function sendChannels(env: Env, channels: Channel[], settings: ApiAppSettings, message: NotificationMessage, locale: AppLocale, appUrl?: string): Promise<SendSummary> {
  const summary: SendSummary = { attempted: channels, succeeded: [], failed: [] };
  for (const channel of channels) {
    try {
      // 多渠道是“尽力发送”：一个渠道失败要进入 summary，不能吞掉其它渠道的成功。
      await sendChannel(env, channel, settings, message, locale, appUrl);
      summary.succeeded.push(channel);
    } catch (error) {
      summary.failed.push({ channel, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}

async function sendChannel(env: Env, channel: Channel, settings: ApiAppSettings, message: NotificationMessage, locale: AppLocale, appUrl?: string): Promise<void> {
  switch (channel) {
    case "telegram":
      await postJson(`https://api.telegram.org/bot${required(settings.telegramBotToken, serverText(locale, "service.telegramBotToken"), locale)}/sendMessage`, {
        chat_id: required(settings.telegramChatId, serverText(locale, "service.telegramChatID"), locale),
        text: textMessage(message),
        disable_web_page_preview: true,
      }, "Telegram", locale);
      return;
    case "notifyx":
      await postJson(`https://www.notifyx.cn/api/v1/send/${encodeURIComponent(required(settings.notifyxApiKey, serverText(locale, "service.notifyxAPIKey"), locale))}`, {
        title: message.title,
        content: message.content,
        description: message.timestamp,
      }, "NotifyX", locale);
      return;
    case "webhook":
      await sendWebhook(settings, message, locale);
      return;
    case "wechat":
      await postJson(await safeHttpsUrl(required(settings.wechatWebhookUrl, serverText(locale, "service.wechatWebhookURL"), locale), locale), {
        msgtype: settings.wechatMessageType,
        [settings.wechatMessageType]: settings.wechatMessageType === "markdown" ? { content: textMessage(message) } : { content: textMessage(message), mentioned_mobile_list: settings.wechatAtAll ? ["@all"] : splitList(settings.wechatAtPhones) },
      }, "WeCom", locale);
      return;
    case "bark":
      await fetchOk(await barkUrl(settings, message, locale), { method: "GET" }, "Bark", locale);
      return;
    case "email":
      await sendEmail(env, settings, message, locale, appUrl);
      return;
    case "serverchan":
      await sendServerChan(settings, message, locale);
      return;
  }
}

async function sendWebhook(settings: ApiAppSettings, message: NotificationMessage, locale: AppLocale): Promise<void> {
  const endpoint = await safeHttpsUrl(required(settings.webhookUrl, serverText(locale, "service.webhookURL"), locale), locale);
  const headers = parseHeaders(settings.webhookHeaders);
  if (settings.webhookMethod === "GET") {
    // GET webhook 只能把模板字段放 query，避免对方服务忽略 body 导致测试“成功但无内容”。
    const url = new URL(endpoint);
    url.searchParams.set("title", message.title);
    url.searchParams.set("content", message.content);
    url.searchParams.set("timestamp", message.timestamp);
    await fetchOk(url, { method: "GET", headers }, "Webhook", locale);
    return;
  }
  headers.set("content-type", headers.get("content-type") ?? "application/json");
  const body = settings.webhookPayload.trim()
    ? applyTemplate(settings.webhookPayload, message)
    : JSON.stringify({ title: message.title, content: message.content, timestamp: message.timestamp });
  await fetchOk(endpoint, { method: "POST", headers, body }, "Webhook", locale);
}

async function sendEmail(env: Env, settings: ApiAppSettings, message: NotificationMessage, locale: AppLocale, appUrl?: string): Promise<void> {
  let to = splitList(settings.recipientEmail);
  if (!settings.notifyMultipleAddresses && to.length > 1) to = to.slice(0, 1);
  if (to.length === 0) throw new Error(serverText(locale, "smtp.recipientEmpty"));
  const email = buildNotificationEmail(settings, message, appUrl ? { appUrl } : {});
  await sendSmtpEmail(notificationSmtpConfig(settings, locale), { to, subject: email.subject, text: email.text, html: email.html }, locale);
}

function buildOverview(now: Date, settings: ApiAppSettings, subscriptions: ApiSubscription[]) {
  const localDate = dateOnlyInZone(now, settings.timezone);
  const nextCheck = scheduleOccurrence(localDate, settings.notificationTimeLocal, settings.timezone);
  // 预览只看未来 30 天，保证设置页打开时不会按订阅总量无限扩展调度计算。
  const upcoming = Array.from({ length: 30 }, (_, offset) => addDays(localDate, offset))
    .map((date) => ({ ...scheduleOccurrence(date, settings.notificationTimeLocal, settings.timezone), items: collectItems(date, settings, subscriptions, { includeExpired: false }) }))
    .filter((batch) => batch.items.length > 0);
  return {
    summary: {
      nextCheck,
      nextContentBatch: upcoming[0] ?? null,
      blockers: notificationBlockers(settings),
      enabledChannels: settings.enabledChannels,
      upcomingDays: 30,
    },
    upcoming,
  };
}

function buildTestMessage(now: Date, settings: ApiAppSettings): NotificationMessage {
  const locale = settings.locale;
  return { title: serverText(locale, "notification.content.testTitle"), content: serverText(locale, "notification.content.testBody"), timestamp: displayTime(now, settings), hasPayload: true, items: [] };
}

function buildDueMessage(now: Date, settings: ApiAppSettings, subscriptions: ApiSubscription[], includeExpired: boolean): NotificationMessage {
  const items = collectItems(dateOnlyInZone(now, settings.timezone), settings, subscriptions, { includeExpired });
  const locale = settings.locale;
  const content = items.length === 0
    ? serverText(locale, "notification.content.empty")
    : groupedNotificationContent(items, locale);
  return { title: serverText(locale, "notification.content.title"), content, timestamp: displayTime(now, settings), hasPayload: items.length > 0, items };
}

function groupedNotificationContent(items: NotificationEmailItem[], locale: AppLocale): string {
  const groups = [
    ["renewal", "notification.content.renewalBlock"],
    ["expiry", "notification.content.expiryBlock"],
    ["trial", "notification.content.trialBlock"],
    ["expired", "notification.content.expiredBlock"],
  ] as const;
  return groups
    .map(([type, titleKey]) => {
      const lines = items
        .filter((item) => item.type === type)
        .map((item) => notificationItemLine(item, locale));
      return lines.length > 0 ? `${serverText(locale, titleKey)}\n${lines.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function notificationItemLine(item: NotificationEmailItem, locale: AppLocale): string {
  let extra = serverFormat(locale, "notification.content.reminderDays", { days: item.reminderDays });
  if (item.type === "trial") {
    extra = serverFormat(locale, "notification.content.trialReminderDays", { days: item.reminderDays });
  } else if (item.type === "expiry") {
    extra = serverFormat(locale, "notification.content.expiryReminderDays", { days: item.reminderDays });
  } else if (item.type === "expired") {
    extra = serverText(locale, "notification.content.expiredStatus");
  }
  if (item.repeatReminder) {
    extra += serverText(locale, "notification.content.repeatSeparator") + serverFormat(locale, "notification.content.repeatEvery", { hours: repeatReminderHours(item.repeatReminder.interval) });
  }
  return serverFormat(locale, "notification.content.itemLine", {
    name: item.name,
    targetDate: item.targetDate,
    amount: formatAmount(item.price),
    currency: item.currency,
    extra,
  });
}

function repeatReminderHours(interval: string): number {
  const match = /^(\d+)h$/.exec(interval);
  return match?.[1] ? Number.parseInt(match[1], 10) : 1;
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return String(amount);
  const fixed = amount.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function collectNotificationItemsForLocalDate(
  localDate: string,
  settings: ApiAppSettings,
  subscriptions: ApiSubscription[],
  options: { includeExpired?: boolean } = {},
): NotificationEmailItem[] {
  return collectItems(localDate, settings, subscriptions, { includeExpired: options.includeExpired ?? true });
}

function collectItems(localDate: string, settings: ApiAppSettings, subscriptions: ApiSubscription[], options: { includeExpired: boolean }): NotificationEmailItem[] {
  const items: NotificationEmailItem[] = [];
  for (const sub of subscriptions) {
    if (isDisabledReminderDays(sub.reminderDays)) {
      // -2 是单订阅静默哨兵；Worker Cron 和手动运行都在入口跳过，历史 payload 也不保留该订阅。
      continue;
    }
    const reminderDays = effectiveReminderDays(sub.reminderDays, settings.notificationReminderDays);
    if (reminderDays === undefined) continue;
    const daysUntilNext = daysBetween(localDate, sub.nextBillingDate);
    if (sub.billingCycle === "one-time" && !sub.oneTimeTermCount) {
      // one-time 买断记录没有权益到期日；Worker 不能把购买日当成续费或过期边界。
      continue;
    }
    if (sub.billingCycle === "one-time") {
      if (daysUntilNext === reminderDays) items.push(item("expiry", sub, sub.nextBillingDate, daysUntilNext, reminderDays));
      if (daysUntilNext < 0 && settings.showExpired && options.includeExpired) items.push(item("expired", sub, sub.nextBillingDate, daysUntilNext, reminderDays));
    } else {
      if (daysUntilNext < 0 && settings.showExpired && options.includeExpired) items.push(item("expired", sub, sub.nextBillingDate, daysUntilNext, reminderDays));
      if (daysUntilNext === reminderDays) items.push(item("renewal", sub, sub.nextBillingDate, daysUntilNext, reminderDays));
    }
    if (sub.status === "trial" && sub.trialEndDate) {
      const daysUntilTrial = daysBetween(localDate, sub.trialEndDate);
      if (daysUntilTrial === reminderDays) items.push(item("trial", sub, sub.trialEndDate, daysUntilTrial, reminderDays));
    }
  }
  return items;
}

function item(type: "renewal" | "trial" | "expired" | "expiry", sub: ApiSubscription, targetDate: string, daysUntil: number, reminderDays: number): NotificationEmailItem {
  return {
    type,
    subscriptionId: sub.id,
    name: sub.name,
    price: sub.price,
    currency: sub.currency,
    status: sub.status,
    targetDate,
    // -1 只在订阅存储层表示“继承设置”；通知历史和渠道 payload 保存解析后的可解释天数。
    reminderDays,
    daysUntil,
    ...(sub.repeatReminderEnabled ? { repeatReminder: { interval: sub.repeatReminderInterval, window: sub.repeatReminderWindow } } : {}),
  };
}

async function finalizeJob(env: Env, userId: string, schedule: ReturnType<typeof scheduleOccurrence>, status: string, attempts: number, error: string | null, result: unknown): Promise<void> {
  const timestamp = nowIso();
  // finalize 只按调度窗口更新，不按 job id；这样 cron 插入后的发送阶段可复用同一幂等键。
  await env.DB.prepare(`
    UPDATE notification_jobs SET status = ?, attempts = ?, last_error = ?, result_json = ?, updated_at = ?
    WHERE user_id = ? AND scheduled_local_date = ? AND scheduled_local_time = ? AND time_zone = ?
  `).bind(status, attempts, error, JSON.stringify(result), timestamp, userId, schedule.scheduledLocalDate, schedule.scheduledLocalTime, schedule.timeZone).run();
}

function toHistoryJob(row: NotificationJobRow) {
  return {
    id: row.id,
    scheduledLocalDate: row.scheduled_local_date,
    scheduledLocalTime: row.scheduled_local_time,
    timeZone: row.time_zone,
    scheduledInstantUtc: row.scheduled_instant_utc,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    result: parseJobResult(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function latestJobForUser(env: Env, userId: string, status?: string): Promise<NotificationJobRow | null> {
  const filter = status ? "WHERE user_id = ? AND status = ?" : "WHERE user_id = ?";
  const params = status ? [userId, status] : [userId];
  return await env.DB.prepare(`SELECT ${NOTIFICATION_JOB_COLUMNS} FROM notification_jobs ${filter} ORDER BY scheduled_instant_utc DESC, created_at DESC LIMIT 1`).bind(...params).first<NotificationJobRow>();
}

function parseHistoryStatus(value: string | null): NotificationHistoryStatusFilter {
  return z.enum(["all", "sent", "failed", "skipped", "sending"]).catch("all").parse(value ?? "all");
}

function notificationBlockers(settings: ApiAppSettings): string[] {
  const blockers: string[] = [];
  if (settings.enabledChannels.length === 0) blockers.push("no_enabled_channels");
  if (settings.enabledChannels.includes("email") && !settings.recipientEmail.trim()) blockers.push("email_recipient_missing");
  return blockers;
}

async function postJson(url: string | URL, payload: unknown, channel: string, locale: AppLocale, headers?: Record<string, string>): Promise<void> {
  await fetchOk(url, { method: "POST", headers: { "content-type": "application/json", ...(headers ?? {}) }, body: JSON.stringify(payload) }, channel, locale);
}

async function fetchOk(url: string | URL, init: RequestInit, channel: string, locale: AppLocale): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await externalHttpError(channel, response, locale));
  if (response.body) await response.body.cancel().catch(() => undefined);
}

async function externalHttpError(channel: string, response: Response, locale: AppLocale): Promise<string> {
  // 外部服务错误页可能很大；历史 lastError 只保留可诊断摘要，避免被 provider HTML 撑爆。
  const raw = await response.text().catch(() => response.statusText);
  const detail = raw.trim().slice(0, 800);
  return serverFormat(locale, "notification.httpSendFailed", {
    channel,
    status: response.status,
    detail: detail || response.statusText,
  });
}

async function safeHttpsUrl(raw: string, locale: AppLocale): Promise<string> {
  // Worker 没有 Go 的 DialContext 钩子；发送前先解析并拒绝内网/本机地址，避免用户配置的通知 URL 变成 SSRF 跳板。
  const url = await assertSafeOutboundUrl(raw, locale);
  return url.toString();
}

async function barkUrl(settings: ApiAppSettings, message: NotificationMessage, locale: AppLocale): Promise<string> {
  const server = (await safeHttpsUrl(settings.barkServerUrl || "https://api.day.app", locale)).replace(/\/+$/, "");
  const key = required(settings.barkDeviceKey, serverText(locale, "service.barkDeviceKey"), locale);
  const url = new URL(`${server}/${encodeURIComponent(key)}/${encodeURIComponent(message.title)}/${encodeURIComponent(message.content)}`);
  if (settings.barkSilentPush) url.searchParams.set("isArchive", "1");
  return url.toString();
}

function parseHeaders(value: string): Headers {
  const headers = new Headers();
  if (!value.trim()) return headers;
  // headers 是高级配置，保持 JSON 对象语义；解析失败应让测试发送显式失败。
  const parsed = JSON.parse(value) as Record<string, string>;
  for (const [key, item] of Object.entries(parsed)) headers.set(key, item);
  return headers;
}

function required(value: string, label: string, locale: AppLocale): string {
  if (value.trim()) return value.trim();
  throw new Error(serverFormat(locale, "common.requiredField", { label }));
}

function textMessage(message: NotificationMessage): string {
  return `${message.title}\n\n${message.content}\n\n${message.timestamp}`;
}

function applyTemplate(template: string, message: NotificationMessage): string {
  return template.replaceAll("{title}", message.title).replaceAll("{content}", message.content).replaceAll("{timestamp}", message.timestamp);
}

function requestAppUrl(request: Request): string {
  return new URL(request.url).origin;
}

function splitList(input: string): string[] {
  return input.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
}

function scheduleOccurrence(date: string, time: string, timezone: string) {
  return { scheduledLocalDate: date, scheduledLocalTime: time, timeZone: timezone, scheduledInstantUtc: zonedWallTimeToUtc(date, time, timezone) };
}

function dateOnlyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function localTimeInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23" }).formatToParts(date);
  return `${part(parts, "hour")}:${part(parts, "minute")}`;
}

function displayTime(date: Date, settings: ApiAppSettings): string {
  return `${dateOnlyInZone(date, settings.timezone)} ${localTimeInZone(date, settings.timezone)} ${settings.timezone}`;
}

function zonedWallTimeToUtc(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  // Intl 只能从 UTC 推本地时间；两轮校正把“本地墙钟时间”反推成 UTC instant。
  for (let i = 0; i < 2; i++) {
    const shownDate = dateOnlyInZone(new Date(utc), timezone);
    const shownTime = localTimeInZone(new Date(utc), timezone);
    const [sy, sm, sd] = shownDate.split("-").map(Number) as [number, number, number];
    const [sh, smin] = shownTime.split(":").map(Number) as [number, number];
    utc += Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(sy, sm - 1, sd, sh, smin);
  }
  return new Date(utc).toISOString();
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const value = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return value.toISOString().slice(0, 10);
}

function parseIntOr(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
