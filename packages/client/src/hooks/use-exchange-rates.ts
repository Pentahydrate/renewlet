/**
 * 汇率 Hook（exchange-api / FloatRates）。
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
 * 挂载 -> 命中 localStorage 缓存？-> setRates
 *       -> fetch preferred provider -> fallback provider -> cache + setRates
 *       -> both remote providers fail -> FALLBACK_RATES + error
 * ```
 *
 * 注意： 统计页和首页会把所有币种先换算到用户默认货币；修改 base 逻辑会影响全站金额口径。
 * PERF： 当前缓存是浏览器本地 24h 粒度；若多页面频繁刷新，可提升为 Query cache 或后端代理缓存。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatNumberMaxFractionDigits } from '@/lib/number-format';
import { getApiLocale } from '@/i18n/api-locale';
import { translate } from '@/i18n/messages';
import { reportClientError } from "@/lib/report-client-error";
import {
  cachedExchangeRateDataSchema,
  exchangeApiUsdResponseSchema,
  floatRatesResponseSchema,
  type CachedExchangeRateData,
  type ExchangeRateData,
  type ExchangeRateProvider,
  type ExchangeRates,
} from '@/lib/api/schemas/exchange-rates';
import {
  createRawErrorResponseDetails,
  createRawErrorResponseDetailsFromText,
  type RawErrorResponseDetails,
} from "@/lib/raw-error-response";
import {
  SUPPORTED_EXCHANGE_RATE_CURRENCIES,
  getIntlCurrencySymbol,
  isSupportedExchangeRateCurrency,
} from '@/lib/currency-data';

const CACHE_KEY = 'exchange_rates_cache_v3';
const CACHE_DURATION = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** 回退汇率：当 API 失败时使用（以 USD 为 base，快照来自 exchange-api，2026-05-17）。 */
const FALLBACK_RATES: ExchangeRates = {
  AED: 3.6725000, AFN: 63.658356, ALL: 82.049317, AMD: 368.26261, AOA: 927.89052, ARS: 1394.9049,
  AUD: 1.3990788, AWG: 1.7900000, AZN: 1.7018910, BAM: 1.6824426, BBD: 2, BDT: 122.76805,
  BHD: 0.37600000, BIF: 2977.6097, BND: 1.2804094, BOB: 6.9277967, BRL: 5.0541011, BSD: 1,
  BWP: 14.150296, BYN: 2.7815765, BZD: 2.0124111, CAD: 1.3750033, CDF: 2240.4135, CHF: 0.78756477,
  CLP: 909.78596, CNY: 6.8102395, COP: 3793.3717, CRC: 452.90696, CUP: 23.942409, CVE: 94.856376,
  CZK: 20.918924, DJF: 178.53764, DKK: 6.4287998, DOP: 59.294146, DZD: 132.63320, EGP: 52.896417,
  ERN: 15, ETB: 157.67443, EUR: 0.86021924, FJD: 2.2038675, GBP: 0.75036482, GEL: 2.6727088,
  GHS: 11.420097, GIP: 0.75036482, GMD: 74.387435, GNF: 8775.3083, GTQ: 7.6239521, GYD: 209.17509,
  HKD: 7.8322861, HNL: 26.655286, HTG: 131.85968, HUF: 311.42641, IDR: 17520.102, ILS: 2.9195183,
  INR: 96.092713, IQD: 1310.2693, IRR: 1318130.4, ISK: 123.53707, JMD: 157.78473, JOD: 0.70900000,
  JPY: 158.76500, KES: 129.33193, KGS: 87.476084, KHR: 4004.7397, KMF: 423.20012, KRW: 1497.9907,
  KWD: 0.30745534, KZT: 469.57870, LAK: 21845.013, LBP: 89850.857, LKR: 326.70390, LRD: 183.23841,
  LSL: 16.685385, LYD: 6.3389662, MAD: 9.2476793, MDL: 17.213349, MGA: 4195.4209, MKD: 52.843551,
  MMK: 2099.5143, MNT: 3577.8783, MOP: 8.0672547, MRU: 40.060138, MUR: 47.168339, MVR: 15.443861,
  MWK: 1734.4546, MXN: 17.338153, MYR: 3.9555973, MZN: 63.811576, NAD: 16.685385, NGN: 1371.4380,
  NIO: 36.669477, NOK: 9.3090038, NPR: 153.82041, NZD: 1.7117580, OMR: 0.38504301, PAB: 1,
  PEN: 3.4340260, PGK: 4.3657103, PHP: 61.642886, PKR: 278.48796, PLN: 3.6524299, PYG: 6093.4983,
  QAR: 3.6400000, RON: 4.4360943, RSD: 100.97878, RUB: 72.871048, RWF: 1463.2286, SAR: 3.7500000,
  SBD: 8.0160156, SCR: 14.816184, SDG: 600.22335, SEK: 9.4480011, SGD: 1.2804094, SOS: 571.46575,
  SRD: 37.164242, SSP: 4708.0623, STN: 21.177571, SVC: 8.7500000, SYP: 110.52498, SZL: 16.685385,
  THB: 32.589042, TJS: 9.3438338, TMT: 3.5035881, TND: 2.9092984, TOP: 2.3635045, TRY: 45.490536,
  TTD: 6.7639706, TWD: 31.587183, TZS: 2599.9078, UAH: 44.030585, UGX: 3754.7311, USD: 1,
  UYU: 40.220808, UZS: 11985.338, VES: 514.46503, VND: 26355.251, VUV: 118.20420, WST: 2.7063800,
  XAF: 564.26683, XCD: 2.6999999, XCG: 1.7948790, XOF: 564.26683, XPF: 102.65146, YER: 238.59917,
  ZAR: 16.685385, ZMW: 18.909888,
};

