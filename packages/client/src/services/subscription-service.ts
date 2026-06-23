import { apiFetch } from "@/lib/api-client";
import { assertDateOnly } from "@/lib/time/date-only";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";
import { getCurrentUserId } from "@/lib/pocketbase";
import {
  apiSubscriptionSchema,
  subscriptionsListResponseSchema,
  subscriptionResponseSchema,
  subscriptionDeleteResponseSchema,
  type ApiSubscription,
} from "@renewlet/shared/schemas/subscriptions";
import {
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  CUSTOM_CYCLE_UNITS,
  type CustomCycleUnit,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type Subscription,
  type SubscriptionDraft,
} from "@/types/subscription";

const SUBSCRIPTION_PAGE_SIZE = 50;
const SUBSCRIPTION_AGGREGATE_LIMIT = 5000;
type SubscriptionBaseForService = Pick<
  Subscription,
  | "id"
  | "name"
  | "logo"
  | "price"
  | "currency"
  | "category"
  | "status"
  | "paymentMethod"
  | "startDate"
  | "nextBillingDate"
  | "autoRenew"
  | "autoCalculateNextBillingDate"
  | "pinned"
  | "publicHidden"
  | "trialEndDate"
  | "website"
  | "notes"
  | "tags"
  | "reminderDays"
  | "repeatReminderEnabled"
  | "repeatReminderInterval"
  | "repeatReminderWindow"
  | "costSharing"
  | "extra"
>;
type LegacySubscriptionRecord = Record<string, unknown> & { id: string };

