import type { NotificationEmailMessage } from "@renewlet/shared/email-template";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { AppLocale } from "./http";
import { DEFAULT_SERVER_I18N_LOCALE, serverFormat, serverText } from "./server-i18n";

type ServerChanResponse = {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
};

export async function sendServerChan(settings: ApiAppSettings, message: NotificationEmailMessage, locale: AppLocale): Promise<void> {
  const sendKey = required(settings.serverchanSendKey, serverText(locale, "service.serverchanSendKey"), locale);
  let response: Response;
  try {
    response = await fetch(serverChanEndpoint(sendKey, locale), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: message.title,
        desp: `${message.content}\n\n${message.timestamp}`,
      }),
    });
  } catch {
    throw new Error(serverFormat(locale, "notification.httpRequestFailed", {
      service: "ServerChan",
      error: serverText(locale, "service.serverchanRequestFailed"),
    }));
  }
  await requireServerChanSuccess(response, locale, sendKey);
}

export function serverChanEndpoint(sendKey: string, locale: AppLocale = DEFAULT_SERVER_I18N_LOCALE): string {
  const trimmed = sendKey.trim();
  if (trimmed.startsWith("sctp")) {
    const match = /^sctp(\d+)t/.exec(trimmed);
    if (!match?.[1]) throw new Error(serverText(locale, "service.serverchanSendKeyInvalid"));
    // sctp SendKey 的数字子域名来自官方 Go SDK 和 Wallos 兼容实现，不允许用户配置任意 URL。
    return `https://${match[1]}.push.ft07.com/send/${encodeURIComponent(trimmed)}.send`;
  }
  return `https://sctapi.ftqq.com/${encodeURIComponent(trimmed)}.send`;
}

async function requireServerChanSuccess(response: Response, locale: AppLocale, sendKey: string): Promise<void> {
  if (!response.ok) throw new Error(await serverChanHttpError(response, locale, sendKey));
  let payload: ServerChanResponse;
  try {
    payload = await response.json();
  } catch {
    throw new Error(serverHttpError("ServerChan", response.status, serverText(locale, "service.serverchanResponseInvalid"), locale));
  }
  // Server酱可能 HTTP 2xx 但业务 code 失败；历史摘要必须按 code 判断真实发送结果。
  if (payload.code === undefined) {
    throw new Error(serverHttpError("ServerChan", response.status, serverText(locale, "service.serverchanResponseInvalid"), locale));
  }
  if (payload.code !== 0) {
    throw new Error(serverHttpError("ServerChan", response.status, redactServerChanSecret(firstText(payload.message, payload.detail), sendKey) || serverText(locale, "service.serverchanResponseInvalid"), locale));
  }
}

async function serverChanHttpError(response: Response, locale: AppLocale, sendKey: string): Promise<string> {
  const payload = await response.clone().json().catch(() => null) as ServerChanResponse | null;
  const detail = redactServerChanSecret(firstText(payload?.message, payload?.detail), sendKey);
  if (detail) return serverHttpError("ServerChan", response.status, detail, locale);
  await response.body?.cancel().catch(() => undefined);
  return serverHttpError("ServerChan", response.status, serverText(locale, "service.serverchanResponseInvalid"), locale);
}

function serverHttpError(channel: string, status: number, detail: string, locale: AppLocale): string {
  return serverFormat(locale, "notification.httpSendFailed", {
    channel,
    status,
    detail: detail.trim().slice(0, 800),
  });
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function redactServerChanSecret(value: string, sendKey: string): string {
  let detail = value.trim();
  const secret = sendKey.trim();
  if (secret) {
    detail = detail.replaceAll(secret, "[redacted]").replaceAll(encodeURIComponent(secret), "[redacted]");
  }
  return detail.slice(0, 800);
}

function required(value: string, label: string, locale: AppLocale): string {
  if (value.trim()) return value.trim();
  throw new Error(serverFormat(locale, "common.requiredField", { label }));
}
