/**
 * 通知 API 的输入契约。
 *
 * 架构位置：
 * - `/api/app/notifications/test` 用于单通道连通性验证。
 * - `/api/app/notifications/run` 用于当前用户手动触发到期提醒。
 * - `/api/app/notifications/history` 返回调度预览、最近任务和分页历史。
 *
 * 响应流转：
 * ```mermaid
 * flowchart LR
 *   A[settings + subscriptions] --> B[后端计算 nextCheck/upcoming]
 *   B --> C[notification_jobs result]
 *   C --> D[严格解析为 cron result 或空对象]
 *   D --> E[前端 history panel 按 discriminated union 展示]
 * ```
 *
 * 注意： `settings` 是临时覆盖，不应被 route 持久化；保存设置只写 PocketBase settings collection。
 * 注意： `sent` 是手动运行响应的判别字段，新增返回形态时必须先扩展 union，再改调用方分支。
 */
import { z } from "zod";
import {
  NOTIFICATION_CHANNELS,
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  SUBSCRIPTION_STATUSES,
} from "@/types/subscription";
import { settingsUpdateBodySchema } from "@/lib/api/schemas/settings";
import { okResponseSchema } from "@/lib/api/schemas/common";
import { isValidDateOnly, type DateOnly } from "@/lib/time/date-only";
import { isValidLocalTime, type LocalTime } from "@/lib/time/local-time";

/**
 * 通知相关 API 的输入校验（Zod）。
 *
 * 说明：
 * - 通知配置来自 Settings 页（AppSettings）
 * - “测试通知”场景需要允许前端传入未保存的临时配置，因此这里支持 `settings` 覆盖字段
 */

/** 通知渠道白名单，防止客户端传入未注册 handler 的任意字符串。 */
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

/** POST `/api/app/notifications/test`：发送指定渠道的测试消息。 */
export const notificationsTestBodySchema = z
  .object({
    channel: notificationChannelSchema.describe("要测试的通知渠道。"),
    settings: settingsUpdateBodySchema.optional().describe("可选：临时覆盖的设置（不落库）。"),
  })
  .strict();

/** POST `/api/app/notifications/run`：手动触发一次通知发送（用于排查/调试）。 */
export const notificationsRunBodySchema = z
  .object({
    /** 是否强制发送（忽略“是否有到期订阅”）。 */
    force: z.boolean().optional().describe("强制发送（即使没有到期/试用结束）。"),
    settings: settingsUpdateBodySchema.optional().describe("可选：临时覆盖的设置（不落库）。"),
  })
  .strict();

const dateOnlyResponseSchema = z
  .string()
  .refine(isValidDateOnly, "Invalid date")
  .transform((value) => value as DateOnly);

const localTimeResponseSchema = z
  .string()
  .refine(isValidLocalTime, "Invalid local time")
  .transform((value) => value as LocalTime);

export const localScheduleOccurrenceResponseSchema = z.object({
  scheduledLocalDate: dateOnlyResponseSchema,
  scheduledLocalTime: localTimeResponseSchema,
  timeZone: z.string().min(1),
  scheduledInstantUtc: z.string().min(1),
}).strict();

export const notificationContentItemResponseSchema = z.object({
  type: z.enum(["renewal", "trial", "expired"]),
  subscriptionId: z.string(),
  name: z.string(),
  price: z.number(),
  currency: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  targetDate: dateOnlyResponseSchema,
  reminderDays: z.number().int().nonnegative(),
  daysUntil: z.number().int(),
  repeatReminder: z.object({
    interval: z.enum(REPEAT_REMINDER_INTERVALS),
    window: z.enum(REPEAT_REMINDER_WINDOWS),
  }).strict().optional(),
}).strict();

export const upcomingNotificationBatchResponseSchema = localScheduleOccurrenceResponseSchema.extend({
  items: z.array(notificationContentItemResponseSchema),
}).strict();

export const channelFailureResponseSchema = z.object({
  channel: notificationChannelSchema,
  error: z.string(),
}).strict();

export const jobChannelsResponseSchema = z.object({
  attempted: z.array(notificationChannelSchema),
  succeeded: z.array(notificationChannelSchema),
  failed: z.array(channelFailureResponseSchema),
}).strict();

export const cronJobResultResponseSchema = z.object({
  source: z.literal("cron"),
  reason: z.string().nullable(),
  force: z.boolean(),
  windowMinutes: z.number().int().nonnegative(),
  triggeredAtUtc: z.string(),
  schedule: localScheduleOccurrenceResponseSchema,
  settings: z.object({
    timezone: z.string(),
    locale: z.string(),
    notificationTimeLocal: localTimeResponseSchema,
    enabledChannels: z.array(notificationChannelSchema),
    showExpired: z.boolean(),
  }).strict(),
  message: z.object({
    title: z.string(),
    content: z.string(),
    timestamp: z.string(),
    hasPayload: z.boolean(),
    items: z.array(notificationContentItemResponseSchema),
  }).strict(),
  channels: jobChannelsResponseSchema,
}).strict();

export const emptyJobResultResponseSchema = z.object({}).strict();

export const notificationJobResultResponseSchema = z.union([
  cronJobResultResponseSchema,
  emptyJobResultResponseSchema,
]);

export const notificationHistoryStatusSchema = z.enum(["all", "sent", "failed", "skipped", "sending"]);
export const notificationJobStatusSchema = z.enum(["pending", "sending", "sent", "failed", "skipped"]);

export const notificationHistoryJobResponseSchema = z.object({
  id: z.string(),
  scheduledLocalDate: dateOnlyResponseSchema,
  scheduledLocalTime: localTimeResponseSchema,
  timeZone: z.string(),
  scheduledInstantUtc: z.string(),
  status: notificationJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  result: notificationJobResultResponseSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const notificationHistoryResponseSchema = z.object({
  summary: z.object({
    nextCheck: localScheduleOccurrenceResponseSchema,
    nextContentBatch: upcomingNotificationBatchResponseSchema.nullable(),
    blockers: z.array(z.string()),
    enabledChannels: z.array(notificationChannelSchema),
    upcomingDays: z.number().int().nonnegative(),
    latestJob: notificationHistoryJobResponseSchema.nullable(),
    latestFailedJob: notificationHistoryJobResponseSchema.nullable(),
  }).strict(),
  upcoming: z.array(upcomingNotificationBatchResponseSchema),
  history: z.object({
    jobs: z.array(notificationHistoryJobResponseSchema),
    status: notificationHistoryStatusSchema,
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }).strict(),
}).strict();

export const notificationsTestResponseSchema = okResponseSchema;

export const notificationRunSkippedResponseSchema = z.object({
  ok: z.literal(true),
  sent: z.literal(false),
  reason: z.literal("no_due_items"),
}).strict();

export const notificationRunSentResponseSchema = z.object({
  ok: z.literal(true),
  sent: z.literal(true),
  summary: jobChannelsResponseSchema,
}).strict();

export const notificationRunResponseSchema = z.discriminatedUnion("sent", [
  notificationRunSkippedResponseSchema,
  notificationRunSentResponseSchema,
]);

export type NotificationHistoryStatusFilter = z.infer<typeof notificationHistoryStatusSchema>;
export type NotificationHistoryJob = z.infer<typeof notificationHistoryJobResponseSchema>;
export type UpcomingNotificationBatch = z.infer<typeof upcomingNotificationBatchResponseSchema>;
export type NotificationHistoryResponse = z.infer<typeof notificationHistoryResponseSchema>;
export type NotificationJobResult = z.infer<typeof notificationJobResultResponseSchema>;