export interface SubscriptionPage {
  subscriptions: Subscription[];
  nextCursor: string | null;
  total?: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function normalizeSubscriptionPageLimit(value: number): number {
  if (!Number.isFinite(value)) return SUBSCRIPTION_PAGE_SIZE;
  return Math.max(1, Math.min(Math.trunc(value), 100));
}

function normalizeRepeatReminderInterval(value: unknown): RepeatReminderInterval {
  return typeof value === "string" && REPEAT_REMINDER_INTERVALS.includes(value as RepeatReminderInterval)
    ? value as RepeatReminderInterval
    : "1h";
}

function normalizeRepeatReminderWindow(value: unknown): RepeatReminderWindow {
  return typeof value === "string" && REPEAT_REMINDER_WINDOWS.includes(value as RepeatReminderWindow)
    ? value as RepeatReminderWindow
    : "72h";
}

function normalizeCustomCycleUnit(value: unknown): CustomCycleUnit {
  return typeof value === "string" && CUSTOM_CYCLE_UNITS.includes(value as CustomCycleUnit)
    ? value as CustomCycleUnit
    : "day";
}

function normalizeSubscriptionRecord(row: unknown): unknown {
  if (!isRecord(row)) return row;
  // 旧 PocketBase record 与产品 API row 不完全同形；历史输入先收敛字段，再交给 shared schema。
  const normalized: Record<string, unknown> = {
    id: row["id"],
    name: row["name"],
    price: row["price"],
    currency: row["currency"],
    billingCycle: row["billingCycle"],
    category: row["category"],
    status: row["status"],
    startDate: row["startDate"] ?? null,
    nextBillingDate: row["nextBillingDate"],
    // 旧 PocketBase 行可能没有 autoRenew；缺字段按手动续订读取，避免把历史沉默数据当作自动续订授权。
    autoRenew: row["billingCycle"] === "one-time" ? false : row["autoRenew"] === true,
    autoCalculateNextBillingDate: row["autoCalculateNextBillingDate"],
    pinned: row["pinned"] === true,
    publicHidden: row["publicHidden"] === true,
    reminderDays: row["reminderDays"],
    repeatReminderEnabled: row["repeatReminderEnabled"] === true,
    repeatReminderInterval: normalizeRepeatReminderInterval(row["repeatReminderInterval"]),
    repeatReminderWindow: normalizeRepeatReminderWindow(row["repeatReminderWindow"]),
  };
  if (row["billingCycle"] === "custom") {
    if (typeof row["customDays"] === "number") normalized["customDays"] = row["customDays"];
    // PocketBase 旧行没有 customCycleUnit；custom 读取缺省按 day，固定周期的空字符串则不进入 shared enum。
    normalized["customCycleUnit"] = normalizeCustomCycleUnit(row["customCycleUnit"]);
  }
  if (row["billingCycle"] === "one-time") {
    if (typeof row["oneTimeTermCount"] === "number" && row["oneTimeTermCount"] > 0 && typeof row["oneTimeTermUnit"] === "string") {
      normalized["oneTimeTermCount"] = row["oneTimeTermCount"];
      normalized["oneTimeTermUnit"] = normalizeCustomCycleUnit(row["oneTimeTermUnit"]);
    }
  }
  if (Array.isArray(row["tags"])) normalized["tags"] = row["tags"];
  if (isRecord(row["costSharing"]) && Object.keys(row["costSharing"]).length > 0) {
    normalized["costSharing"] = row["costSharing"];
  }

  for (const key of ["logo", "paymentMethod", "trialEndDate", "website", "notes"] as const) {
    const value = optionalNonEmptyString(row[key]);
    if (value !== undefined) normalized[key] = value;
  }
  const createdAt = optionalNonEmptyString(row["createdAt"]) ?? optionalNonEmptyString(row["created"]);
  if (createdAt !== undefined) normalized["createdAt"] = createdAt;
  const updatedAt = optionalNonEmptyString(row["updatedAt"]) ?? optionalNonEmptyString(row["updated"]);
  if (updatedAt !== undefined) normalized["updatedAt"] = updatedAt;
  if (isRecord(row["extra"])) normalized["extra"] = row["extra"];

  return normalized;
}

/**
 * 将任一运行面返回的订阅记录收敛成前端 domain 对象。
 *
 * PocketBase 原生 record 与 Cloudflare API response 都必须先通过 shared schema；
 * React 层只看到 `Subscription` union，避免表单和统计逻辑按运行面分叉。
 */
export function fromApiSubscription(row: ApiSubscription | LegacySubscriptionRecord): Subscription {
  const parsedRow: ApiSubscription = apiSubscriptionSchema.parse(normalizeSubscriptionRecord(row));
  const startDate = parsedRow.startDate === null ? null : assertDateOnly(parsedRow.startDate);
  const nextBillingDate = assertDateOnly(parsedRow.nextBillingDate);
  const trialEndDate = parsedRow.trialEndDate ? assertDateOnly(parsedRow.trialEndDate) : undefined;
  const base = {
    id: parsedRow.id,
    name: parsedRow.name,
    logo: parsedRow.logo,
    price: parsedRow.price,
    currency: parsedRow.currency,
    category: parsedRow.category,
    status: parsedRow.status,
    paymentMethod: parsedRow.paymentMethod,
    startDate,
    nextBillingDate,
    autoRenew: parsedRow.billingCycle === "one-time" ? false : parsedRow.autoRenew,
    autoCalculateNextBillingDate: parsedRow.autoCalculateNextBillingDate,
    pinned: parsedRow.pinned,
    publicHidden: parsedRow.publicHidden,
    trialEndDate,
    website: parsedRow.website,
    notes: parsedRow.notes,
    tags: parsedRow.tags ?? [],
    reminderDays: parsedRow.reminderDays,
    repeatReminderEnabled: parsedRow.repeatReminderEnabled,
    repeatReminderInterval: parsedRow.repeatReminderInterval,
    repeatReminderWindow: parsedRow.repeatReminderWindow,
    costSharing: parsedRow.costSharing,
    extra: parsedRow.extra,
  } satisfies SubscriptionBaseForService;
  if (parsedRow.billingCycle === "custom") {
    // 旧 custom 记录没有单位字段；读边界统一按 day 解释，避免统计和自动推算把历史含义改成月/年。
    return {
      ...base,
      billingCycle: "custom",
      customDays: parsedRow.customDays ?? 1,
      customCycleUnit: normalizeCustomCycleUnit(parsedRow.customCycleUnit),
      oneTimeTermCount: undefined,
      oneTimeTermUnit: undefined,
    };
  }
  if (parsedRow.billingCycle === "one-time") {
    return {
      ...base,
      billingCycle: "one-time",
      customDays: undefined,
      customCycleUnit: undefined,
      oneTimeTermCount: parsedRow.oneTimeTermCount,
      oneTimeTermUnit: parsedRow.oneTimeTermUnit ? normalizeCustomCycleUnit(parsedRow.oneTimeTermUnit) : undefined,
    };
  }
  return {
    ...base,
    billingCycle: parsedRow.billingCycle,
    customDays: undefined,
    customCycleUnit: undefined,
    oneTimeTermCount: undefined,
    oneTimeTermUnit: undefined,
  };
}

/**
 * 生成订阅写入 payload。
 *
 * `null` 表示清空可选字段，`undefined` 表示字段缺席；这里主动使用 null，
 * 防止 PocketBase patch 和 Worker JSON merge 对可选字段产生不同语义。
 */
export function toSubscriptionWritePayload(sub: SubscriptionDraft | Subscription) {
  return {
    name: sub.name,
    logo: sub.logo ?? null,
    price: sub.price,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    // null 表示服务端应清空可选字段；undefined 会在 PocketBase/Worker 两端产生不同 patch 语义。
    customDays: sub.customDays ?? null,
    customCycleUnit: sub.customCycleUnit ?? null,
    oneTimeTermCount: sub.oneTimeTermCount ?? null,
    oneTimeTermUnit: sub.oneTimeTermUnit ?? null,
    category: sub.category,
    status: sub.status,
    paymentMethod: sub.paymentMethod ?? null,
    startDate: sub.startDate,
    nextBillingDate: sub.nextBillingDate,
    autoRenew: sub.billingCycle === "one-time" ? false : sub.autoRenew,
    autoCalculateNextBillingDate: sub.autoCalculateNextBillingDate,
    pinned: sub.pinned,
    publicHidden: sub.publicHidden,
    trialEndDate: sub.trialEndDate ?? null,
    website: sub.website ?? null,
    notes: sub.notes ?? null,
    tags: sub.tags ?? [],
    reminderDays: sub.reminderDays,
    repeatReminderEnabled: sub.repeatReminderEnabled,
    repeatReminderInterval: sub.repeatReminderInterval,
    repeatReminderWindow: sub.repeatReminderWindow,
    costSharing: sub.costSharing ?? null,
    // extra 是导入/seed 的幂等通道；编辑普通字段时必须随记录保留，避免重复导入失效。
    extra: sub.extra ?? {},
  };
}

export const subscriptionService = {
  pageSize: SUBSCRIPTION_PAGE_SIZE,

  async listPage(cursor?: string | null, limit = SUBSCRIPTION_PAGE_SIZE): Promise<SubscriptionPage> {
    const userId = getCurrentUserId();
    if (!userId) return { subscriptions: [], nextCursor: null, total: 0 };
    const pageSize = normalizeSubscriptionPageLimit(limit);
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) params.set("cursor", cursor);
    const data = await apiFetch(`/api/app/subscriptions?${params.toString()}`, subscriptionsListResponseSchema);
    return {
      subscriptions: data.subscriptions.map(fromApiSubscription),
      nextCursor: data.nextCursor,
      total: data.total,
    };
  },

