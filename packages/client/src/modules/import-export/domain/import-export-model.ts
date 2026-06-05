import type { ImportPayload, ImportSubscription, RenewletExportV1 } from "@/lib/api/schemas/import-export";
import type { AppSettings, BillingCycle, CustomCycleUnit, Subscription } from "@/types/subscription";
import type { ConfigItem, CustomConfig } from "@/types/config";
import { labels } from "@/i18n/locales";
import type { DateOnly } from "@/lib/time/date-only";

/**
 * 导入文件大小上限。
 *
 * JSON/ZIP/SQLite 解析都发生在浏览器端；50MiB 是为了允许 Wallos 备份带 Logo，同时避免主线程/Worker 被异常文件拖垮。
 */
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

/**
 * ImportAssetRef 描述导入流程中尚未上传到 Renewlet 的 Logo 资产。
 *
 * subscriptionIndex 绑定预览行，最终 apply 前会上传并改写 payload.logo 为 `/api/app/assets/{id}`。
 */
export interface ImportAssetRef {
  subscriptionIndex: number;
  filename: string;
  blob?: Blob;
  zipEntryName?: string;
  sourceFile?: File;
  previewUrl?: string;
}

/** ImportLogoAutoMatch 记录自动匹配 Logo 的来源，供预览 UI 区分“系统建议”和用户手动选择。 */
export interface ImportLogoAutoMatch {
  subscriptionIndex: number;
  label: string;
  provider: string;
  url: string;
}

/**
 * PreparedImport 是浏览器解析后的导入中间态。
 *
 * payload 已满足 shared import schema；assets 仍是本地 Blob/ZIP entry，必须在提交前通过资产服务落库。
 */
export interface PreparedImport {
  payload: ImportPayload;
  assets: ImportAssetRef[];
  logoAutoMatches?: ImportLogoAutoMatch[];
  warnings: string[];
  wallosUsers?: WallosImportUser[];
}

/** WallosImportUser 用于多用户 Wallos 备份选择；用户 ID 只在导入解析阶段使用，不写入 Renewlet 账号。 */
export interface WallosImportUser {
  id: string;
  label: string;
}

/**
 * 导入消息码。
 *
 * 预览/服务端只传稳定 code 和少量参数，展示层再用 Lingui 翻译，避免把中文/英文文案写入导入 payload。
 */
export const IMPORT_MESSAGE_CODES = {
  currencySymbolAmbiguous: "IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS",
  dateInvalid: "IMPORT_WARNING_DATE_INVALID",
  invalidWebsite: "IMPORT_WARNING_INVALID_WEBSITE",
  lowConfidenceDisplay: "IMPORT_WARNING_WALLOS_DISPLAY_LOW_CONFIDENCE",
  renewletLegacyBillingCycleDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_BILLING_CYCLE_DEFAULTED",
  renewletLegacyCurrencyDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_CURRENCY_DEFAULTED",
  renewletLegacyCustomDaysDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_CUSTOM_DAYS_DEFAULTED",
  renewletLegacyLogoDropped: "IMPORT_WARNING_RENEWLET_LEGACY_LOGO_DROPPED",
  renewletLegacyPriceDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_PRICE_DEFAULTED",
  renewletLegacyReminderDaysDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_REMINDER_DAYS_DEFAULTED",
  renewletLegacyRepeatIntervalDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_REPEAT_INTERVAL_DEFAULTED",
  renewletLegacyRepeatWindowDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_REPEAT_WINDOW_DEFAULTED",
  renewletLegacyStatusDefaulted: "IMPORT_WARNING_RENEWLET_LEGACY_STATUS_DEFAULTED",
  renewletLegacyTagsTrimmed: "IMPORT_WARNING_RENEWLET_LEGACY_TAGS_TRIMMED",
  missingLogoFile: "IMPORT_WARNING_WALLOS_MISSING_LOGO_FILE",
  notifyDisabled: "IMPORT_WARNING_WALLOS_NOTIFY_DISABLED",
  oneTime: "IMPORT_WARNING_WALLOS_ONE_TIME",
  onlyCurrencyId: "IMPORT_WARNING_WALLOS_CURRENCY_ID_ONLY",
  externalLogo: "IMPORT_WARNING_WALLOS_EXTERNAL_LOGO",
  unknownCycle: "IMPORT_WARNING_WALLOS_UNKNOWN_CYCLE",
  unrecognizedFile: "IMPORT_ERROR_UNRECOGNIZED_FILE",
  wallosTableTooLarge: "IMPORT_ERROR_WALLOS_TABLE_TOO_LARGE",
  workerParseFailed: "IMPORT_ERROR_WORKER_PARSE_FAILED",
  workerUnsupported: "IMPORT_ERROR_WORKER_UNSUPPORTED",
} as const;

