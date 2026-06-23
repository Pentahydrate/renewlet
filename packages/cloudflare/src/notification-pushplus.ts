/**
 * PushPlus 发送器固定调用官方 /send 接口。
 *
 * token 是用户 secret；PushPlus 业务码失败只回显脱敏 rawResponseText，不进入通知历史持久化。
 */
import type { NotificationEmailMessage } from "@renewlet/shared/email-template";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { AppLocale } from "./http";
import { serverFormat, serverText } from "./server-i18n";
import { NotificationChannelError } from "./notification-errors";
import { sendNotificationJson } from "./notification-http";
import {
  createUpstreamErrorDetails,
  providerMessageFromResponse,
  upstreamProviderResponseFromFetchResponse,
} from "./upstream-response";

type PushPlusResponse = {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
};

export async function sendPushPlus(settings: ApiAppSettings, message: NotificationEmailMessage, locale: AppLocale): Promise<void> {
  const token = required(settings.pushplusToken, serverText(locale, "service.pushplusToken"), locale);
  const response = await sendNotificationJson("https://www.pushplus.plus/send", {
    token,
    title: message.title,
    content: `${message.content}\n\n${message.timestamp}`,
    template: "txt",
  }, "PushPlus", locale, { secrets: [token] });
  const providerResponse = await upstreamProviderResponseFromFetchResponse(response, { secrets: [token] });
  if (!response.ok) {
    const detail = providerMessageFromResponse(providerResponse) ?? serverText(locale, "service.pushplusResponseInvalid");
    throw new NotificationChannelError(
      serverFormat(locale, "notification.httpSendFailed", { channel: "PushPlus", status: response.status, detail: detail.trim().slice(0, 800) }),
      createUpstreamErrorDetails({ responseText: detail, providerResponse }),
    );
  }
  const payload = parsePushPlusResponse(providerResponse.body);
  // PushPlus HTTP 2xx 仅代表网关可达；官方业务 code=200 才代表请求被接收，渠道内不重试以免撞频率/额度限制。
  if (!payload || payload.code !== 200) {
    const detail = firstText(payload?.msg, payload?.data)
      || providerMessageFromResponse(providerResponse)
      || serverText(locale, "service.pushplusResponseInvalid");
    throw new NotificationChannelError(
      serverFormat(locale, "notification.httpSendFailed", { channel: "PushPlus", status: response.status, detail: detail.trim().slice(0, 800) }),
      createUpstreamErrorDetails({ responseText: detail, providerResponse }),
    );
  }
}

function parsePushPlusResponse(value: string | null | undefined): PushPlusResponse | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as PushPlusResponse;
  } catch {
    return null;
  }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function required(value: string, label: string, locale: AppLocale): string {
  if (value.trim()) return value.trim();
  throw new Error(serverFormat(locale, "common.requiredField", { label }));
}
