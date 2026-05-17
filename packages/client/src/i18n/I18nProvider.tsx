/**
 * i18n Provider 与格式化能力聚合层。
 *
 * 架构位置：messages 只提供纯文案，settings 保存用户偏好，本文件负责把
 * 将 locale 同步到 DOM、API 错误语言、React Query 缓存和用户设置。
 *
 * 状态链路：
 *   初始 locale -> document/api/localStorage
 *   远端 settings.locale -> state
 *   用户预览 -> 仅更新 state
 *   用户保存 -> query cache + settings API
 *
 * 注意： 外观设置页会用 `persist=false` 做本地预览；不要把预览态提前写入远端。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setApiLocale } from "@/i18n/api-locale";
import { getInitialLocale, isLocale, localizedLabel, writeStoredLocale, type Locale, type LocalizedLabels } from "@/i18n/locales";
import { translate, type MessageKey } from "@/i18n/messages";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { getCurrentUserId } from "@/lib/pocketbase";
import { formatCurrency as formatCurrencyValue } from "@/lib/currency";
import { toPlainDate, type DateOnly } from "@/lib/time/date-only";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale, options?: { persist?: boolean; markAsSaved?: boolean }) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  formatDateOnly: (date: DateOnly | string, style?: "short" | "monthDay" | "full") => string;
  formatDateTime: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (amount: number, currency: string) => string;
  label: (labels: LocalizedLabels) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

/** 构建 Provider 外调用 `useI18n` 时的保守兜底，避免错误边界二次崩溃。 */
function createFallbackI18nValue(): I18nContextValue {
  const locale = getInitialLocale();
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
  return {
    locale,
    setLocale: () => undefined,
    t,
    formatDateOnly: (date, style = "short") => {
      const value = toPlainDate(date);
      const parts = {
        year: value.year,
        month: String(value.month).padStart(style === "full" && locale === "en-US" ? 2 : 1, "0"),
        day: String(value.day).padStart(style === "full" && locale === "en-US" ? 2 : 1, "0"),
      };
      if (style === "monthDay") return t("date.monthDay", parts);
      if (style === "full") return t("date.full", parts);
      return t("date.short", parts);
    },
    formatDateTime: (date, options) => {
      const valueDate = date instanceof Date ? date : new Date(date);
      if (Number.isNaN(valueDate.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, options).format(valueDate);
    },
    formatNumber: (valueNumber, options) => new Intl.NumberFormat(locale, options).format(valueNumber),
    formatCurrency: (amount, currency) => formatCurrencyValue(amount, currency, locale),
    label: (labelSet) => localizedLabel(labelSet, locale),
  };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());
  const hasLocalPreviewRef = useRef(false);
  const { data: settings } = useSettings();
  const { mutate: updateSettings } = useUpdateSettings();

  useEffect(() => {
    // 本地预览时只更新 DOM 语言，API/持久化语言仍保持上一次已保存值。
    applyDocumentLocale(locale);
    if (hasLocalPreviewRef.current) return;
    setApiLocale(locale);
    writeStoredLocale(locale);
  }, [locale]);

  useEffect(() => {
    // 远端设置是登录后真相来源，但不能覆盖用户正在预览的未保存语言。
    if (!settings?.locale || settings.locale === locale) return;
    if (hasLocalPreviewRef.current) return;
    setLocaleState(settings.locale);
  }, [locale, settings?.locale]);

  const setLocale = useCallback(
    (nextLocale: Locale, options: { persist?: boolean; markAsSaved?: boolean } = {}) => {
      if (!isLocale(nextLocale)) return;
      const shouldPersist = options.persist ?? true;
      setLocaleState(nextLocale);

      if (!shouldPersist) {
        // 设置页需要即时预览语言，同时等用户点击保存后再写 settings。
        hasLocalPreviewRef.current = !options.markAsSaved;
        if (options.markAsSaved) {
          setApiLocale(nextLocale);
          writeStoredLocale(nextLocale);
          applyDocumentLocale(nextLocale);
        }
        return;
      }

      hasLocalPreviewRef.current = false;
      queryClient.setQueryData(["settings"], (current: unknown) => {
        // 先更新缓存可以让 Settings 页和 Header 立即看到新语言，失败回滚交给保存流程处理。
        if (!current || typeof current !== "object") return current;
        return { ...current, locale: nextLocale };
      });

      if (getCurrentUserId()) {
        updateSettings({ locale: nextLocale });
      }
    },
    [queryClient, updateSettings],
  );

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

    return {
      locale,
      setLocale,
      t,
      formatDateOnly: (date, style = "short") => {
        const value = toPlainDate(date);
        const parts = {
          year: value.year,
          month: String(value.month).padStart(style === "full" && locale === "en-US" ? 2 : 1, "0"),
          day: String(value.day).padStart(style === "full" && locale === "en-US" ? 2 : 1, "0"),
        };
        if (style === "monthDay") return t("date.monthDay", parts);
        if (style === "full") return t("date.full", parts);
        return t("date.short", parts);
      },
      formatDateTime: (date, options) => {
        const valueDate = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(valueDate.getTime())) return String(date);
        return new Intl.DateTimeFormat(locale, options).format(valueDate);
      },
      formatNumber: (valueNumber, options) => new Intl.NumberFormat(locale, options).format(valueNumber),
      formatCurrency: (amount, currency) => formatCurrencyValue(amount, currency, locale),
      label: (labelSet) => localizedLabel(labelSet, locale),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    return createFallbackI18nValue();
  }
  return context;
}