/** importMessage 用 `|` 串联 code 参数，便于服务端/前端在数组里传递可本地化 warning。 */
export function importMessage(code: string, ...params: Array<string | number>): string {
  return [code, ...params.map(String)].join("|");
}

const SECRET_SETTING_KEYS = new Set<keyof AppSettings>([
  "telegramBotToken",
  "telegramChatId",
  "notifyxApiKey",
  "webhookUrl",
  "webhookHeaders",
  "webhookPayload",
  "wechatWebhookUrl",
  "wechatAtPhones",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUser",
  "smtpPassword",
  "smtpFrom",
  "smtpReplyTo",
  "recipientEmail",
  "barkServerUrl",
  "barkDeviceKey",
  "serverchanSendKey",
]);

type RenewletExportSubscription = RenewletExportV1["data"]["subscriptions"][number];

/**
 * sanitizeSettingsForExport 移除默认不应进入备份的通知和账号 secret。
 *
 * includeSecrets 只由用户显式选择触发；普通备份不能意外携带 SMTP、Webhook、Bark 等凭证。
 */
export function sanitizeSettingsForExport(settings: AppSettings, includeSecrets: boolean): Partial<AppSettings> {
  const entries = Object.entries(settings).filter(([key]) => includeSecrets || !SECRET_SETTING_KEYS.has(key as keyof AppSettings));
  return Object.fromEntries(entries) as Partial<AppSettings>;
}

/**
 * subscriptionToImportSubscription 把当前订阅转换为导入执行契约。
 *
 * extra.import 以当前订阅 id 作为高置信幂等键，保证 Renewlet 自导出再导入时能 replace/skip 同一条记录。
 */
export function subscriptionToImportSubscription(subscription: Subscription, sourceId = subscription.id): ImportSubscription {
  const extra = {
    ...(subscription.extra ?? {}),
    import: { source: "renewlet" as const, sourceId, confidence: "high" as const },
  };
  return {
    name: subscription.name,
    logo: subscription.logo ?? null,
    price: subscription.price,
    currency: subscription.currency,
    billingCycle: subscription.billingCycle,
    customDays: subscription.billingCycle === "custom" ? subscription.customDays : null,
    customCycleUnit: subscription.billingCycle === "custom" ? subscription.customCycleUnit : null,
    oneTimeTermCount: subscription.billingCycle === "one-time" ? subscription.oneTimeTermCount ?? null : null,
    oneTimeTermUnit: subscription.billingCycle === "one-time" ? subscription.oneTimeTermUnit ?? null : null,
    category: subscription.category,
    status: subscription.status,
    pinned: subscription.pinned,
    paymentMethod: subscription.paymentMethod ?? null,
    startDate: subscription.startDate,
    nextBillingDate: subscription.nextBillingDate,
    autoCalculateNextBillingDate: subscription.autoCalculateNextBillingDate,
    trialEndDate: subscription.trialEndDate ?? null,
    website: subscription.website ?? null,
    notes: subscription.notes ?? null,
    tags: subscription.tags,
    reminderDays: subscription.reminderDays,
    repeatReminderEnabled: subscription.repeatReminderEnabled,
    repeatReminderInterval: subscription.repeatReminderInterval,
    repeatReminderWindow: subscription.repeatReminderWindow,
    extra,
  };
}

/**
 * subscriptionToExportRow 生成备份 JSON 中的订阅行。
 *
 * 这里保留原始 status/extra，和 CSV 的“有效状态”报表口径分开，保证备份可用于未来迁移。
 */
