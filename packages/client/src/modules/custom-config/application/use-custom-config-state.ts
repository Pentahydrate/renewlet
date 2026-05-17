/**
 * Custom Config 数据 Provider 的 application hook。
 *
 * 架构位置：
 * - Context 只负责把这里的能力挂到 React 树。
 * - 这里统一处理远端 API、localStorage 兜底和防抖保存。
 * - 规范化规则来自 domain，避免把脏数据处理散落在 UI 组件中。
 *
 * 数据优先级：
 * ```
 * 首屏默认值 -> localStorage 兜底 -> 已登录远端配置覆盖 -> 用户编辑 -> localStorage + debounce API
 * ```
 *
 * 注意： PocketBase JSON 字段和 localStorage 都可能携带旧结构；进入状态前必须经过 domain normalize。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import { DEFAULT_CUSTOM_CONFIG, normalizePaymentMethods, type ConfigItem, type CustomConfig } from "@/types/config";
import { normalizeCustomConfig } from "../domain/normalize-custom-config";

/** localStorage 缓存 key（用于未登录场景/离线场景的兜底）。 */
const LOCAL_STORAGE_KEY = "renewlet_custom_config";

/**
 * 管理自定义配置的数据来源、缓存和远端防抖保存。
 *
 * 注意： 该 hook 允许未登录/离线时继续使用 localStorage 兜底。不要把 401 当作致命错误，
 * 否则登录页或 setup 前的组件树会被自定义配置查询拖垮。
 */
export function useCustomConfigState() {
  const [config, setConfig] = useState<CustomConfig>(DEFAULT_CUSTOM_CONFIG);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: remoteConfig } = useQuery<CustomConfig | null>({
    queryKey: ["custom-config"],
    queryFn: async () => {
      const userId = getCurrentUserId();
      if (!userId) return null;
      const rows = await pb.collection("custom_configs").getFullList<RecordModel>({
        filter: `user = "${userId}"`,
        perPage: 1,
      });
      // SDK 返回值不是运行时安全类型；normalize 会补齐内置项、剔除非法结构并保护默认货币范围。
      return rows[0] ? normalizeCustomConfig(rows[0]["config"]) : null;
    },
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async (nextConfig: CustomConfig) => {
      const userId = getCurrentUserId();
      if (!userId) return;
      const rows = await pb.collection("custom_configs").getFullList<RecordModel>({
        filter: `user = "${userId}"`,
        perPage: 1,
      });
      if (rows[0]) {
        // 每个用户只保留一条配置记录；schema/规则负责唯一性，hook 只做 upsert 编排。
        await pb.collection("custom_configs").update(rows[0].id, { config: nextConfig });
      } else {
        await pb.collection("custom_configs").create({ user: userId, config: nextConfig });
      }
    },
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        // localStorage 是离线兜底，不是可信存储；旧版本或用户手改都必须被 normalize 后再进入 Context。
        setConfig(normalizeCustomConfig(JSON.parse(saved)));
      }
    } catch (e) {
      console.error("Failed to load custom config:", e);
    }
  }, []);

  useEffect(() => {
    if (!remoteConfig) return;
    setConfig(remoteConfig);
  }, [remoteConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.error("Failed to save custom config:", e);
    }
  }, [config]);

  const scheduleRemoteSave = useCallback(
    (nextConfig: CustomConfig) => {
      // 拖拽排序会产生高频更新，防抖能显著减少 SQLite 写入和 API 抖动。
      // PERF： 配置项大量增长时，可改成“保存按钮”或批量 patch 协议。
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveMutation.mutate(nextConfig);
      }, 500);
    },
    [saveMutation],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const updateConfig = useCallback(
    (updater: (prev: CustomConfig) => CustomConfig) => {
      setConfig((prev) => {
        const next = updater(prev);
        scheduleRemoteSave(next);
        return next;
      });
    },
    [scheduleRemoteSave],
  );

  const updateCategories = useCallback(
    (items: ConfigItem[]) => {
      updateConfig((prev) => ({ ...prev, categories: items }));
    },
    [updateConfig],
  );

  const updateStatuses = useCallback(
    (items: ConfigItem[]) => {
      updateConfig((prev) => ({ ...prev, statuses: items }));
    },
    [updateConfig],
  );

  const updatePaymentMethods = useCallback(
    (items: ConfigItem[]) => {
      updateConfig((prev) => ({ ...prev, paymentMethods: normalizePaymentMethods(items) }));
    },
    [updateConfig],
  );

  const updateCurrencies = useCallback(
    (items: ConfigItem[]) => {
      updateConfig((prev) => ({ ...prev, currencies: items }));
    },
    [updateConfig],
  );

  const saveConfig = useCallback(
    async (nextConfig: CustomConfig) => {
      const normalized = normalizeCustomConfig(nextConfig);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await saveMutation.mutateAsync(normalized);
      setConfig(normalized);
      return normalized;
    },
    [saveMutation],
  );

  return {
    config,
    updateCategories,
    updateStatuses,
    updatePaymentMethods,
    updateCurrencies,
    saveConfig,
  };
}
