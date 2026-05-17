/**
 * 管理员用户 API 的 Zod 契约。
 *
 * 架构位置：
 * - `/admin/users` 页面通过这些 schema 读取用户列表并执行创建、封禁、角色调整、密码重置。
 * - 后端负责最终授权和“最后一个可用管理员”保护，前端 schema 负责拒绝响应漂移。
 *
 * 注意： `role` 是权限边界，不要把它扩成普通字符串；新增角色必须同步后端枚举、UI 权限判断和 E2E 断言。
 */
import { z } from "zod";
import { okResponseSchema } from "@/lib/api/schemas/common";

export const userRoleSchema = z.enum(["user", "admin"]);

export const adminUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  banned: z.boolean(),
  banReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
}).strict();

export const adminUserResponseSchema = z.object({
  user: adminUserSchema,
}).strict();

export const adminPatchUserResponseSchema = okResponseSchema;
export const adminDeleteUserResponseSchema = okResponseSchema;

export type UserRole = z.infer<typeof userRoleSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;
