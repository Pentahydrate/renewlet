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

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

const STORAGE_KEY = "renewlet_theme_mode";
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

  const setTheme = useCallback((nextTheme: ThemeMode) => {
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
