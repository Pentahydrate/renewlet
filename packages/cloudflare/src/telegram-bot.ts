import { telegramBotCommandsResponseSchema } from "@renewlet/shared/schemas/telegram-bot";
import type { PublicApiDueItem } from "@renewlet/shared/schemas/public-api";
import { requireAuth } from "./auth";
import { getSettings, getTelegramBotBinding, newId, nowIso, TELEGRAM_BOT_BINDING_COLUMNS } from "./db";
import { randomToken, sha256 } from "./crypto";
import { HttpError, json, ok, requireEmptyBody, requestLocale } from "./http";
import { requestOrigin } from "./request-origin";
import { serverText, type AppLocale } from "./server-i18n";
import {
  createUpstreamHTTPError,
  createUpstreamNetworkError,
  upstreamErrorDetailsFromError,
  upstreamProviderResponseFromFetchResponse,
} from "./upstream-response";
import {
  readPublicApiDueForUser,
  readPublicApiNextDueForUser,
  readPublicApiStatusForUser,
  readPublicApiSubscriptionsForUser,
} from "./public-api";
import { dateOnlyInZone } from "./subscription-renewal";
import { telegramBotMessage } from "./telegram-format";
import type { ApiAppSettings, Env, TelegramBotBindingRow } from "./types";

const TELEGRAM_COMMANDS_VERSION = "v2";
const TELEGRAM_WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const TELEGRAM_UPDATE_BODY_LIMIT = 1 << 20;
const TELEGRAM_DUE_DEFAULT_DAYS = 30;
const TELEGRAM_DUE_MAX_DAYS = 366;
const TELEGRAM_COMMAND_LIST_LIMIT = 10;

type TelegramBotCommand = {
  command: string;
  description: string;
};

type TelegramUpdate = {
  updateId: number | null;
  chatId: string | null;
  text: string;
};

export async function readTelegramBotCommands(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const settings = await getSettings(env, auth.user.id);
  const binding = await getTelegramBotBinding(env, auth.user.id);
  const bindingMatches = binding ? await bindingMatchesSettings(binding, settings) : false;
  return noStoreJson(telegramBotCommandsDto(settings, binding, bindingMatches));
}

