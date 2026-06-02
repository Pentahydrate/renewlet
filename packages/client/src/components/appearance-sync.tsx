/**
 * 外观设置同步（客户端）。
 *
 * 目标：
 * - 首屏优先使用本地 localStorage 的外观设置（不点“保存所有设置”也能生效）
 * - 登录后：
 *   - 若 Settings 页存在“未保存外观草稿”标记：不使用数据库覆盖（避免冲掉设置页预览）
 *   - 否则以数据库为准（用于跨设备同步已保存的外观）
 *
 * 同时兼容：
 * - 未登录：只使用本地 localStorage（避免“退出后主题被重置”的体验）
 * - 已登录：按上述规则同步，并回写 localStorage 作为下次首屏缓存
 *
 * 注意： Settings 页的外观字段可以未保存但即时预览。Settings pending 标记存在时，
 * 这里不能用数据库覆盖本地主题，否则用户会看到刚选的主题被同步逻辑回滚。
 */

import { useEffect, useState } from "react";
import { hasThemeModeOverride, useTheme } from '@/lib/theme-provider';
import { useSettings } from "@/hooks/use-settings";
import { applyThemeVariant } from "@/lib/theme-variant";
import {
  readAppearancePendingFromStorage,
  readCustomThemeColorFromStorage,
  readThemeVariantFromStorage,
  writeCustomThemeColorToStorage,
  writeThemeVariantToStorage,
} from "@/lib/theme-storage";
import { authClient } from "@/lib/auth-client";

/** 外观同步组件：放在 Providers 内即可。 */
export function AppearanceSync() {
  const { setTheme } = useTheme();
  const { data: settings } = useSettings();
  const { data: sessionData } = authClient.useSession();
  const hasSession = Boolean(sessionData?.session);

  // 1) 首屏：优先读取 localStorage（避免等待网络导致主题闪动）。
  useEffect(() => {
    const storedVariant = readThemeVariantFromStorage();
    if (!storedVariant) return;
    const storedColor = readCustomThemeColorFromStorage();
    applyThemeVariant(storedVariant, storedColor);
  }, []);

  // 2) 登录后：Settings 有未保存外观草稿则不覆盖；否则以数据库为准，并回写 localStorage 作为下次首屏缓存。
  useEffect(() => {
    if (!hasSession || !settings) return;
    if (readAppearancePendingFromStorage()) return;

    if (!hasThemeModeOverride()) {
      setTheme(settings.themeMode, { localOverride: false });
    }
    applyThemeVariant(settings.themeVariant, settings.themeCustomColor);

    writeThemeVariantToStorage(settings.themeVariant);
    writeCustomThemeColorToStorage(settings.themeCustomColor);
  }, [hasSession, setTheme, settings]);

  return null;
}
