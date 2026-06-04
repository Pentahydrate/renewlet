import { apiFetch } from "@/lib/api-client";
import { withPocketBaseAuthGuard } from "@/lib/auth-session";
import { assertDateOnly } from "@/lib/time/date-only";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import {
  apiSubscriptionSchema,
  subscriptionsListResponseSchema,
  subscriptionResponseSchema,
  subscriptionDeleteResponseSchema,
  type ApiSubscription,
} from "@/lib/api/schemas/subscriptions";
import { isCloudflareRuntime } from "./runtime";
import {
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type Subscription,
  type SubscriptionDraft,
} from "@/types/subscription";

const SUBSCRIPTION_PAGE_SIZE = 50;
const SUBSCRIPTION_AGGREGATE_LIMIT = 5000;

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

function normalizeSubscriptionRecord(row: unknown): unknown {
  if (!isRecord(row)) return row;
  // PocketBase SDK record 与 Worker API row 不完全同形；这里先收敛字段，再交给 shared schema。
  const normalized: Record<string, unknown> = {
    id: row["id"],
    name: row["name"],
    price: row["price"],
    currency: row["currency"],
    billingCycle: row["billingCycle"],
    category: row["category"],
    status: row["status"],
    startDate: row["startDate"],
    nextBillingDate: row["nextBillingDate"],
    autoCalculateNextBillingDate: row["autoCalculateNextBillingDate"],
    pinned: row["pinned"] === true,
    reminderDays: row["reminderDays"],
    repeatReminderEnabled: row["repeatReminderEnabled"] === true,
    repeatReminderInterval: normalizeRepeatReminderInterval(row["repeatReminderInterval"]),
    repeatReminderWindow: normalizeRepeatReminderWindow(row["repeatReminderWindow"]),
  };
  if (typeof row["customDays"] === "number") normalized["customDays"] = row["customDays"];
  if (Array.isArray(row["tags"])) normalized["tags"] = row["tags"];

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
export function fromApiSubscription(row: ApiSubscription | RecordModel): Subscription {
  const parsedRow = apiSubscriptionSchema.parse(normalizeSubscriptionRecord(row));
  const base = {
    id: parsedRow.id,
    name: parsedRow.name,
    logo: parsedRow.logo,
    price: parsedRow.price,
    currency: parsedRow.currency,
    category: parsedRow.category,
    status: parsedRow.status,
    paymentMethod: parsedRow.paymentMethod,
    startDate: assertDateOnly(parsedRow.startDate),
    nextBillingDate: assertDateOnly(parsedRow.nextBillingDate),
    autoCalculateNextBillingDate: parsedRow.autoCalculateNextBillingDate,
    pinned: parsedRow.pinned,
    trialEndDate: parsedRow.trialEndDate ? assertDateOnly(parsedRow.trialEndDate) : undefined,
    website: parsedRow.website,
    notes: parsedRow.notes,
    tags: parsedRow.tags ?? [],
    reminderDays: parsedRow.reminderDays,
    repeatReminderEnabled: parsedRow.repeatReminderEnabled,
    repeatReminderInterval: parsedRow.repeatReminderInterval,
    repeatReminderWindow: parsedRow.repeatReminderWindow,
    extra: parsedRow.extra,
  };
  if (parsedRow.billingCycle === "custom") {
    // domain union 要求 custom 一定有 customDays；缺失时按 1 天兜底，避免表单回填不可编辑。
    return { ...base, billingCycle: "custom", customDays: parsedRow.customDays ?? 1 };
  }
  return { ...base, billingCycle: parsedRow.billingCycle, customDays: undefined };
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
    category: sub.category,
    status: sub.status,
    paymentMethod: sub.paymentMethod ?? null,
    startDate: sub.startDate,
    nextBillingDate: sub.nextBillingDate,
    autoCalculateNextBillingDate: sub.autoCalculateNextBillingDate,
    pinned: sub.pinned,
    trialEndDate: sub.trialEndDate ?? null,
    website: sub.website ?? null,
    notes: sub.notes ?? null,
    tags: sub.tags ?? [],
    reminderDays: sub.reminderDays,
    repeatReminderEnabled: sub.repeatReminderEnabled,
    repeatReminderInterval: sub.repeatReminderInterval,
    repeatReminderWindow: sub.repeatReminderWindow,
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
    if (isCloudflareRuntime) {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) params.set("cursor", cursor);
      const data = await apiFetch(`/api/app/subscriptions?${params.toString()}`, subscriptionsListResponseSchema);
      return {
        subscriptions: data.subscriptions.map(fromApiSubscription),
        nextCursor: data.nextCursor,
        total: data.total,
      };
    }
    const page = Math.max(1, cursor ? Number.parseInt(cursor, 10) : 1);
    const result = await withPocketBaseAuthGuard(pb.collection("subscriptions").getList<ApiSubscription>(page, pageSize, {
      filter: `user = "${userId}"`,
      sort: "-created",
    }));
    return {
      subscriptions: result.items.map(fromApiSubscription),
      nextCursor: page < result.totalPages ? String(page + 1) : null,
      total: result.totalItems,
    };
  },

  async list(): Promise<Subscription[]> {
    const out: Subscription[] = [];
    let cursor: string | null | undefined = null;
    for (;;) {
      const page = await this.listPage(cursor, SUBSCRIPTION_PAGE_SIZE);
      out.push(...page.subscriptions);
      // 聚合列表主要给统计/导出使用；上限避免异常数据量让单页 UI 拉取变成无界循环。
      if (!page.nextCursor || out.length >= SUBSCRIPTION_AGGREGATE_LIMIT) return out.slice(0, SUBSCRIPTION_AGGREGATE_LIMIT);
      cursor = page.nextCursor;
    }
  },

  async create(sub: SubscriptionDraft): Promise<Subscription> {
    const userId = getCurrentUserId();
    if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));
    const payload = toSubscriptionWritePayload(sub);
    if (isCloudflareRuntime) {
      const data = await apiFetch("/api/app/subscriptions", subscriptionResponseSchema, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return fromApiSubscription(data.subscription);
    }
    const row = await withPocketBaseAuthGuard(pb.collection("subscriptions").create<ApiSubscription>({ ...payload, user: userId }));
    return fromApiSubscription(row);
  },

  async update(sub: Subscription): Promise<Subscription> {
    const payload = toSubscriptionWritePayload(sub);
    if (isCloudflareRuntime) {
      const data = await apiFetch(`/api/app/subscriptions/${sub.id}`, subscriptionResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      return fromApiSubscription(data.subscription);
    }
    const row = await withPocketBaseAuthGuard(pb.collection("subscriptions").update<ApiSubscription>(sub.id, payload));
    return fromApiSubscription(row);
  },

  async delete(id: string): Promise<void> {
    if (isCloudflareRuntime) {
      await apiFetch(`/api/app/subscriptions/${id}`, subscriptionDeleteResponseSchema, { method: "DELETE" });
      return;
    }
    await withPocketBaseAuthGuard(pb.collection("subscriptions").delete(id));
  },
};
