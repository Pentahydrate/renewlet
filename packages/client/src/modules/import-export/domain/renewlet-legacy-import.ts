import { importPayloadSchema, type ImportPayload } from "@/lib/api/schemas/import-export";
import {
  BILLING_CYCLES,
  INHERIT_REMINDER_DAYS,
  MAX_REMINDER_DAYS,
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  SUBSCRIPTION_STATUSES,
  isValidDateOnly,
  type BillingCycle,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type SubscriptionStatus,
} from "@renewlet/shared/runtime";
import {
  importMessage,
  IMPORT_MESSAGE_CODES,
  normalizeWebsite,
  stableHash,
  type ImportAssetRef,
  type PreparedImport,
} from "./import-export-model";
import type { ImportAssetSource, ImportBuildBaseContext } from "./wallos-import-mapping";

/**
 * 旧 Renewlet 导入桥。
 *
 * TODO: 当 Docker 老用户完成一次性迁移、线上已不再需要识别早期 renewlet JSON/ZIP 形状时，连同
 * `wallos-import.ts` / `wallos-import-worker.ts` 里的接线一起整块删除；不要把这里继续演化成长期兼容层。
 */
type ImportSubscription = ImportPayload["subscriptions"][number];

const BILLING_CYCLE_SET = new Set<string>(BILLING_CYCLES);
const STATUS_SET = new Set<string>(SUBSCRIPTION_STATUSES);
const REPEAT_REMINDER_INTERVAL_SET = new Set<string>(REPEAT_REMINDER_INTERVALS);
const REPEAT_REMINDER_WINDOW_SET = new Set<string>(REPEAT_REMINDER_WINDOWS);
const PRIVATE_ASSET_PATH_PATTERN = /^\/api\/app\/assets\/[A-Za-z0-9_-]+$/;

interface LegacyRenewletContainer {
  subscriptions: unknown[];
}

export function buildPreparedLegacyRenewletImport(
  value: unknown,
  context: ImportBuildBaseContext,
  assetFiles = new Map<string, ImportAssetSource>(),
): PreparedImport | null {
  const legacy = extractLegacyRenewletContainer(value);
  if (!legacy) return null;

  return buildFromLegacyRenewlet(legacy, context, assetFiles);
}

function buildFromLegacyRenewlet(
  legacy: LegacyRenewletContainer,
  context: ImportBuildBaseContext,
  assetFiles: ReadonlyMap<string, ImportAssetSource>,
): PreparedImport {
  const warnings: string[] = [];
  const assets: ImportAssetRef[] = [];
  const subscriptions = legacy.subscriptions.map((item, index) => buildLegacySubscription(item, index, context, warnings, assets, assetFiles));

  return {
    payload: importPayloadSchema.parse({ source: "renewlet", subscriptions }),
    assets,
    warnings,
  };
}

function buildLegacySubscription(
  value: unknown,
  index: number,
  context: ImportBuildBaseContext,
  warnings: string[],
  assets: ImportAssetRef[],
  assetFiles: ReadonlyMap<string, ImportAssetSource>,
): ImportSubscription {
  if (!isRecord(value)) {
    throw new Error(IMPORT_MESSAGE_CODES.unrecognizedFile);
  }
  const row = value;
  const name = normalizeName(row["name"]);
  const localWarnings: string[] = [];
  const billingCycle = normalizeBillingCycle(row["billingCycle"], localWarnings);
  const startDate = normalizeDateOnly(row["startDate"], context.today, localWarnings, "renewletStartDate");
  const nextBillingDate = normalizeDateOnly(row["nextBillingDate"], startDate, localWarnings, "renewletDueDate");
  const logo = normalizeLegacyLogo(row["logo"], index, assets, assetFiles, localWarnings);
  const extra = isRecord(row["extra"]) ? { ...row["extra"] } : {};
  const sourceId = normalizeLegacySourceId(row);
  const website = normalizeWebsite(row["website"], localWarnings) ?? null;

  const subscription: ImportSubscription = {
    name,
    logo,
    price: normalizePrice(row["price"], localWarnings),
    currency: normalizeCurrency(row["currency"], localWarnings),
    billingCycle,
    customDays: billingCycle === "custom" ? normalizeCustomDays(row["customDays"], localWarnings) : null,
    category: normalizeCategory(row["category"]),
    status: normalizeStatus(row["status"], localWarnings),
    paymentMethod: normalizeOptionalText(row["paymentMethod"]),
    startDate,
    nextBillingDate,
    autoCalculateNextBillingDate: billingCycle === "one-time" ? false : normalizeBoolean(row["autoCalculateNextBillingDate"], true),
    trialEndDate: normalizeNullableDateOnly(row["trialEndDate"], localWarnings),
    website,
    notes: normalizeNullableText(row["notes"]),
    tags: normalizeTags(row["tags"], localWarnings),
    reminderDays: normalizeReminderDays(row["reminderDays"], localWarnings),
    repeatReminderEnabled: normalizeBoolean(row["repeatReminderEnabled"], false),
    repeatReminderInterval: normalizeRepeatReminderInterval(row["repeatReminderInterval"], localWarnings),
    repeatReminderWindow: normalizeRepeatReminderWindow(row["repeatReminderWindow"], localWarnings),
    extra: {
      ...extra,
      // 旧版 Renewlet 数据没有 extra.import；必须在入口一次性补齐，后端导入 API 才能继续保持现行幂等契约。
      import: { source: "renewlet", sourceId, confidence: "high" },
    },
  };

  warnings.push(...localWarnings.map((warning) => importMessage("IMPORT_WARNING_FOR_SUBSCRIPTION", name, warning)));
  return subscription;
}

