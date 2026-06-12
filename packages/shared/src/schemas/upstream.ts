import { z } from "zod";

export const UPSTREAM_RAW_RESPONSE_TEXT_MAX_CHARS = 1 << 20;
export const UPSTREAM_RAW_RESPONSE_TEXT_CAPTURE_MAX_CHARS = 64 * 1024;

// 1MiB 是跨 Go/Worker/前端 schema 的硬上限；运行时默认只采集 64KiB，避免 Worker isolate 或 Go route 被错误页拖垮。
// 上游 raw response 只随当前失败响应回显给操作者；history/cache/lastError 只能保存短摘要。
export const upstreamErrorDetailsSchema = z.object({
  rawResponseText: z.string().max(UPSTREAM_RAW_RESPONSE_TEXT_MAX_CHARS),
}).strict();
export type UpstreamErrorDetails = z.infer<typeof upstreamErrorDetailsSchema>;
