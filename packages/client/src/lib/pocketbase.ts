/**
 * SDK 单例与认证 header 适配层（PocketBase）。
 *
 * 架构位置：所有前端数据层 hook 都共享同一个 `pb` 实例，确保 authStore、
 * realtime/cancel 行为和 API base URL 一致。这里不做业务 schema 解析，解析应放在
 * `lib/api/schemas/*` 或具体 hook 边界。
 *
 * 注意： `autoCancellation(false)` 是为了让 React Query/并发上传自己管理竞态；
 * 打开 SDK 自动取消会让相同 collection 的并行请求互相中断。
 */
import PocketBase, { ClientResponseError, type RecordModel } from "pocketbase";

const configuredBaseUrl: unknown = import.meta.env["VITE_POCKETBASE_URL"];
const baseUrl = typeof configuredBaseUrl === "string" && configuredBaseUrl
  ? configuredBaseUrl
  : window.location.origin;

export const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

export { ClientResponseError };
export type { RecordModel };

/** 返回当前登录用户 id；未登录或 authStore 尚未恢复时返回 null。 */
export function getCurrentUserId(): string | null {
  const id = pb.authStore.record?.id;
  return typeof id === "string" && id ? id : null;
}

/** 为自定义 fetch API 生成 PocketBase Bearer header。 */
export function getAuthHeader(): Record<string, string> {
  return pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {};
}
