/**
 * 应用级公共 API 的响应契约。
 *
 * 架构位置：
 * - 登录前页面、setup 流程、healthcheck 和密码重置入口都会直接消费这些响应。
 * - 这些接口通常发生在用户尚未完成认证时，因此必须依赖 schema 而不是 domain hook 兜底。
 *
 * 注意： setup/password reset 状态会影响路由可达性；字段缺失或未知字段都应该尽早失败，避免前端误开放敏感入口。
 */
import { z } from "zod";
import { okResponseSchema } from "@/lib/api/schemas/common";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  time: z.string().min(1),
}).strict();

export const setupStatusResponseSchema = z.object({
  setupRequired: z.boolean(),
  setupEnabled: z.boolean(),
}).strict();

export const setupCreateResponseSchema = okResponseSchema;

export const passwordResetStatusResponseSchema = z.object({
  enabled: z.boolean(),
}).strict();

export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
export type PasswordResetStatusResponse = z.infer<typeof passwordResetStatusResponseSchema>;