export async function installTelegramBotCommands(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await requireEmptyBody(request, locale);
  const origin = requestOrigin(request);
  if (new URL(origin).protocol !== "https:") {
    throw new HttpError(400, serverText(locale, "common.invalidRequestParameters"), "TELEGRAM_BOT_HTTPS_REQUIRED");
  }
  const settings = await getSettings(env, auth.user.id);
  const config = telegramSavedConfig(settings);
  if (!config) throw new HttpError(400, serverText(locale, "common.invalidRequestParameters"), "TELEGRAM_BOT_CONFIG_INCOMPLETE");
  const existing = await getTelegramBotBinding(env, auth.user.id);
  if (existing?.status === "installed" && !await bindingMatchesSettings(existing, settings)) {
    throw new HttpError(400, serverText(locale, "common.invalidRequestParameters"), "TELEGRAM_BOT_INSTALLED_SETTINGS_LOCKED");
  }

  const timestamp = nowIso();
  const bindingId = existing?.id ?? newId("tgb");
  const secret = randomToken(32);
  const row: TelegramBotBindingRow = {
    id: bindingId,
    user_id: auth.user.id,
    chat_id: config.chatId,
    bot_token_hash: await sha256(config.botToken),
    webhook_secret_hash: await sha256(secret),
    status: "installing",
    commands_version: TELEGRAM_COMMANDS_VERSION,
    last_update_id: 0,
    last_used_at: null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
  // installing 行先落库，确保 setWebhook 指向的 bindingId 已存在；失败路径会删除本地行并清理远端状态。
  await env.DB.prepare(`
    INSERT INTO telegram_bot_bindings (
      id, user_id, chat_id, bot_token_hash, webhook_secret_hash, status, commands_version,
      last_update_id, last_used_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      id = excluded.id,
      chat_id = excluded.chat_id,
      bot_token_hash = excluded.bot_token_hash,
      webhook_secret_hash = excluded.webhook_secret_hash,
      status = excluded.status,
      commands_version = excluded.commands_version,
      last_update_id = excluded.last_update_id,
      last_used_at = NULL,
      updated_at = excluded.updated_at
  `).bind(
    row.id,
    row.user_id,
    row.chat_id,
    row.bot_token_hash,
    row.webhook_secret_hash,
    row.status,
    row.commands_version,
    row.last_update_id,
    row.created_at,
    row.updated_at,
  ).run();

  try {
    await installTelegramRemote(config.botToken, config.chatId, `${origin}/api/telegram/webhook/${bindingId}`, secret, locale);
    await env.DB.prepare("UPDATE telegram_bot_bindings SET status = 'installed', updated_at = ? WHERE user_id = ? AND id = ?")
      .bind(nowIso(), auth.user.id, bindingId)
      .run();
  } catch (error) {
    await bestEffortTelegramRemoteCleanup(config.botToken, config.chatId, locale);
    await env.DB.prepare("DELETE FROM telegram_bot_bindings WHERE user_id = ? AND id = ?").bind(auth.user.id, bindingId).run();
    throw telegramApiHttpError(error, locale);
  }

  return noStoreJson(telegramBotCommandsDto(settings, await getTelegramBotBinding(env, auth.user.id), true));
}

export async function deleteTelegramBotCommands(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  await requireEmptyBody(request, locale);
  const binding = await getTelegramBotBinding(env, auth.user.id);
  if (!binding) throw new HttpError(404, serverText(locale, "common.notFound"), "NOT_FOUND");
  const settings = await getSettings(env, auth.user.id);
  const config = telegramSavedConfig(settings);
  if (!config) throw new HttpError(400, serverText(locale, "common.invalidRequestParameters"), "TELEGRAM_BOT_CONFIG_INCOMPLETE");
  try {
    await deleteTelegramRemote(config.botToken, config.chatId, locale);
  } catch (error) {
    throw telegramApiHttpError(error, locale);
  }
  await env.DB.prepare("DELETE FROM telegram_bot_bindings WHERE user_id = ? AND id = ?").bind(auth.user.id, binding.id).run();
  return noStoreJson({ ok: true });
}

export async function telegramWebhook(request: Request, env: Env, bindingId: string): Promise<Response> {
  const binding = await env.DB.prepare(`SELECT ${TELEGRAM_BOT_BINDING_COLUMNS} FROM telegram_bot_bindings WHERE id = ? LIMIT 1`)
    .bind(bindingId)
    .first<TelegramBotBindingRow>();
  if (!binding) throw new HttpError(404, serverText(requestLocale(request), "common.notFound"), "NOT_FOUND");
  if (!await webhookSecretMatches(binding, request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER) ?? "")) {
    return noStoreJson({ ok: false }, { status: 401 });
  }
  if (binding.status !== "installed") return telegramWebhookOk();
  const update = await readTelegramUpdate(request);
  if (update.updateId === null) return telegramWebhookOk();
  if (update.updateId <= binding.last_update_id) return telegramWebhookOk();
  if (update.chatId !== binding.chat_id) {
    return telegramWebhookOk();
  }
  const parsed = parseTelegramCommand(update.text);
  if (!parsed) {
    return telegramWebhookOk();
  }
  // settings 读取放在真实命令之后；foreign chat/非命令 no-op 不产生额外 D1 读写，也不刷新 last_update_id。
  const settings = await getSettings(env, binding.user_id);
  if (!await bindingMatchesSettings(binding, settings)) return telegramWebhookOk();
  const reply = await telegramCommandReply(env, binding.user_id, settings, parsed.command, parsed.arg, requestLocale(request));
  const config = telegramSavedConfig(settings);
  if (config && reply) {
    // 命令已经处理完就推进 update；sendMessage 失败也不让 Telegram 重试造成重复查询和重复 D1 写入。
    await telegramSendMessage(config.botToken, binding.chat_id, reply, settings.telegramMessageFormat, requestLocale(request)).catch(() => undefined);
  }
  await markTelegramBindingUpdate(env, binding, update.updateId, true);
  return telegramWebhookOk();
}