export function subscriptionToExportRow(subscription: Subscription): RenewletExportSubscription {
  return {
    id: subscription.id,
    name: subscription.name,
    ...(subscription.logo ? { logo: subscription.logo } : {}),
    price: subscription.price,
    currency: subscription.currency,
    billingCycle: subscription.billingCycle,
    ...(subscription.billingCycle === "custom" ? { customDays: subscription.customDays, customCycleUnit: subscription.customCycleUnit } : {}),
    ...(subscription.billingCycle === "one-time" && subscription.oneTimeTermCount && subscription.oneTimeTermUnit
      ? { oneTimeTermCount: subscription.oneTimeTermCount, oneTimeTermUnit: subscription.oneTimeTermUnit }
      : {}),
    category: subscription.category,
    status: subscription.status,
    pinned: subscription.pinned,
    ...(subscription.paymentMethod ? { paymentMethod: subscription.paymentMethod } : {}),
    startDate: subscription.startDate,
    nextBillingDate: subscription.nextBillingDate,
    autoCalculateNextBillingDate: subscription.autoCalculateNextBillingDate,
    ...(subscription.trialEndDate ? { trialEndDate: subscription.trialEndDate } : {}),
    ...(subscription.website ? { website: subscription.website } : {}),
    ...(subscription.notes ? { notes: subscription.notes } : {}),
    tags: subscription.tags,
    reminderDays: subscription.reminderDays,
    repeatReminderEnabled: subscription.repeatReminderEnabled,
    repeatReminderInterval: subscription.repeatReminderInterval,
    repeatReminderWindow: subscription.repeatReminderWindow,
    extra: subscription.extra ?? {},
  };
}

/** cloneImportPayload 深拷贝导入 payload，供预览交互在不污染原始解析结果的情况下重算。 */
export function cloneImportPayload(payload: ImportPayload): ImportPayload {
  return JSON.parse(JSON.stringify(payload)) as ImportPayload;
}

/** stableHash 为缺少稳定 ID 的外部来源生成可复现幂等键，不作为安全哈希使用。 */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** slugValue 生成自定义配置项 value；hash fallback 防止全非拉丁名称被清空。 */
export function slugValue(prefix: string, value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || stableHash(value)}`.slice(0, 80);
}

/** mergeConfigItem 只按 value 去重，保留用户已有 label/color/icon 配置。 */
export function mergeConfigItem(items: ConfigItem[], item: ConfigItem): ConfigItem[] {
  if (items.some((current) => current.value === item.value)) return items;
  return [...items, item];
}

/** makeConfigItem 把导入来源原文转成用户自定义配置项；这里允许 labels() 保存来源原文。 */
export function makeConfigItem(value: string, label: string): ConfigItem {
  return {
    id: value,
    value,
    labels: labels(label, label),
  };
}

/** normalizeDateOnly 在导入边界把坏日期降级到 fallback，并留下可本地化 warning。 */
export function normalizeDateOnly(value: unknown, fallback: DateOnly | string, warnings: string[], label: string): DateOnly {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    return text as DateOnly;
  }
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.dateInvalid, label, fallback));
  return fallback as DateOnly;
}

/** normalizeWebsite 只接受 http(s)，避免导入把 javascript/blob/data 等不可审计 URL 写入订阅。 */
export function normalizeWebsite(value: unknown, warnings: string[]): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    warnings.push(IMPORT_MESSAGE_CODES.invalidWebsite);
    return undefined;
  }
  warnings.push(IMPORT_MESSAGE_CODES.invalidWebsite);
  return undefined;
}

export interface ImportBillingCycle {
  billingCycle: BillingCycle;
  customDays?: number;
  customCycleUnit?: CustomCycleUnit;
}

/** toBillingCycleFromDays 把 Wallos 天数周期映射到 Renewlet 当前正式 billingCycle 契约。 */
export function toBillingCycleFromDays(days: number): ImportBillingCycle {
  if (days === 7) return { billingCycle: "weekly" };
  if (days === 30) return { billingCycle: "monthly" };
  if (days === 90) return { billingCycle: "quarterly" };
  if (days === 180) return { billingCycle: "semi-annual" };
  if (days === 365) return { billingCycle: "annual" };
  return { billingCycle: "custom", customDays: Math.max(1, Math.round(days)), customCycleUnit: "day" };
}

export function toBillingCycleFromUnit(count: number, unit: CustomCycleUnit): ImportBillingCycle {
  const normalizedCount = Math.max(1, Math.round(count));
  if (unit === "week" && normalizedCount === 1) return { billingCycle: "weekly" };
  if (unit === "month" && normalizedCount === 1) return { billingCycle: "monthly" };
  if (unit === "month" && normalizedCount === 3) return { billingCycle: "quarterly" };
  if (unit === "month" && normalizedCount === 6) return { billingCycle: "semi-annual" };
  if (unit === "year" && normalizedCount === 1) return { billingCycle: "annual" };
  return { billingCycle: "custom", customDays: normalizedCount, customCycleUnit: unit };
}

/** privateAssetIdFromLogo 只识别受控资产代理路径，外链 Logo 不参与 ZIP 资产导出。 */
export function privateAssetIdFromLogo(value: string | undefined): string | null {
  const match = value?.match(/^\/api\/app\/assets\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}