const EXCHANGE_API_PRIMARY_USD_FEED = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json';
const EXCHANGE_API_FALLBACK_USD_FEED = 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json';
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
  constructor(
    message = "Invalid exchange rate response",
    readonly errorDetails: RawErrorResponseDetails | null = null,
  ) {
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
    readonly errorDetails: RawErrorResponseDetails | null = exchangeRateErrorDetailsFromError(originalCause),
  ) {
    super(`Exchange rate provider ${provider} failed: ${kind}`);
    this.name = "ExchangeRateProviderError";
  }
}

class ExchangeRateUpstreamError extends Error {
  constructor(
    message: string,
    readonly errorDetails: RawErrorResponseDetails,
  ) {
    super(message);
    this.name = "ExchangeRateUpstreamError";
  }
}

function hasAllSupportedRates(rates: ExchangeRates): boolean {
  return SUPPORTED_EXCHANGE_RATE_CURRENCIES.every((currency) => rates[currency] !== undefined);
}

function normalizeExchangeApiUsdResponse(value: unknown): ExchangeRateData | null {
  const parsed = exchangeApiUsdResponseSchema.safeParse(value);
  if (!parsed.success) return null;

  const rates: ExchangeRates = { USD: 1 };
  for (const [key, rate] of Object.entries(parsed.data.usd)) {
    const code = key.toUpperCase();
    if (!isSupportedExchangeRateCurrency(code)) continue;
    // 同一币种重复出现通常代表上游结构漂移；直接拒绝比静默覆盖更容易发现数据问题。
    if (rates[code] !== undefined && code !== "USD") return null;
    rates[code] = rate;
  }

  if (!hasAllSupportedRates(rates)) return null;

  return {
    base: "USD",
    date: parsed.data.date,
    rates,
  };
}

