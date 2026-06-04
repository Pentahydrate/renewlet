import { apiFetch } from "@/lib/api-client";
import { withPocketBaseAuthGuard } from "@/lib/auth-session";
import { customConfigResponseSchema } from "@/lib/api/schemas/custom-config";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import { DEFAULT_CUSTOM_CONFIG, type CustomConfig } from "@/types/config";
import { normalizeCustomConfig } from "@/modules/custom-config/domain/normalize-custom-config";
import { isCloudflareRuntime } from "./runtime";

/** 用户自定义分类/状态/支付方式服务；持久化前后都走 domain normalize，避免运行面漂移。 */
export const customConfigService = {
  async get(): Promise<CustomConfig | null> {
    const userId = getCurrentUserId();
    if (!userId) return null;
    if (isCloudflareRuntime) {
      // Worker 返回 raw config，前端仍走 domain normalize，保持 PocketBase/localStorage 旧结构兜底一致。
      const data = await apiFetch("/api/app/custom-config", customConfigResponseSchema);
      return normalizeCustomConfig(data.config);
    }
    const rows = await withPocketBaseAuthGuard(pb.collection("custom_configs").getFullList<RecordModel>({
      filter: `user = "${userId}"`,
      perPage: 1,
    }));
    return rows[0] ? normalizeCustomConfig(rows[0]["config"]) : null;
  },

  async save(nextConfig: CustomConfig): Promise<CustomConfig> {
    const userId = getCurrentUserId();
    if (!userId) return nextConfig;
    const normalized = normalizeCustomConfig(nextConfig ?? DEFAULT_CUSTOM_CONFIG);
    if (isCloudflareRuntime) {
      // 保存前先归一化，避免不同运行面把 UI 临时字段写成持久契约。
      const data = await apiFetch("/api/app/custom-config", customConfigResponseSchema, {
        method: "PUT",
        body: JSON.stringify({ config: normalized }),
      });
      return normalizeCustomConfig(data.config);
    }
    const rows = await withPocketBaseAuthGuard(pb.collection("custom_configs").getFullList<RecordModel>({
      filter: `user = "${userId}"`,
      perPage: 1,
    }));
    if (rows[0]) {
      await withPocketBaseAuthGuard(pb.collection("custom_configs").update(rows[0].id, { config: normalized }));
    } else {
      await withPocketBaseAuthGuard(pb.collection("custom_configs").create({ user: userId, config: normalized }));
    }
    return normalized;
  },
};
