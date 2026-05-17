/**
 * locale 基础规则。
 *
 * 架构位置：集中定义支持语言、浏览器探测、localStorage 兜底和双语 label 读取，
 * Provider 与后端 locale 解析需要保持同一支持集合。
 *
 * 注意： 新增语言时必须同步 messages 分片、Go locale 支持和 Accept-Language 解析测试。
 */
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type LocalizedLabels = Record<Locale, string>;

const STORAGE_KEY = "renewlet_locale";

export const DEFAULT_LOCALE: Locale = "zh-CN";

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

export function normalizeLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en-US";
  return DEFAULT_LOCALE;
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const language of languages) {
    if (language?.toLowerCase().startsWith("zh")) return "zh-CN";
    if (language?.toLowerCase().startsWith("en")) return "en-US";
  }
  return "en-US";
}

export function readStoredLocale(): Locale | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 忽略存储失败；本次会话以内存中的 Provider 状态为准。
  }
}

export function getInitialLocale(): Locale {
  return readStoredLocale() ?? detectBrowserLocale();
}

export function labels(zhCN: string, enUS: string): LocalizedLabels {
  return { "zh-CN": zhCN, "en-US": enUS };
}

export function localizedLabel(source: LocalizedLabels, locale: Locale): string {
  const value = source[locale];
  if (!value) {
    throw new Error(`Missing localized label for ${locale}`);
  }
  return value;
}