function normalizeFloatRatesResponse(value: unknown): ExchangeRateData | null {
  const parsed = floatRatesResponseSchema.safeParse(value);
  if (!parsed.success) return null;

  const rates: ExchangeRates = { USD: 1 };
  let date: string | null = null;

  for (const [key, row] of Object.entries(parsed.data)) {
    const keyCode = key.toUpperCase();
    if (!isSupportedExchangeRateCurrency(keyCode) && !isSupportedExchangeRateCurrency(row.alphaCode)) continue;
    // FloatRates 同时给对象 key 和 alphaCode；二者不一致时宁愿失败，避免把错误汇率挂到合法币种上。
    if (keyCode !== row.alphaCode) return null;
    if (rates[row.alphaCode] !== undefined) return null;

    rates[row.alphaCode] = row.rate;
    date ??= row.date;
  }

  if (!date || !hasAllSupportedRates(rates)) return null;

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
    ? ["floatrates", "exchange-api"]
    : ["exchange-api", "floatrates"];
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

function exchangeRateErrorDetailsFromError(error: unknown): RawErrorResponseDetails | null {
  if (error instanceof ExchangeRateProviderError) return error.errorDetails;
  if (error instanceof ExchangeRateUpstreamError) return error.errorDetails;
  if (error instanceof ExchangeRateContractError) return error.errorDetails;
  if (error instanceof Error || typeof error === "string") return createRawErrorResponseDetails(error);
  return null;
}

function exchangeRateErrorLogContext(error: unknown): Record<string, unknown> {
  if (error instanceof ExchangeRateProviderError) {
    return {
      name: error.name,
      message: error.message,
      provider: error.provider,
      kind: error.kind,
      cause: exchangeRateErrorLogContext(error.originalCause),
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return { message: typeof error === "string" ? error : String(error) };
}

async function fetchJsonWithTimeout(url: string, parentSignal: AbortSignal): Promise<{
  payload: unknown;
  responseText: string;
}> {
  const controller = new AbortController();
  let timedOut = false;

  // 父级 abort 表示 provider 已切换或组件卸载；超时 abort 才需要反馈成用户可见的网络超时。
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
    const responseText = await response.text();

    if (!response.ok) {
      const code = `HTTP ${response.status}`;
      throw new ExchangeRateUpstreamError(
        `HTTP error: ${response.status}`,
        createRawErrorResponseDetailsFromText({
          code,
          message: response.statusText || code,
          responseText,
        }),
      );
    }

    try {
      return { payload: JSON.parse(responseText) as unknown, responseText };
    } catch {
      throw new ExchangeRateContractError(
        "Invalid exchange rate JSON",
        createRawErrorResponseDetailsFromText({
          code: "INVALID_RESPONSE",
          message: "Invalid exchange rate JSON",
          responseText,
        }),
      );
    }
  } catch (e) {
    if (timedOut) throw new ExchangeRateTimeoutError();
    throw e;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

async function fetchExchangeApiRates(signal: AbortSignal): Promise<ExchangeRateData> {
  const failures: unknown[] = [];
  for (const url of [EXCHANGE_API_PRIMARY_USD_FEED, EXCHANGE_API_FALLBACK_USD_FEED]) {
    try {
      const { payload, responseText } = await fetchJsonWithTimeout(url, signal);
      const data = normalizeExchangeApiUsdResponse(payload);
      if (!data) {
        throw new ExchangeRateContractError(
          "Invalid exchange-api response",
          createRawErrorResponseDetailsFromText({
            code: "INVALID_RESPONSE",
            message: "Invalid exchange-api response",
            responseText,
          }),
        );
      }
      return data;
    } catch (e) {
      if (signal.aborted && !(e instanceof ExchangeRateTimeoutError)) throw e;
      failures.push(e);
      // exchange-api 的两个 URL 是同一数据源的 CDN 兜底；记录具体端点便于排查区域性 CDN 故障。
      console.warn(`Failed to fetch exchange rates from exchange-api endpoint ${url}:`, exchangeRateErrorLogContext(e));
    }
  }

  throw failures[0] ?? new Error("No exchange-api endpoint returned data");
}

async function fetchProviderRates(
  provider: ExchangeRateProvider,
  signal: AbortSignal,
): Promise<ExchangeRateData> {
  try {
    if (provider === "exchange-api") {
      return await fetchExchangeApiRates(signal);
    }

    const { payload, responseText } = await fetchJsonWithTimeout(FLOATRATES_USD_FEED, signal);
    const data = normalizeFloatRatesResponse(payload);
    if (!data) {
      throw new ExchangeRateContractError(
        "Invalid FloatRates response",
        createRawErrorResponseDetailsFromText({
          code: "INVALID_RESPONSE",
          message: "Invalid FloatRates response",
          responseText,
        }),
      );
    }
    return data;
  } catch (e) {
    if (signal.aborted && !(e instanceof ExchangeRateTimeoutError)) throw e;
    throw new ExchangeRateProviderError(provider, errorKindFromProviderError(e), e);
  }
}

export const useExchangeRates = (preferredProvider: ExchangeRateProvider = DEFAULT_EXCHANGE_RATE_PROVIDER) => {
  const [rates, setRates] = useState<ExchangeRates>(FALLBACK_RATES);
  const [baseRate, setBaseRate] = useState<string>('USD');
  const [activeProvider, setActiveProvider] = useState<ExchangeRateSource>("builtin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<RawErrorResponseDetails | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(false);
  const inFlightRef = useRef<InFlightRatesRequest | null>(null);

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
   * 汇率刷新入口。
   *
   * 同一 provider 的并发请求会合并；切换 provider 时旧请求会被 abort，保证设置页显示的来源
   * 和统计页实际使用的汇率不会交叉回写。
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
      // 同一 provider 的并发刷新复用同一个 Promise，避免多个页面组件同时把外部汇率源打爆。
      return currentRequest.promise;
    }

    if (currentRequest) {
      // provider 切换时旧请求即使稍后成功也不能回写，否则 UI 会显示和设置不一致的数据源。
      currentRequest.controller.abort();
      inFlightRef.current = null;
    }

    setLoading(true);
    setError(null);
    setErrorDetails(null);

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
            setErrorDetails(null);
            setCachedRates({ ...data, rates: ratesWithBase }, provider, requestedProvider);
            return;
          } catch (e) {
            if (controller.signal.aborted) return;
            const providerError = e instanceof ExchangeRateProviderError
              ? e
              : new ExchangeRateProviderError(provider, errorKindFromProviderError(e), e);
            providerFailures.push(providerError);
            console.warn(`Failed to fetch exchange rates from ${provider}:`, exchangeRateErrorLogContext(providerError));
          }
        }

        throw providerFailures[0] ?? new ExchangeRateProviderError(requestedProvider, "network", new Error("No exchange-rate provider returned data"));
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!mountedRef.current || inFlightRef.current?.controller !== controller) return;
        reportClientError(new Error("Exchange rate fetch failed"), {
          source: "exchange-rates.fetch",
          ...exchangeRateErrorLogContext(e),
        });
        const kind = errorKindFromProviderError(e);
        setError(translate(
          getApiLocale(),
          getErrorMessageKey(kind),
        ));
        setErrorDetails(exchangeRateErrorDetailsFromError(e));
        // 汇率失败不能拖垮仪表盘；内置快照牺牲实时性，保留跨币种统计的可解释性。
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
      // 组件卸载时主动取消请求，配合 mountedRef 防止 React 严格模式重复挂载时旧响应回写。
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
    };
  }, [fetchRates]);

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

  const getCurrencySymbol = useCallback((currency: string): string => {
    return getIntlCurrencySymbol(currency);
  }, []);

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
    errorDetails,
    lastUpdated,
    convert,
    getCurrencySymbol,
    formatAmount,
    refresh: (providerOverride?: ExchangeRateProvider) => fetchRates(true, providerOverride)
  };
};
