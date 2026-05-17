/**
 * 可搜索下拉选项构建工具。
 *
 * 架构位置：
 * - Settings/订阅表单中的货币、时区等下拉共用这里的关键词和排序策略。
 * - UI 组件只负责展示和交互，不复制搜索算法。
 *
 * 注意： 搜索评分需要稳定，改动会直接影响用户输入时的选项排序。
 */
import { formatTimeZoneOffset } from "@/lib/time/time-zone";
import type { ConfigItem } from "@/types/config";
import type { CurrencyOption, CurrencyRegion } from "@/types/subscription";
import { localizedLabel, type Locale } from "@/i18n/locales";

/** 可搜索 Select/Command 组件使用的通用选项结构。 */
export interface SearchableSelectOption {
  value: string;
  label: string;
  keywords?: string[];
  disabled?: boolean;
}

const CURRENCY_REGION_KEYWORDS: Record<CurrencyRegion, string[]> = {
  asia: ["亚洲", "asia"],
  europe: ["欧洲", "europe"],
  americas: ["美洲", "america", "americas", "north america", "south america"],
  oceania: ["大洋洲", "oceania"],
  africa: ["非洲", "africa"],
  global: ["全球", "global", "currency"],
};

/** 归一化搜索文本，去掉重音并统一小写，提升跨语言搜索命中率。 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function compactSearchText(input: string): string {
  // 紧凑匹配会移除空白、分隔符和常见货币符号，让 `US D`、`USD`、`$` 类输入尽量落到同一搜索口径。
  return normalizeSearchText(input).replace(/[\s/_().,$￥¥€£₩₹₺₪฿₱]+/g, "");
}

/**
 * 对候选文本计算搜索匹配分数。
 *
 * 评分保留前缀、包含、多词包含；较长 query 才使用子序列兜底，避免短代码误命中。
 */
export function rankSearchText(values: readonly string[], search: string): number {
  const normalizedSearch = normalizeSearchText(search);
  if (!normalizedSearch) return 1;

  const compactSearch = compactSearchText(normalizedSearch);
  const hasCompactSearch = compactSearch.length > 0;
  // 短 query 使用子序列会误命中太多三字母货币代码，因此只给较长输入兜底。
  const canUseSubsequenceFallback = hasCompactSearch && shouldUseSubsequenceFallback(compactSearch);
  const searchParts = normalizedSearch.split(/\s+/).filter(Boolean);

  let best = 0;
  for (const raw of values) {
    const value = normalizeSearchText(raw);
    const compactValue = compactSearchText(raw);
    if (!value && !compactValue) continue;

    if (value === normalizedSearch || (hasCompactSearch && compactValue === compactSearch)) best = Math.max(best, 1);
    else if (value.startsWith(normalizedSearch) || (hasCompactSearch && compactValue.startsWith(compactSearch))) best = Math.max(best, 0.9);
    else if (value.includes(normalizedSearch) || (hasCompactSearch && compactValue.includes(compactSearch))) best = Math.max(best, 0.7);
    else if (searchParts.length > 1 && searchParts.every((part) => value.includes(part))) best = Math.max(best, 0.55);
    else if (canUseSubsequenceFallback && isSubsequence(compactSearch, compactValue)) best = Math.max(best, 0.35);
  }

  return best;
}

function shouldUseSubsequenceFallback(compactSearch: string): boolean {
  return compactSearch.length >= 4;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function uniq(values: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = value?.trim();
    if (!next) continue;
    const key = normalizeSearchText(next);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function extractCurrencySymbol(label: string): string | undefined {
  // 内置货币 label 采用 `名称 (符号)` 形式；只读取括号内容，避免把多语言名称当作符号。
  return /\(([^)]+)\)/.exec(label)?.[1]?.trim();
}

function getIntlCurrencyName(currency: string, locale: string): string | undefined {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "currency" });
    return displayNames.of(currency);
  } catch {
    return undefined;
  }
}

function getIntlCurrencySymbol(currency: string, locale: string): string | undefined {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value;
  } catch {
    return undefined;
  }
}