function telegramBotCommandsDto(settings: ApiAppSettings, binding: TelegramBotBindingRow | null, bindingMatches: boolean) {
  const config = telegramSavedConfig(settings);
  let status: "not_configured" | "not_installed" | "installing" | "installed" = config ? "not_installed" : "not_configured";
  let installed = false;
  if (binding && bindingMatches) {
    status = binding.status;
    installed = binding.status === "installed";
  }
  if (!config) {
    status = "not_configured";
    installed = false;
  }
  return telegramBotCommandsResponseSchema.parse({
    configComplete: Boolean(config),
    installed,
    status,
    chatId: config?.chatId ?? null,
    commandsVersion: binding && bindingMatches ? binding.commands_version : null,
    installedAt: binding && bindingMatches && binding.status === "installed" ? binding.created_at : null,
    lastUsedAt: binding && bindingMatches ? binding.last_used_at : null,
  });
}

function telegramSavedConfig(settings: ApiAppSettings): { botToken: string; chatId: string } | null {
  const botToken = settings.telegramBotToken.trim();
  const chatId = settings.telegramChatId.trim();
  return botToken && chatId ? { botToken, chatId } : null;
}

async function bindingMatchesSettings(binding: TelegramBotBindingRow, settings: ApiAppSettings): Promise<boolean> {
  const config = telegramSavedConfig(settings);
  if (!config) return false;
  return binding.chat_id === config.chatId && binding.bot_token_hash === await sha256(config.botToken);
}

async function webhookSecretMatches(binding: TelegramBotBindingRow, secret: string): Promise<boolean> {
  const trimmed = secret.trim();
  if (!trimmed) return false;
  return constantTimeEqual(await sha256(trimmed), binding.webhook_secret_hash);
}

async function installTelegramRemote(botToken: string, chatId: string, webhookUrl: string, secret: string, locale: AppLocale): Promise<void> {
  await telegramPostJson(botToken, "setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message"],
    drop_pending_updates: true,
    max_connections: 1,
    secret_token: secret,
  }, locale, [secret, chatId]);
  await telegramPostJson(botToken, "setMyCommands", {
    commands: telegramMenuCommands(),
    scope: { type: "chat", chat_id: chatId },
  }, locale, [chatId]);
}

async function deleteTelegramRemote(botToken: string, chatId: string, locale: AppLocale): Promise<void> {
  await telegramPostJson(botToken, "deleteWebhook", { drop_pending_updates: true }, locale, [chatId]);
  await telegramPostJson(botToken, "deleteMyCommands", { scope: { type: "chat", chat_id: chatId } }, locale, [chatId]);
}

async function bestEffortTelegramRemoteCleanup(botToken: string, chatId: string, locale: AppLocale): Promise<void> {
  await telegramPostJson(botToken, "deleteWebhook", { drop_pending_updates: true }, locale, [chatId]).catch(() => undefined);
  await telegramPostJson(botToken, "deleteMyCommands", { scope: { type: "chat", chat_id: chatId } }, locale, [chatId]).catch(() => undefined);
}

async function telegramSendMessage(botToken: string, chatId: string, text: string, format: ApiAppSettings["telegramMessageFormat"], locale: AppLocale): Promise<void> {
  const message = telegramBotMessage(text, format);
  await telegramPostJson(botToken, "sendMessage", {
    chat_id: chatId,
    ...message,
    link_preview_options: { is_disabled: true },
  }, locale, [chatId]);
}

async function telegramPostJson(botToken: string, method: string, payload: unknown, locale: AppLocale, secrets: readonly string[] = []): Promise<void> {
  let response: Response;
  const secretValues = [botToken, ...secrets];
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw createUpstreamNetworkError({ provider: "Telegram", error, secrets: secretValues });
  }
  if (!response.ok) {
    const providerResponse = await upstreamProviderResponseFromFetchResponse(response, { secrets: secretValues });
    throw createUpstreamHTTPError({ provider: "Telegram", response, providerResponse });
  }
  if (response.body) await response.body.cancel().catch(() => undefined);
  void locale;
}

