/**
 * 轻量主题 Provider。
 *
 * 架构位置：统一管理 dark/light/system 解析和品牌 favicon 更新；设置页的“预览后保存”
 * 逻辑只调用这里，不直接操作 DOM class。
 *
 * 状态链路：
 *   初始 theme -> document class -> favicon
 *   setTheme -> state -> document class -> favicon
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { updateBrandFavicon } from "@/lib/brand-favicon";
import type { ThemeMode } from "@/types/theme";

interface SetThemeOptions {
  localOverride?: boolean;
}

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode, options?: SetThemeOptions) => void;
};

const STORAGE_KEY = "renewlet_theme_mode";
export const THEME_MODE_OVERRIDE_STORAGE_KEY = "renewlet_theme_mode_override";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(defaultTheme: ThemeMode): ThemeMode {
  if (typeof window === "undefined") return defaultTheme;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return defaultTheme;
}

function applyTheme(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldUseDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", shouldUseDark);
  updateBrandFavicon();
}

export function hasThemeModeOverride(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(THEME_MODE_OVERRIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearThemeModeOverride(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(THEME_MODE_OVERRIDE_STORAGE_KEY);
  } catch {
    // 清理失败只影响下次远端主题是否能覆盖；当前主题仍由内存状态控制。
  }
}

function writeThemeModeOverride(): void {
  try {
    window.localStorage.setItem(THEME_MODE_OVERRIDE_STORAGE_KEY, "1");
  } catch {
    // 存储失败时保留当前内存态即可；远端同步仍能在后续会话收敛。
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: React.ReactNode;
  attribute?: "class";
  defaultTheme?: ThemeMode;
  enableSystem?: boolean;
}) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readInitialTheme(defaultTheme));

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemeMode, options: SetThemeOptions = {}) => {
    if (options.localOverride !== false) writeThemeModeOverride();
    setThemeState(nextTheme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
