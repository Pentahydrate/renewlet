/**
 * 浏览器端 API client。
 *
 * 架构位置：
 * - React hooks/application 层通过这里调用 Go/PocketBase 自定义 API。
 * - PocketBase 原生 token 通过 Authorization header 发送给自定义路由。
 *
 * 请求/校验流转：
 * ```mermaid
 * flowchart LR
 *   A[调用方传入 Zod schema] --> B[补齐认证/语言/时区 headers]
 *   B --> C[合并外部取消与本地超时]
 *   C --> D[fetch]
 *   D --> E[安全解析 JSON]
 *   E --> F{HTTP ok?}
 *   F -- 否 --> G[提取后端错误并抛 ApiError]
 *   F -- 是 --> H{schema.safeParse}
 *   H -- 失败 --> I[抛 invalid_response ApiError]
 *   H -- 成功 --> J[返回 parse 后的数据]
 * ```
 *
 * 注意： FormData 请求不能手动设置 content-type，否则浏览器不会自动补 multipart boundary。
 * 注意： 不要恢复 `apiFetch<T>` 式的纯类型断言；本文件是前端拒绝异常 API 响应的唯一运行时边界。
 */
import { getAuthHeader } from "@/lib/pocketbase";
import { clearAuthSession } from "@/lib/auth-session";
import { getApiLocale, getLocaleHeaders } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";
import { z } from "zod";

export class ApiError extends Error {
  // status/details/code 是 UI 错误展示和表单字段定位的唯一结构化通道。
  status: number;
  details: unknown;
  code: "timeout" | "aborted" | "network" | (string & {}) | undefined;

  constructor(
    message: string,
    status: number,
    details?: unknown,
    code?: "timeout" | "aborted" | "network" | (string & {}),
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/** 请求级 fetch 配置；`timeoutMs` 只在本 client 内消费，不透传给浏览器 fetch。 */
export type ApiFetchInit = RequestInit & {
  timeoutMs?: number;
};

const DEFAULT_JSON_TIMEOUT_MS = 30_000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

function createAbortSignal(
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal?: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const normalizedTimeout = Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 0;
  if (!externalSignal && normalizedTimeout <= 0) {
    return { cleanup: () => undefined, didTimeout: () => false };
  }

  // 将外部取消和本地超时合并成一个 signal，调用方无需关心哪个来源触发 abort。
  // 为什么不用 AbortSignal.timeout/any：浏览器兼容性和测试环境差异会让错误分类不稳定。
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  if (normalizedTimeout > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, normalizedTimeout);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
    didTimeout: () => timedOut,
  };
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStringField(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getFieldErrors(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(value)) {
    const normalized = getStringArray(messages);
    if (normalized.length > 0) result[field] = normalized;
  }
  return result;
}

function formatValidationSummary(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const formErrors = getStringArray(value["formErrors"]);
  const fieldErrors = getFieldErrors(value["fieldErrors"]);
  const lines = [
    ...formErrors,
    ...Object.entries(fieldErrors).map(([field, messages]) => `${field}: ${messages[0]}`),
  ].filter(Boolean);

  // 后端/Zod 的 flatten 结构不适合直接展示完整 JSON；压缩到前三条能保留定位价值且避免 Toast 撑爆。
  if (lines.length === 0) return undefined;
  const separator = getApiLocale() === "zh-CN" ? "；" : "; ";
  const visible = lines.slice(0, 3).join(separator);
  const suffix = lines.length > 3
    ? `${separator}${translate(getApiLocale(), "error.moreErrors", { count: lines.length - 3 })}`
    : "";
  const headingSeparator = getApiLocale() === "zh-CN" ? "：" : ": ";
  return `${translate(getApiLocale(), "error.invalidParams")}${headingSeparator}${visible}${suffix}`;
}

function getValidationMessage(payload: Record<string, unknown>): string | undefined {
  return formatValidationSummary(payload["errors"]) ?? formatValidationSummary(payload["details"]);
}

function isGenericLegacyError(message: string | undefined): boolean {
  return message === "Invalid payload" || message === translate(getApiLocale(), "error.invalidParams");
}

function getErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const direct = getStringField(payload, ["detail", "message", "error", "title"]);
  const validationMessage = getValidationMessage(payload);
  if (validationMessage && isGenericLegacyError(direct)) return validationMessage;

  return direct ?? validationMessage;
}

function getErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return getStringField(payload, ["code"]);
}

function getClientTimeZoneHeader(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone || null;
  } catch {
    return null;
  }
}

/**
 * 带运行时 schema 校验的 fetch 封装（默认 JSON）。
 *
 * 约定：
 * - 自动加 JSON content-type，但 FormData 保留浏览器 multipart boundary
 * - 自动携带 Cookie 和当前运行面的 Bearer token
 * - 非 2xx 时抛出 `ApiError`
 * - 2xx 响应必须通过调用方传入的 Zod schema，否则抛出 `ApiError`
 */
export async function apiFetch<Schema extends z.ZodType>(
  input: RequestInfo,
  responseSchema: Schema,
  init?: ApiFetchInit,
): Promise<z.infer<Schema>> {
  const { timeoutMs = DEFAULT_JSON_TIMEOUT_MS, signal: externalSignal, ...fetchInit } = init ?? {};
  const headers = new Headers(init?.headers);
  const isFormDataBody = typeof FormData !== "undefined" && fetchInit.body instanceof FormData;
  // 默认 JSON；FormData 必须让浏览器自己补 multipart boundary。
  if (!headers.has("content-type") && !isFormDataBody) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("x-client-time-zone")) {
    const timeZone = getClientTimeZoneHeader();
    if (timeZone) headers.set("x-client-time-zone", timeZone);
  }
  for (const [key, value] of Object.entries(getLocaleHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  // 认证 header 由运行面适配层提供：Docker 读 PocketBase authStore，Cloudflare 读本地 session cache。
  for (const [key, value] of Object.entries(getAuthHeader())) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const abort = createAbortSignal(externalSignal, timeoutMs);
  let res: Response;
  try {
    const requestInit: RequestInit = {
      ...fetchInit,
      headers,
      credentials: "include",
      ...(abort.signal ? { signal: abort.signal } : {}),
    };
    res = await fetch(input, requestInit);
  } catch (e: unknown) {
    if (abort.didTimeout()) {
      throw new ApiError(translate(getApiLocale(), "error.timeout"), 0, undefined, "timeout");
    }
    if (isAbortError(e)) {
      throw new ApiError(translate(getApiLocale(), "error.aborted"), 0, undefined, "aborted");
    }
    throw new ApiError(e instanceof Error ? e.message : translate(getApiLocale(), "error.network"), 0, undefined, "network");
  } finally {
    abort.cleanup();
  }

  const json = await parseJsonSafely(res);

  if (!res.ok) {
    const message = getErrorMessage(json) || res.statusText || "Request failed";
    if (res.status === 401) {
      clearAuthSession();
    }
    throw new ApiError(message, res.status, json, getErrorCode(json));
  }

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    // API 返回即使是 2xx，也必须重新过 schema。这样后端字段漂移、代理返回 HTML、
    // 或第三方错误页被误转发时，会在边界变成 ApiError，而不是污染 domain/UI 状态。
    throw new ApiError(
      translate(getApiLocale(), "error.invalidResponse"),
      res.status,
      parsed.error.flatten(),
      "invalid_response",
    );
  }

  return parsed.data;
}
