/**
 * 订阅相关 React Query Hooks（前端数据层）。
 *
 * 说明：
 * - 通过 PocketBase collection 读写当前用户订阅数据
 * - PocketBase SDK 返回的是 RecordModel，前端在 hook 边界统一 normalize + Zod parse
 * - API 返回 date-only 字符串（YYYY-MM-DD），前端在这里统一转成品牌类型
 *
 * 注意： Date 转换只发生在 hook 边界。页面/组件内部应使用 `Subscription` domain 类型，
 * 不要直接消费 API row，避免日期处理散落。
 * 注意： `billingCycle=custom` 与 `customDays` 的判别关系在这里落入 domain union；
 * 修改该转换会影响统计折算、表单回填和通知提醒。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assertDateOnly } from "@/lib/time/date-only";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import { apiSubscriptionSchema, type ApiSubscription } from "@/lib/api/schemas/subscriptions";
import {
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type Subscription,
  type SubscriptionDraft,
} from "@/types/subscription";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
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
    reminderDays: row["reminderDays"],
    repeatReminderEnabled: row["repeatReminderEnabled"] === true,
    repeatReminderInterval: normalizeRepeatReminderInterval(row["repeatReminderInterval"]),
    repeatReminderWindow: normalizeRepeatReminderWindow(row["repeatReminderWindow"]),
  };
  // PocketBase 会把系统字段命名为 created/updated，而前端 schema 使用 createdAt/updatedAt。
  // 在唯一边界做映射，可以让组件和 domain 函数完全不感知 SDK 的字段差异。
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

  return normalized;
}

/** 将 API 返回的订阅对象转换为前端 domain 订阅对象（含 Date 类型字段）。 */
function fromApiSubscription(row: ApiSubscription | RecordModel): Subscription {
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
    trialEndDate: parsedRow.trialEndDate ? assertDateOnly(parsedRow.trialEndDate) : undefined,
    website: parsedRow.website,
    notes: parsedRow.notes,
    tags: parsedRow.tags ?? [],
    reminderDays: parsedRow.reminderDays,
    repeatReminderEnabled: parsedRow.repeatReminderEnabled,
    repeatReminderInterval: parsedRow.repeatReminderInterval,
    repeatReminderWindow: parsedRow.repeatReminderWindow,
  };
  if (parsedRow.billingCycle === "custom") {
    // 判别联合要求 custom 周期一定有 customDays。历史数据缺失时给出最小安全值，
    // 防止下游 `toMonthlyAmount`/nextBillingDate 计算遇到 undefined。
    return {
      ...base,
      billingCycle: "custom",
      customDays: parsedRow.customDays ?? 1,
    };
  }
  return {
    ...base,
    billingCycle: parsedRow.billingCycle,
    // 非 custom 周期主动清空 customDays，避免历史脏数据影响统计换算。
    customDays: undefined,
  };
}

/**
 * 将订阅转换为 API 写入请求体（用于创建/更新；date 字段转为 YYYY-MM-DD）。
 *
 * 说明：
 * - create/update 的字段结构一致（差别仅在 URL 与是否包含 id），因此统一到一个函数避免重复维护
 * - 可选字段统一转为 null，便于后端用同一套 schema 校验与 merge 策略
 */
function toWritePayload(sub: SubscriptionDraft | Subscription) {
  // 后端 schema 接受 null 表达“清空可选字段”；undefined 则容易在 JSON 序列化后丢失语义。
  return {
    name: sub.name,
    logo: sub.logo ?? null,
    price: sub.price,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    customDays: sub.customDays ?? null,
    category: sub.category,
    status: sub.status,
    paymentMethod: sub.paymentMethod ?? null,
    startDate: sub.startDate,
    nextBillingDate: sub.nextBillingDate,
    autoCalculateNextBillingDate: sub.autoCalculateNextBillingDate,
    trialEndDate: sub.trialEndDate ?? null,
    website: sub.website ?? null,
    notes: sub.notes ?? null,
    tags: sub.tags ?? [],
    reminderDays: sub.reminderDays,
    repeatReminderEnabled: sub.repeatReminderEnabled,
    repeatReminderInterval: sub.repeatReminderInterval,
    repeatReminderWindow: sub.repeatReminderWindow,
  };
}

/** 获取订阅列表（未登录时返回空数组）。 */
export function useSubscriptions() {
  return useQuery({
    queryKey: ["subscriptions"],
    queryFn: async () => {
      const userId = getCurrentUserId();
      if (!userId) return [];
      const rows = await pb.collection("subscriptions").getFullList<ApiSubscription>({
        filter: `user = "${userId}"`,
        sort: "-created",
      });
      // SDK 泛型只是编译期提示，运行时仍可能拿到旧字段/脏字段；进入缓存前必须 parse。
      return rows.map(fromApiSubscription);
    },
  });
}

/** 创建订阅（成功后自动刷新订阅列表）。 */
export function useCreateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sub: SubscriptionDraft) => {
      const userId = getCurrentUserId();
      if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));
      const row = await pb.collection("subscriptions").create<ApiSubscription>({
        ...toWritePayload(sub),
        user: userId,
      });
      return fromApiSubscription(row);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}

/** 更新订阅（成功后自动刷新订阅列表）。 */
export function useUpdateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sub: Subscription) => {
      const row = await pb.collection("subscriptions").update<ApiSubscription>(sub.id, toWritePayload(sub));
      return fromApiSubscription(row);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}

/** 删除订阅（成功后自动刷新订阅列表）。 */
export function useDeleteSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await pb.collection("subscriptions").delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}
