import type { ImportPayload, ImportSubscription } from "@/lib/api/schemas/import-export";
import type { AppSettings, BillingCycle, Subscription } from "@/types/subscription";
import type { ConfigItem, CustomConfig } from "@/types/config";
import { labels } from "@/i18n/locales";
import type { DateOnly } from "@/lib/time/date-only";

export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

export interface ImportAssetRef {
  subscriptionIndex: number;
  filename: string;
  blob?: Blob;
  zipEntryName?: string;
  sourceFile?: File;
  previewUrl?: string;
}

export interface ImportLogoAutoMatch {
  subscriptionIndex: number;
  label: string;
  provider: string;
  url: string;
}

export interface PreparedImport {
  payload: ImportPayload;
  assets: ImportAssetRef[];
  logoAutoMatches?: ImportLogoAutoMatch[];
  warnings: string[];
  wallosUsers?: WallosImportUser[];
}

export interface WallosImportUser {
  id: string;
  label: string;
}

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
  workerParseFailed: "IMPORT_ERROR_WORKER_PARSE_FAILED",
  workerUnsupported: "IMPORT_ERROR_WORKER_UNSUPPORTED",
} as const;

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
]);

export function sanitizeSettingsForExport(settings: AppSettings, includeSecrets: boolean): Partial<AppSettings> {
  const entries = Object.entries(settings).filter(([key]) => includeSecrets || !SECRET_SETTING_KEYS.has(key as keyof AppSettings));
  return Object.fromEntries(entries) as Partial<AppSettings>;
}

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
    category: subscription.category,
    status: subscription.status,
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

export function subscriptionToExportRow(subscription: Subscription) {
  return {
    id: subscription.id,
    name: subscription.name,
    ...(subscription.logo ? { logo: subscription.logo } : {}),
    price: subscription.price,
    currency: subscription.currency,
    billingCycle: subscription.billingCycle,
    ...(subscription.billingCycle === "custom" ? { customDays: subscription.customDays } : {}),
    category: subscription.category,
    status: subscription.status,
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

export function cloneImportPayload(payload: ImportPayload): ImportPayload {
  return JSON.parse(JSON.stringify(payload)) as ImportPayload;
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function slugValue(prefix: string, value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || stableHash(value)}`.slice(0, 80);
}

export function mergeConfigItem(items: ConfigItem[], item: ConfigItem): ConfigItem[] {
  if (items.some((current) => current.value === item.value)) return items;
  return [...items, item];
}

export function makeConfigItem(value: string, label: string): ConfigItem {
  return {
    id: value,
    value,
    labels: labels(label, label),
  };
}

export function normalizeDateOnly(value: unknown, fallback: DateOnly | string, warnings: string[], label: string): DateOnly {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    return text as DateOnly;
  }
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.dateInvalid, label, fallback));
  return fallback as DateOnly;
}

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

export function toBillingCycleFromDays(days: number): { billingCycle: BillingCycle; customDays?: number } {
  if (days === 7) return { billingCycle: "weekly" };
  if (days === 30) return { billingCycle: "monthly" };
  if (days === 90) return { billingCycle: "quarterly" };
  if (days === 180) return { billingCycle: "semi-annual" };
  if (days === 365) return { billingCycle: "annual" };
  return { billingCycle: "custom", customDays: Math.max(1, Math.round(days)) };
}

export function privateAssetIdFromLogo(value: string | undefined): string | null {
  const match = value?.match(/^\/api\/app\/assets\/([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}