function extractLegacyRenewletContainer(value: unknown): LegacyRenewletContainer | null {
  if (Array.isArray(value)) return asLegacyRenewletSubscriptions(value);
  if (!isRecord(value)) return null;
  return asLegacyRenewletContainer(value) ?? (isRecord(value["data"]) ? asLegacyRenewletContainer(value["data"]) : null);
}

function asLegacyRenewletContainer(value: Record<string, unknown>): LegacyRenewletContainer | null {
  const subscriptions = value["subscriptions"];
  if (!Array.isArray(subscriptions)) return null;
  return asLegacyRenewletSubscriptions(subscriptions);
}

function asLegacyRenewletSubscriptions(subscriptions: unknown[]): LegacyRenewletContainer | null {
  if (subscriptions.length === 0) return null;
  if (!subscriptions.every(isLegacyRenewletSubscription)) return null;
  return { subscriptions };
}

function isLegacyRenewletSubscription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value["name"] !== "string" || typeof value["currency"] !== "string") return false;
  if (!("price" in value) || typeof value["billingCycle"] !== "string") return false;
  return typeof value["startDate"] === "string"
    || typeof value["nextBillingDate"] === "string"
    || typeof value["category"] === "string"
    || typeof value["status"] === "string";
}

function normalizeLegacyLogo(
  value: unknown,
  index: number,
  assets: ImportAssetRef[],
  assetFiles: ReadonlyMap<string, ImportAssetSource>,
  warnings: string[],
): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;

  const asset = assetFiles.get(text);
  if (asset) {
    assets.push(makeAssetRef(index, text, asset));
    return null;
  }

  if (PRIVATE_ASSET_PATH_PATTERN.test(text) || isLogoHttpUrl(text)) {
    return text;
  }

  // 旧 data:image/* 和其他历史 logo 形态已经被当前订阅契约彻底移除；这里直接清空，避免主导入链路再背兼容包袱。
  warnings.push(IMPORT_MESSAGE_CODES.renewletLegacyLogoDropped);
  return null;
}

function makeAssetRef(index: number, logoPath: string, source: ImportAssetSource): ImportAssetRef {
  const parts = logoPath.split("/");
  const lastPart = parts[parts.length - 1];
  const filename = lastPart && lastPart.length > 0 ? lastPart : "renewlet-logo";
  if (typeof source === "string") {
    return { subscriptionIndex: index, filename, zipEntryName: source };
  }
  return { subscriptionIndex: index, filename, blob: source };
}

function normalizeLegacySourceId(value: Record<string, unknown>): string {
  const explicit = normalizeOptionalText(value["id"]);
  if (explicit) return explicit;

  return `legacy:${stableHash([
    normalizeName(value["name"]),
    normalizeFallbackCurrency(value["currency"]),
    normalizeFallbackBillingCycle(value["billingCycle"]),
    normalizeCategory(value["category"]),
    normalizeOptionalText(value["website"]) ?? "",
    normalizeFallbackDateOnly(value["startDate"], "1970-01-01"),
  ].join("\u001f"))}`;
}

