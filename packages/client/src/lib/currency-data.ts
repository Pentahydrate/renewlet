/**
 * 汇率适配器、设置页和订阅表单共享的货币数据。
 *
 * 支持集合固定为 fawazahmed0/exchange-api 与 FloatRates JSON Feeds 的交集，
 * 已在 2026-05-17 核验。标签和符号运行时由 Intl 派生，让列表保持紧凑且支持 locale。
 */

export const SUPPORTED_EXCHANGE_RATE_CURRENCIES = [
  "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT",
  "BHD", "BIF", "BND", "BOB", "BRL", "BSD", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF",
  "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD",
  "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD",
  "JPY", "KES", "KGS", "KHR", "KMF", "KRW", "KWD", "KZT", "LAK", "LBP", "LKR", "LRD",
  "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR",
  "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB",
  "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR",
  "SBD", "SCR", "SDG", "SEK", "SGD", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL",
  "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD",
  "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XOF", "XPF", "YER",
  "ZAR", "ZMW",
] as const;

export type SupportedExchangeRateCurrency = (typeof SUPPORTED_EXCHANGE_RATE_CURRENCIES)[number];

const SUPPORTED_EXCHANGE_RATE_CURRENCY_SET = new Set<string>(SUPPORTED_EXCHANGE_RATE_CURRENCIES);

export function isSupportedExchangeRateCurrency(value: string): value is SupportedExchangeRateCurrency {
  return SUPPORTED_EXCHANGE_RATE_CURRENCY_SET.has(value);
}

export function getIntlCurrencyName(currency: string, locale: string): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "currency" });
    return displayNames.of(currency) ?? currency;
  } catch {
    return currency;
  }
}

export function getIntlCurrencySymbol(currency: string, locale = "zh-CN"): string {
  try {
    const narrowParts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const narrowSymbol = narrowParts.find((part) => part.type === "currency")?.value;
    if (narrowSymbol && (currency === "USD" || narrowSymbol !== "$")) return narrowSymbol;

    const symbolParts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return symbolParts.find((part) => part.type === "currency")?.value ?? narrowSymbol ?? currency;
  } catch {
    return currency;
  }
}

export function getIntlCurrencyOptionLabel(currency: string, locale: string): string {
  return `${getIntlCurrencyName(currency, locale)} (${getIntlCurrencySymbol(currency, locale)})`;
}
