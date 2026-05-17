/**
 * 账号安全 API 的 Zod 契约。
 *
 * 架构位置：
 * - PocketBase 负责认证内部规则。
 * - 本层先做产品侧输入边界控制，避免把明显非法数据传入认证适配器。
 *
 * 注意： 密码字段属于敏感数据，新增调试日志时不要输出 schema parse 的原始 body。
 */
import { z } from "zod";

/** PUT `/api/app/account/password` 请求体：修改/重置密码。 */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    /**
     * 新密码。
     *
     * 说明：
     * - 这里只做基础长度校验；更复杂的规则可以后续接入密码策略组件
     * - 上限 72 是为了兼容常见 bcrypt/服务端限制（不同提供商可能不同）
     */
    newPassword: z.string().min(8).max(72),
  })
  .strict();

/** PocketBase password reset 请求体：申请邮件重置密码。 */
export const requestPasswordResetBodySchema = z
  .object({
    email: z.email().max(254),
  })
  .strict();

/** PocketBase 密码重置确认请求体。 */
export const confirmPasswordResetBodySchema = z
  .object({
    token: z.string().trim().min(1).max(256),
    newPassword: z.string().min(8).max(72),
  })
  .strict();