function normalizeName(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "Legacy Renewlet Subscription";
}

function normalizePrice(value: unknown, warnings: string[]): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numberValue) && numberValue >= 0) return numberValue;
  warnings.push(IMPORT_MESSAGE_CODES.renewletLegacyPriceDefaulted);
  return 0;
}

function normalizeCurrency(value: unknown, warnings: string[]): string {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (/^[A-Z]{3}$/.test(text)) return text;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyCurrencyDefaulted, "USD"));
  return "USD";
}

function normalizeFallbackCurrency(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(text) ? text : "USD";
}

function normalizeBillingCycle(value: unknown, warnings: string[]): BillingCycle {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (text) {
    case "semiannual":
    case "semi_annual":
      return "semi-annual";
    case "yearly":
      return "annual";
    case "onetime":
    case "one_time":
    case "once":
      return "one-time";
    default:
      if (BILLING_CYCLE_SET.has(text)) return text as BillingCycle;
      warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyBillingCycleDefaulted, "monthly"));
      return "monthly";
  }
}

function normalizeFallbackBillingCycle(value: unknown): BillingCycle {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "semiannual" || text === "semi_annual") return "semi-annual";
  if (text === "yearly") return "annual";
  if (text === "onetime" || text === "one_time" || text === "once") return "one-time";
  return BILLING_CYCLE_SET.has(text) ? text as BillingCycle : "monthly";
}

function normalizeCategory(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "other";
}

function normalizeStatus(value: unknown, warnings: string[]): SubscriptionStatus {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (STATUS_SET.has(text)) return text as SubscriptionStatus;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyStatusDefaulted, "active"));
  return "active";
}

function normalizeCustomDays(value: unknown, warnings: string[]): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (Number.isInteger(numberValue) && numberValue > 0) return numberValue;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyCustomDaysDefaulted, 1));
  return 1;
}

function normalizeReminderDays(value: unknown, warnings: string[]): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue)) {
    warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyReminderDaysDefaulted, INHERIT_REMINDER_DAYS));
    return INHERIT_REMINDER_DAYS;
  }
  const clamped = Math.max(INHERIT_REMINDER_DAYS, Math.min(MAX_REMINDER_DAYS, numberValue));
  if (clamped !== numberValue) {
    warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyReminderDaysDefaulted, clamped));
  }
  return clamped;
}

function normalizeRepeatReminderInterval(value: unknown, warnings: string[]): RepeatReminderInterval {
  const text = typeof value === "string" ? value.trim() : "";
  if (REPEAT_REMINDER_INTERVAL_SET.has(text)) return text as RepeatReminderInterval;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyRepeatIntervalDefaulted, "1h"));
  return "1h";
}

function normalizeRepeatReminderWindow(value: unknown, warnings: string[]): RepeatReminderWindow {
  const text = typeof value === "string" ? value.trim() : "";
  if (REPEAT_REMINDER_WINDOW_SET.has(text)) return text as RepeatReminderWindow;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.renewletLegacyRepeatWindowDefaulted, "72h"));
  return "72h";
}

function normalizeTags(value: unknown, warnings: string[]): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  let changed = false;
  for (const item of value) {
    if (typeof item !== "string") {
      changed = true;
      continue;
    }
    const tag = item.trim();
    if (!tag) {
      changed = true;
      continue;
    }
    tags.push(tag.slice(0, 40));
    if (tag.length > 40) changed = true;
    if (tags.length >= 100) {
      changed = tags.length < value.length;
      break;
    }
  }
  if (changed) warnings.push(IMPORT_MESSAGE_CODES.renewletLegacyTagsTrimmed);
  return tags;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function normalizeNullableText(value: unknown): string | null {
  return normalizeOptionalText(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDateOnly(value: unknown, fallback: string, warnings: string[], label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (isValidDateOnly(text)) return text;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.dateInvalid, label, fallback));
  return fallback;
}

function normalizeFallbackDateOnly(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return isValidDateOnly(text) ? text : fallback;
}

function normalizeNullableDateOnly(value: unknown, warnings: string[]): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (isValidDateOnly(text)) return text;
  warnings.push(importMessage(IMPORT_MESSAGE_CODES.dateInvalid, "renewletTrialEndDate", "empty"));
  return null;
}

function isLogoHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