  async list(): Promise<Subscription[]> {
    const out: Subscription[] = [];
    let cursor: string | null | undefined = null;
    const seenCursors = new Set<string>();
    for (;;) {
      const page = await this.listPage(cursor, SUBSCRIPTION_PAGE_SIZE);
      out.push(...page.subscriptions);
      if (!page.nextCursor) return out.slice(0, SUBSCRIPTION_AGGREGATE_LIMIT);
      if (seenCursors.has(page.nextCursor)) {
        // 后端 cursor 应单调推进；重复 cursor 说明分页没有前进，必须熔断以免首页/统计页请求风暴。
        throw new Error("SUBSCRIPTION_CURSOR_REPEATED");
      }
      // 聚合列表主要给统计/导出使用；上限避免异常数据量让单页 UI 拉取变成无界循环。
      if (out.length >= SUBSCRIPTION_AGGREGATE_LIMIT) return out.slice(0, SUBSCRIPTION_AGGREGATE_LIMIT);
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  },

  async create(sub: SubscriptionDraft): Promise<Subscription> {
    const userId = getCurrentUserId();
    if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));
    const payload = toSubscriptionWritePayload(sub);
    const data = await apiFetch("/api/app/subscriptions", subscriptionResponseSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return fromApiSubscription(data.subscription);
  },

  async update(sub: Subscription): Promise<Subscription> {
    const payload = toSubscriptionWritePayload(sub);
    const data = await apiFetch(`/api/app/subscriptions/${sub.id}`, subscriptionResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return fromApiSubscription(data.subscription);
  },

  async renew(id: string): Promise<Subscription> {
    const data = await apiFetch(`/api/app/subscriptions/${id}/renew`, subscriptionResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return fromApiSubscription(data.subscription);
  },

  async delete(id: string): Promise<void> {
    await apiFetch(`/api/app/subscriptions/${id}`, subscriptionDeleteResponseSchema, { method: "DELETE" });
  },
};
