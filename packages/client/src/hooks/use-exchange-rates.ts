/**
 * 汇率 Hook（Frankfurter / FloatRates）。
 *
 * 作用：
 * - 为统计/仪表盘提供实时汇率换算（统一到默认币种）
 * - 24 小时缓存到 localStorage，避免频繁请求
 *
 * 注意：
 * - 该 Hook 只在浏览器端使用（依赖 localStorage）
 * - 首选 API 不可用时会尝试另一个远端来源，最后回退到内置的 FALLBACK_RATES
 *
 * 状态链路：
 * ```
 * mount -> localStorage cache hit? -> setRates
 *       -> fetch preferred provider -> fallback provider -> cache + setRates
 *       -> both remote providers fail -> FALLBACK_RATES + error
 * ```
 *
 * Caveat: 统计页和首页会把所有币种先换算到用户默认货币；修改 base 逻辑会影响全站金额口径。
 * PERF: 当前缓存是浏览器本地 24h 粒度；若多页面频繁刷新，可提升为 Query cache 或后端代理缓存。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatNumberMaxFractionDigits } from '@/lib/number-format';
import { getApiLocale } from '@/i18n/api-locale';
import { translate } from '@/i18n/messages';
import {
  cachedExchangeRateDataSchema,
  floatRatesResponseSchema,
  frankfurterV2RatesResponseSchema,
  type CachedExchangeRateData,
  type ExchangeRateData,
  type ExchangeRateProvider,
  type ExchangeRates,
} from '@/lib/api/schemas/exchange-rates';

const CACHE_KEY = 'exchange_rates_cache_v2';
/** 缓存有效期：24 小时（毫秒）。 */
const CACHE_DURATION = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** 远端汇率来源共同支持的货币列表（本项目以 USD 作为基准）。 */
const SUPPORTED_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR'
];

/** 回退汇率：当 API 失败时使用（以 USD 为 base）。 */
const FALLBACK_RATES: ExchangeRates = {
  USD: 1,
  AUD: 1.50, BRL: 5.39, CAD: 1.39, CHF: 0.80, CNY: 6.98,
  CZK: 20.90, DKK: 6.42, EUR: 0.86, GBP: 0.75, HKD: 7.80,
  HUF: 331.58, IDR: 16860, ILS: 3.16, INR: 90.22, ISK: 126.61,
  JPY: 157.64, KRW: 1459.84, MXN: 18.03, MYR: 4.07, NOK: 10.12,
  NZD: 1.75, PHP: 59.21, PLN: 3.62, RON: 4.37, SEK: 9.23,
  SGD: 1.29, THB: 31.47, TRY: 43.11, ZAR: 16.58
};

const FRANKFURTER_API = 'https://api.frankfurter.dev';
const FLOATRATES_USD_FEED = 'https://www.floatrates.com/daily/usd.json';
const DEFAULT_EXCHANGE_RATE_PROVIDER: ExchangeRateProvider = "floatrates";

type ExchangeRateSource = ExchangeRateProvider | "builtin";
type ExchangeRateErrorKind = "timeout" | "contract" | "network";
type InFlightRatesRequest = {
  requestedProvider: ExchangeRateProvider;
  controller: AbortController;
  promise: Promise<void>;
};

class ExchangeRateContractError extends Error {
  constructor(message = "Invalid exchange rate response") {
    super(message);
    this.name = "ExchangeRateContractError";
  }
}

class ExchangeRateTimeoutError extends Error {
  constructor(message = "Exchange rate request timed out") {
    super(message);
    this.name = "ExchangeRateTimeoutError";
  }
}

class ExchangeRateProviderError extends Error {
  constructor(
    readonly provider: ExchangeRateProvider,
    readonly kind: ExchangeRateErrorKind,
    readonly originalCause: unknown,
  ) {
    super(`Exchange rate provider ${provider} failed: ${kind}`);
    this.name = "ExchangeRateProviderError";
  }
}

const SUPPORTED_CURRENCY_SET = new Set(SUPPORTED_CURRENCIES);

function normalizeFrankfurterV2Response(value: unknown): ExchangeRateData | null {
  // 外部 API 不受本仓库类型约束，必须在 hook 边界 parse 后再进入统计计算。
  const parsed = frankfurterV2RatesResponseSchema.safeParse(value);
  if (!parsed.success) return null;

  const rates: ExchangeRates = {};
  let date: string | null = null;

  for (const row of parsed.data) {
    if (!SUPPORTED_CURRENCY_SET.has(row.quote)) continue;
    if (rates[row.quote] !== undefined) return null;
    rates[row.quote] = row.rate;
    date ??= row.date;
  }

  const hasAllSupportedCurrencies = SUPPORTED_CURRENCIES.every((currency) => rates[currency] !== undefined);
  if (!date || !hasAllSupportedCurrencies) return null;

  return {
    base: "USD",
    date,
    rates,
  };
}

