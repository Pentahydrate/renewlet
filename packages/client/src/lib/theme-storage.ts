/**
 * 主题设置的 localStorage 缓存（用于首屏快速恢复外观，减少“等待网络导致的闪动”）。
 *
 * 说明：
 * - 数据库是“最终真相”（落库后的跨设备一致性）
 * - localStorage 是“首屏缓存”（不依赖网络即可先恢复上次外观）
 *
 * 状态关系：
 * ```
 * 用户即时预览 -> localStorage + pending=1
 * 保存设置成功 -> pending 清除 -> 数据库成为跨设备来源
 * ```
 *
 * 注意： 所有读取函数都必须容错，localStorage 可能不可用或被用户手动写入脏数据。
 */

import {
  DEFAULT_CUSTOM_THEME_COLOR,
  THEME_VARIANTS,
  type CustomThemeColor,
  type ThemeVariant,
} from "@/types/theme";

/** 主题风格缓存 key。 */
export const THEME_VARIANT_STORAGE_KEY = "renewlet_theme_variant";
/** 自定义主题色缓存 key。 */
export const CUSTOM_COLOR_STORAGE_KEY = "renewlet_custom_theme_color";
/** 外观存在未保存改动的标记 key。 */
export const APPEARANCE_PENDING_STORAGE_KEY = "renewlet_appearance_pending";

/** 判断未知值是否为受支持主题风格。 */
export function isThemeVariant(value: unknown): value is ThemeVariant {
  return typeof value === "string" && (THEME_VARIANTS as readonly string[]).includes(value);
}

/** 判断未知值是否为合法 HSL 自定义主题色。 */
export function isCustomThemeColor(value: unknown): value is CustomThemeColor {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const h = record["h"];
  const s = record["s"];
  const l = record["l"];
  return (
    typeof h === "number" &&
    typeof s === "number" &&
    typeof l === "number" &&
    h >= 0 &&
    h <= 360 &&
    s >= 0 &&
    s <= 100 &&
    l >= 0 &&
    l <= 100
  );
}

/** 读取主题风格（无值或非法则返回 null）。 */
export function readThemeVariantFromStorage(): ThemeVariant | null {
  try {
    const raw = localStorage.getItem(THEME_VARIANT_STORAGE_KEY);
    if (!raw) return null;
    return isThemeVariant(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 读取自定义主题色（无值或非法则回退到默认值）。 */
export function readCustomThemeColorFromStorage(): CustomThemeColor {
  try {
    const raw = localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY);
    if (!raw) return DEFAULT_CUSTOM_THEME_COLOR;
    const parsed = JSON.parse(raw) as unknown;
    return isCustomThemeColor(parsed) ? parsed : DEFAULT_CUSTOM_THEME_COLOR;
  } catch {
    return DEFAULT_CUSTOM_THEME_COLOR;
  }
}

/**
 * 读取自定义主题色（无值或非法则返回 null）。
 *
 * 用途：
 * - 当需要“本地优先，但本地未设置时回退到数据库”的逻辑时，用该方法判断本地是否真的有值
 */
export function readCustomThemeColorFromStorageOrNull(): CustomThemeColor | null {
  try {
    const raw = localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isCustomThemeColor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 写入主题风格缓存（失败则静默忽略）。 */
export function writeThemeVariantToStorage(variant: ThemeVariant): void {
  try {
    localStorage.setItem(THEME_VARIANT_STORAGE_KEY, variant);
  } catch {
    // 存储失败时保留内存态即可；不要因为隐私模式阻断主题切换。
  }
}

/** 写入自定义主题色缓存（失败则静默忽略）。 */
export function writeCustomThemeColorToStorage(color: CustomThemeColor): void {
  try {
    localStorage.setItem(CUSTOM_COLOR_STORAGE_KEY, JSON.stringify(color));
  } catch {
    // 存储失败时保留内存态即可；不要因为隐私模式阻断主题切换。
  }
}

/** 读取“外观是否有未保存改动”标记。 */
export function readAppearancePendingFromStorage(): boolean {
  try {
    return localStorage.getItem(APPEARANCE_PENDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 写入“外观是否有未保存改动”标记。
 *
 * 说明：
 * - 当用户在本地切换明暗/主题色但未点击“保存所有设置”时，标记为 pending
 * - pending=true：登录后不使用数据库覆盖本地外观（避免冲掉未保存改动）
 * - pending=false：登录后以数据库为准（用于跨设备同步已保存的外观）
 */
export function writeAppearancePendingToStorage(pending: boolean): void {
  try {
    if (pending) {
      localStorage.setItem(APPEARANCE_PENDING_STORAGE_KEY, "1");
      return;
    }
    localStorage.removeItem(APPEARANCE_PENDING_STORAGE_KEY);
  } catch {
    // 存储失败时保留内存态即可；下次启动按远端设置重新收敛。
  }
}