function telegramApiHttpError(error: unknown, locale: AppLocale): HttpError {
  return new HttpError(502, serverText(locale, "common.internalError"), "TELEGRAM_API_FAILED", upstreamErrorDetailsFromError(error));
}

function telegramMenuCommands(): TelegramBotCommand[] {
  // BotCommand.description 是 Telegram 菜单纯文本契约；富文本只属于后续 sendMessage，/due 仅保留手输高级入口。
  return [
    { command: "start", description: "Show Renewlet command help" },
    { command: "help", description: "Show Renewlet command help" },
    { command: "status", description: "Show subscription status summary" },
    { command: "next", description: "Show the next renewal" },
    { command: "today", description: "Show renewals due today" },
    { command: "week", description: "Show renewals in the next 7 days" },
    { command: "month", description: "Show renewals in the next 30 days" },
    { command: "subscriptions", description: "List subscription summaries" },
    { command: "settings", description: "Show bot and message settings" },
  ];
}

async function telegramCommandReply(env: Env, userId: string, settings: ApiAppSettings, command: string, arg: string, locale: AppLocale): Promise<string> {
  // 命令 adapter 只做路由和文本排版；订阅读取必须继续走 Public API owner-scoped service。
  switch (command) {
    case "start":
    case "help":
      return helpText();
    case "status":
      return statusText(await readPublicApiStatusForUser(env, userId));
    case "next":
      return nextText(await readPublicApiNextDueForUser(env, userId, { settings }));
    case "today": {
      const today = dateOnlyInZone(new Date(), settings.timezone);
      const due = await readPublicApiDueForUser(env, userId, 1, { settings });
      return dueText({ ...due, items: due.items.filter((item) => item.dueDate === today) }, "Today's renewals");
    }
    case "week":
      return dueText(await readPublicApiDueForUser(env, userId, 7, { settings }));
    case "month":
      return dueText(await readPublicApiDueForUser(env, userId, 30, { settings }));
    case "due":
      return dueText(await readPublicApiDueForUser(env, userId, dueDays(arg), { settings }));
    case "subscriptions":
      return subscriptionsText(await readPublicApiSubscriptionsForUser(env, userId, { limit: TELEGRAM_COMMAND_LIST_LIMIT, locale }));
    case "settings":
      return settingsText(settings);
    default:
      return helpText();
  }
}

function helpText(): string {
  return [
    "Renewlet Bot commands:",
    "/status - subscription status summary",
    "/next - next renewal",
    "/today - renewals due today",
    "/week - upcoming renewals in 7 days",
    "/month - upcoming renewals in 30 days",
    "/due [days] - upcoming renewals, default 30 days",
    "/subscriptions - first 10 subscription summaries",
    "/settings - bot and message settings",
    "/help - show this help",
  ].join("\n");
}

function statusText(response: Awaited<ReturnType<typeof readPublicApiStatusForUser>>): string {
  return [
    "Renewlet status",
    `Total: ${response.total}`,
    `trial: ${response.byStatus.trial}`,
    `active: ${response.byStatus.active}`,
    `expired: ${response.byStatus.expired}`,
    `paused: ${response.byStatus.paused}`,
    `cancelled: ${response.byStatus.cancelled}`,
  ].join("\n");
}

function nextText(item: PublicApiDueItem | null): string {
  const lines = ["Next renewal"];
  if (!item) return [...lines, "No upcoming subscriptions."].join("\n");
  return [...lines, `${item.dueDate}: ${subscriptionName(item)} (${item.dueType})`].join("\n");
}

function dueText(response: Awaited<ReturnType<typeof readPublicApiDueForUser>>, title = `Upcoming renewals in ${response.days} days`): string {
  const items = [...response.items].sort((left, right) => left.dueDate.localeCompare(right.dueDate) || subscriptionName(left).localeCompare(subscriptionName(right)));
  const lines = [title];
  if (items.length === 0) return [...lines, "No matching subscriptions."].join("\n");
  const visible = items.slice(0, TELEGRAM_COMMAND_LIST_LIMIT);
  for (const item of visible) lines.push(`- ${item.dueDate}: ${subscriptionName(item)} (${item.dueType})`);
  if (items.length > visible.length) lines.push(`...and ${items.length - visible.length} more. Open Renewlet Web UI for details.`);
  return lines.join("\n");
}