function normalizeFloatRatesResponse(value: unknown): ExchangeRateData | null {
  const parsed = floatRatesResponseSchema.safeParse(value);
  if (!parsed.success) return null;

  const rates: ExchangeRates = {};
  let date: string | null = null;

  for (const [key, row] of Object.entries(parsed.data)) {
    const keyCode = key.toUpperCase();
    if (!SUPPORTED_CURRENCY_SET.has(keyCode) && !SUPPORTED_CURRENCY_SET.has(row.alphaCode)) continue;
    if (keyCode !== row.alphaCode) return null;
    if (rates[row.alphaCode] !== undefined) return null;

    rates[row.alphaCode] = row.rate;
    date ??= row.date;
  }

  const hasAllSupportedCurrencies = SUPPORTED_CURRENCIES.every((currency) => rates[currency] !== undefined);
  if (!date || !hasAllSupportedCurrencies) return null;

  return {
    base: "USD",
    date,
    rates,
  };
}

function normalizeCachedExchangeRateData(value: unknown): CachedExchangeRateData | null {
  // localStorage 可能被旧版本或用户手动污染；缓存命中前同样走 schema。
  const parsed = cachedExchangeRateDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function getProviderOrder(preferredProvider: ExchangeRateProvider): ExchangeRateProvider[] {
  return preferredProvider === "floatrates"
    ? ["floatrates", "frankfurter"]
    : ["frankfurter", "floatrates"];
}

function errorKindFromProviderError(error: unknown): ExchangeRateErrorKind {
  if (error instanceof ExchangeRateProviderError) return error.kind;
  if (error instanceof ExchangeRateTimeoutError) return "timeout";
  if (error instanceof ExchangeRateContractError || error instanceof SyntaxError) return "contract";
  return "network";
}

function getErrorMessageKey(kind: ExchangeRateErrorKind) {
  if (kind === "timeout") return "error.timeout";
  if (kind === "contract") return "error.exchangeRatesContract";
  return "error.network";
}

async function fetchJsonWithTimeout(url: string, parentSignal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    if (timedOut) throw new ExchangeRateTimeoutError();
    throw e;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

async function fetchProviderRates(
  provider: ExchangeRateProvider,
  signal: AbortSignal,
): Promise<ExchangeRateData> {
  try {
    if (provider === "frankfurter") {
      const params = new URLSearchParams({
        base: "USD",
        quotes: SUPPORTED_CURRENCIES.join(","),
      });
      const payload = await fetchJsonWithTimeout(`${FRANKFURTER_API}/v2/rates?${params.toString()}`, signal);
      const data = normalizeFrankfurterV2Response(payload);
      if (!data) throw new ExchangeRateContractError();
      return data;
    }

    const payload = await fetchJsonWithTimeout(FLOATRATES_USD_FEED, signal);
    const data = normalizeFloatRatesResponse(payload);
    if (!data) throw new ExchangeRateContractError();
    return data;
  } catch (e) {
    if (signal.aborted && !(e instanceof ExchangeRateTimeoutError)) throw e;
    throw new ExchangeRateProviderError(provider, errorKindFromProviderError(e), e);
  }
}

/** 汇率 Hook：提供 convert/getCurrencySymbol/formatAmount 等能力。 */
export const useExchangeRates = (preferredProvider: ExchangeRateProvider = DEFAULT_EXCHANGE_RATE_PROVIDER) => {
  const [rates, setRates] = useState<ExchangeRates>(FALLBACK_RATES);
  const [baseRate, setBaseRate] = useState<string>('USD');
  const [activeProvider, setActiveProvider] = useState<ExchangeRateSource>("builtin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(false);
  const inFlightRef = useRef<InFlightRatesRequest | null>(null);

  /** 读取缓存（缓存命中且未过期才返回）。 */
  const getCachedRates = (requestedProvider: ExchangeRateProvider): CachedExchangeRateData | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const data = normalizeCachedExchangeRateData(JSON.parse(cached));
      if (!data) return null;
      if (data.requestedProvider !== requestedProvider) return null;
      const now = Date.now();

      // 24h 缓存是可用性优先：汇率轻微滞后，比每次打开页面都依赖外部网络更适合自托管。
      if (now - data.cachedAt < CACHE_DURATION) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  };

  /** 写入缓存（附带 cachedAt 便于过期判断）。 */
  const setCachedRates = (
    data: ExchangeRateData,
    provider: ExchangeRateProvider,
    requestedProvider: ExchangeRateProvider,
  ) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        ...data,
        cachedAt: Date.now(),
        provider,
        requestedProvider,
      }));
    } catch (e) {
      console.warn('Failed to cache exchange rates:', e);
    }
  };

  /**
   * 拉取汇率（可选强制刷新）。
   *
   * - 默认优先使用缓存
   * - forceRefresh=true 时跳过缓存直接请求
   */
  const fetchRates = useCallback((
    forceRefresh = false,
    providerOverride?: ExchangeRateProvider,
  ): Promise<void> => {
    const requestedProvider = providerOverride ?? preferredProvider;
    const currentRequest = inFlightRef.current;
    if (
      currentRequest
      && !currentRequest.controller.signal.aborted
      && currentRequest.requestedProvider === requestedProvider
    ) {
      return currentRequest.promise;
    }

    if (currentRequest) {
      currentRequest.controller.abort();
      inFlightRef.current = null;
    }

    setLoading(true);
    setError(null);

    // 优先读缓存（除非强制刷新）
    if (!forceRefresh) {
      const cached = getCachedRates(requestedProvider);
      if (cached) {
        const ratesWithBase = { ...cached.rates, USD: 1 };
        setRates(ratesWithBase);
        setBaseRate(cached.base);
        setActiveProvider(cached.provider);
        setLastUpdated(new Date(cached.cachedAt));
        setLoading(false);
        return Promise.resolve();
      }
    }

    const controller = new AbortController();
    const promise = (async () => {
      const providerFailures: ExchangeRateProviderError[] = [];
      try {
        for (const provider of getProviderOrder(requestedProvider)) {
          try {
            const data = await fetchProviderRates(provider, controller.signal);
            // 防止卸载、强制刷新或慢响应交错后把旧汇率写回 UI。
            if (controller.signal.aborted || inFlightRef.current?.controller !== controller || !mountedRef.current) return;

            const ratesWithBase = { ...data.rates, USD: 1 };

            setRates(ratesWithBase);
            setBaseRate(data.base);
            setActiveProvider(provider);
            setLastUpdated(new Date());
            setError(null);
            setCachedRates({ ...data, rates: ratesWithBase }, provider, requestedProvider);
            return;
          } catch (e) {
            if (controller.signal.aborted) return;
            const providerError = e instanceof ExchangeRateProviderError
              ? e
              : new ExchangeRateProviderError(provider, errorKindFromProviderError(e), e);
            providerFailures.push(providerError);
            console.warn(`Failed to fetch exchange rates from ${provider}:`, e);
          }
        }

        throw providerFailures[0] ?? new ExchangeRateProviderError(requestedProvider, "network", new Error("No exchange-rate provider returned data"));
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!mountedRef.current || inFlightRef.current?.controller !== controller) return;
        console.error('Failed to fetch exchange rates:', e);
        const kind = errorKindFromProviderError(e);
        setError(translate(
          getApiLocale(),
          getErrorMessageKey(kind),
        ));
        // 使用回退汇率，保证统计/仪表盘仍可用
        setRates(FALLBACK_RATES);
        setBaseRate('USD');
        setActiveProvider("builtin");
      } finally {
        if (inFlightRef.current?.controller === controller) {
          if (mountedRef.current) setLoading(false);
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = {
      requestedProvider,
      controller,
      promise,
    };
    return promise;
  }, [preferredProvider]);

  useEffect(() => {
    mountedRef.current = true;
    const timeoutId = setTimeout(() => {
      void fetchRates();
    }, 0);
    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutId);
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
    };
  }, [fetchRates]);

  /** 金额换算：fromCurrency → toCurrency（先转 USD，再转目标币种）。 */
  const convert = useCallback((
    amount: number, 
    fromCurrency: string, 
    toCurrency: string
  ): number => {
    if (fromCurrency === toCurrency) return amount;

    const fromRate = rates[fromCurrency] || 1;
    const toRate = rates[toCurrency] || 1;

    // 远端数据统一归一为 USD base；先转 base 再转目标币种，避免维护 N*N 汇率表。
    const amountInBase = amount / fromRate;
    return amountInBase * toRate;
  }, [rates]);

  /** 获取货币符号（用于 UI 展示）。 */
  const getCurrencySymbol = useCallback((currency: string): string => {
    const symbols: Record<string, string> = {
      USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
      AUD: 'A$', CAD: 'C$', CHF: 'CHF', HKD: 'HK$', NZD: 'NZ$',
      SGD: 'S$', KRW: '₩', INR: '₹', MXN: 'MX$', BRL: 'R$',
      ZAR: 'R', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł',
      CZK: 'Kč', HUF: 'Ft', TRY: '₺', ILS: '₪', THB: '฿',
      PHP: '₱', MYR: 'RM', IDR: 'Rp', RON: 'lei', ISK: 'kr'
    };
    return symbols[currency] || currency;
  }, []);

  /** 格式化金额：加货币符号 + “最多 N 位小数”（展示层使用，避免强制补 0）。 */
  const formatAmount = useCallback((
    amount: number, 
    currency: string, 
    maxFractionDigits = 3
  ): string => {
    const symbol = getCurrencySymbol(currency);
    return `${symbol}${formatNumberMaxFractionDigits(amount, maxFractionDigits)}`;
  }, [getCurrencySymbol]);

  return {
    rates,
    baseRate,
    activeProvider,
    loading,
    error,
    lastUpdated,
    convert,
    getCurrencySymbol,
    formatAmount,
    /** 强制刷新汇率（跳过缓存）。 */
    refresh: (providerOverride?: ExchangeRateProvider) => fetchRates(true, providerOverride)
  };
};
