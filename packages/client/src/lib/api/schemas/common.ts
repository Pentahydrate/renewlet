/**
 * 通用 API 响应契约。
 *
 * 架构位置：
 * - 被 setup、admin、notification test 等“只需要确认成功”的 route 复用。
 * - `.strict()` 用于把 `{ ok: true }` 固定成真正的成功信号，避免调用方把带错误字段的混合响应误判为成功。
 *
 * 注意： 如果后端需要返回额外字段，应新增专用 schema，而不是扩宽这里的公共 ok 契约。
 */
import { z } from "zod";

export const okResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export type OkResponse = z.infer<typeof okResponseSchema>;