function subscriptionsText(response: Awaited<ReturnType<typeof readPublicApiSubscriptionsForUser>>): string {
  const total = response.total ?? response.subscriptions.length;
  const lines = [`Subscriptions (${total} total)`];
  if (response.subscriptions.length === 0) return [...lines, "No subscriptions yet."].join("\n");
  for (const subscription of response.subscriptions) {
    lines.push(`- ${subscription.name}: ${subscription.status}, next ${subscription.nextBillingDate}`);
  }
  if (total > response.subscriptions.length) {
    lines.push(`...and ${total - response.subscriptions.length} more. Open Renewlet Web UI for details.`);
  }
  return lines.join("\n");
}

function settingsText(settings: ApiAppSettings): string {
  return [
    "Renewlet bot settings",
    `Chat ID: ${settings.telegramChatId.trim() || "Not configured"}`,
    `Message style: ${settings.telegramMessageFormat === "html" ? "Rich text" : "Plain text"}`,
    "Manage this in Renewlet Web UI Settings > Notifications.",
  ].join("\n");
}

function subscriptionName(item: PublicApiDueItem): string {
  return item.subscription.name.trim() || "Unnamed subscription";
}

function dueDays(arg: string): number {
  const trimmed = arg.trim();
  if (!/^\d+$/.test(trimmed)) return TELEGRAM_DUE_DEFAULT_DAYS;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < 1) return TELEGRAM_DUE_DEFAULT_DAYS;
  return Math.min(value, TELEGRAM_DUE_MAX_DAYS);
}

function parseTelegramCommand(text: string): { command: string; arg: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.split(/\s+/);
  const commandPart = parts[0]?.slice(1).split("@")[0]?.trim().toLowerCase() ?? "";
  if (!commandPart) return null;
  return { command: commandPart, arg: parts[1] ?? "" };
}

async function readTelegramUpdate(request: Request): Promise<TelegramUpdate> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > TELEGRAM_UPDATE_BODY_LIMIT) {
    throw new HttpError(413, "Telegram update body too large", "BODY_TOO_LARGE");
  }
  // Telegram Update 会随 Bot API 演进增加字段；这里只宽松读取命令所需三项，未知字段不能导致 webhook 拒绝。
  const parsed = JSON.parse(text) as unknown;
  const update = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  const rawMessage = update["message"];
  const message = typeof rawMessage === "object" && rawMessage !== null ? rawMessage as Record<string, unknown> : {};
  const rawChat = message["chat"];
  const chat = typeof rawChat === "object" && rawChat !== null ? rawChat as Record<string, unknown> : {};
  const rawUpdateId = update["update_id"];
  const updateId = typeof rawUpdateId === "number" && Number.isSafeInteger(rawUpdateId) ? rawUpdateId : null;
  const rawChatId = chat["id"];
  const chatId = typeof rawChatId === "number" && Number.isSafeInteger(rawChatId)
    ? String(rawChatId)
    : typeof rawChatId === "string"
      ? rawChatId.trim()
      : null;
  return {
    updateId,
    chatId,
    text: typeof message["text"] === "string" ? message["text"] : "",
  };
}

async function markTelegramBindingUpdate(env: Env, binding: TelegramBotBindingRow, updateId: number, used: boolean): Promise<void> {
  // 只有真实命令路径会调用这里；no-op update 不写 last_update_id，避免 foreign chat 抢占后续合法 update。
  await env.DB.prepare(`
    UPDATE telegram_bot_bindings
    SET last_update_id = ?, last_used_at = CASE WHEN ? THEN ? ELSE last_used_at END, updated_at = ?
    WHERE id = ?
  `).bind(updateId, used ? 1 : 0, nowIso(), nowIso(), binding.id).run();
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function noStoreJson(value: unknown, init: ResponseInit = {}): Response {
  const response = json(value, init);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function telegramWebhookOk(): Response {
  const response = ok();
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