/** 为货币生成多语言/符号/区域关键词，支持 CNY、人民币、¥ 等搜索方式。 */
export function createCurrencyKeywords(
  currency: Pick<CurrencyOption, "value" | "labels" | "region">,
): string[] {
  const zhLabel = localizedLabel(currency.labels, "zh-CN");
  const enLabel = localizedLabel(currency.labels, "en-US");
  const symbol = extractCurrencySymbol(zhLabel) ?? extractCurrencySymbol(enLabel);
  return uniq([
    currency.value,
    currency.value.toLowerCase(),
    zhLabel,
    enLabel,
    symbol,
    getIntlCurrencySymbol(currency.value, "zh-CN"),
    getIntlCurrencySymbol(currency.value, "en-US"),
    getIntlCurrencyName(currency.value, "zh-CN"),
    getIntlCurrencyName(currency.value, "en-US"),
    ...CURRENCY_REGION_KEYWORDS[currency.region],
  ]);
}

/**
 * 创建货币下拉选项。
 *
 * 注意： 当前值即使被禁用也要保留为 disabled 选项，否则编辑旧订阅时会丢失显示上下文。
 */
export function createCurrencySelectOptions(params: {
  currencies: readonly ConfigItem[];
  currencyOptions: readonly CurrencyOption[];
  includeDisabledCurrent?: string;
  locale?: Locale;
  formatLabel?: (item: ConfigItem, option: CurrencyOption | undefined, locale: Locale) => string;
}): SearchableSelectOption[] {
  const locale = params.locale ?? "zh-CN";
  const optionByValue = new Map(params.currencyOptions.map((option) => [option.value, option]));
  const enabled = params.currencies.filter((currency) => currency.enabled !== false);
  const selected = params.includeDisabledCurrent
    ? params.currencies.find((currency) => currency.value === params.includeDisabledCurrent)
    : undefined;
  const selectedEnabled = enabled.some((currency) => currency.value === params.includeDisabledCurrent);

  const items: SearchableSelectOption[] = [];
  if (selected && !selectedEnabled) {
    const option = optionByValue.get(selected.value);
    const label = params.formatLabel?.(selected, option, locale) ?? (option ? localizedLabel(option.labels, locale) : localizedLabel(selected.labels, locale));
    items.push({
      value: selected.value,
      label: locale === "zh-CN" ? `${label}（已禁用）` : `${label} (disabled)`,
      disabled: true,
      keywords: option ? createCurrencyKeywords(option) : uniq([selected.value, localizedLabel(selected.labels, "zh-CN"), localizedLabel(selected.labels, "en-US")]),
    });
  }

  for (const item of enabled) {
    const option = optionByValue.get(item.value);
    const label = params.formatLabel?.(item, option, locale) ?? (option ? localizedLabel(option.labels, locale) : localizedLabel(item.labels, locale));
    items.push({
      value: item.value,
      label,
      keywords: option ? createCurrencyKeywords(option) : uniq([item.value, localizedLabel(item.labels, "zh-CN"), localizedLabel(item.labels, "en-US")]),
    });
  }

  return items;
}

/** 为 IANA 时区生成城市、区域和当前 offset 关键词。 */
export function createTimeZoneKeywords(timeZone: string, now = new Date()): string[] {
  const [area, city] = timeZone.split("/");
  const cityWords = city?.replace(/_/g, " ");
  const offset = formatTimeZoneOffset(timeZone, now);
  const offsetLower = offset.toLowerCase();
  const offsetGmt = offset.replace(/^UTC/i, "GMT");
  const offsetWithoutColon = offset.replace(":", "");
  // 同时提供 `UTC+08:00`、`GMT+08:00`、`utc0800`、`+0800` 等变体，覆盖用户搜索时常见的 offset 写法。
  const offsetCompact = offset
    .replace(/^UTC/i, "utc")
    .replace(":", "")
    .replace("+", "");

  return uniq([
    timeZone,
    timeZone.replace(/_/g, " "),
    area,
    city,
    cityWords,
    offset,
    offsetLower,
    offsetGmt,
    offsetGmt.toLowerCase(),
    offsetWithoutColon,
    offsetWithoutColon.toLowerCase(),
    offsetCompact,
    offsetCompact.toLowerCase(),
    offset.replace(/^UTC/i, ""),
    offset.replace(/^UTC/i, "").replace(":", ""),
  ]);
}

/** 创建时区下拉选项，label 中包含当前 offset 作为辅助识别信息。 */
export function createTimeZoneSelectOptions(timeZones: readonly string[], now = new Date()): SearchableSelectOption[] {
  return timeZones.map((timeZone) => ({
    value: timeZone,
    label: `${timeZone} (${formatTimeZoneOffset(timeZone, now)})`,
    keywords: createTimeZoneKeywords(timeZone, now),
  }));
}
