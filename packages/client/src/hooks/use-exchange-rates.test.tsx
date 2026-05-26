import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { useExchangeRates } from "./use-exchange-rates";
import { SUPPORTED_EXCHANGE_RATE_CURRENCIES } from "@/lib/currency-data";

const EXCHANGE_RATE_LOG_PREFIX = "Failed to fetch exchange rates";

const supportedRates = Object.fromEntries(
  SUPPORTED_EXCHANGE_RATE_CURRENCIES.map((code, index) => [
    code,
    code === "USD" ? 1 : Number((index + 1.25).toFixed(4)),
  ]),
) as Record<string, number>;

function makeExchangeApiUsdResponse(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-05-17",
    usd: {
      ...Object.fromEntries(
        Object.entries(supportedRates).map(([code, rate]) => [code.toLowerCase(), rate]),
      ),
      ...overrides,
    },
  };
}

function makeFloatRatesResponse(overrides: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(supportedRates)
        .filter(([alphaCode]) => alphaCode !== "USD")
        .map(([alphaCode, rate]) => [
          alphaCode.toLowerCase(),
          {
            code: alphaCode,
            alphaCode,
            numericCode: "000",
            name: alphaCode,
            rate,
            date: "Fri, 15 May 2026 23:55:05 GMT",
            inverseRate: 1 / rate,
          },
        ]),
    ),
    ...overrides,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function requestPath(callIndex: number) {
  const [requestUrl] = vi.mocked(fetch).mock.calls[callIndex] ?? [];
  const url = new URL(String(requestUrl));
  return `${url.origin}${url.pathname}`;
}

function firstLogArg(args: unknown[]) {
  return typeof args[0] === "string" ? args[0] : "";
}

function createExchangeRateLogCapture() {
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  const originalWarn = console.warn;
  const originalError = console.error;

  // 这些测试主动制造远端故障来覆盖降级路径；只吞掉汇率 Hook 的预期日志，其他 console 仍透出。
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (firstLogArg(args).startsWith(EXCHANGE_RATE_LOG_PREFIX)) {
      warnings.push(args);
      return;
    }
    originalWarn(...args);
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (firstLogArg(args).startsWith(EXCHANGE_RATE_LOG_PREFIX)) {
      errors.push(args);
      return;
    }
    originalError(...args);
  });

  return {
    warnings,
    errors,
    expectWarning(message: string) {
      expect(warnings.some((args) => firstLogArg(args).includes(message))).toBe(true);
    },
    expectError(message: string) {
      expect(errors.some((args) => firstLogArg(args).includes(message))).toBe(true);
    },
  };
}

describe("useExchangeRates", () => {
  let exchangeRateLogs: ReturnType<typeof createExchangeRateLogCapture>;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    exchangeRateLogs = createExchangeRateLogCapture();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("uses a valid localStorage cache for the requested provider without calling the network", async () => {
    localStorage.setItem("exchange_rates_cache_v3", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { ...supportedRates, CNY: 7, USD: 1 },
      cachedAt: Date.now(),
      requestedProvider: "exchange-api",
      provider: "floatrates",
    }));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rates["CNY"]).toBe(7);
    expect(result.current.rates["USD"]).toBe(1);
    expect(result.current.activeProvider).toBe("floatrates");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores the old v2 cache key and fetches current default rates", async () => {
    localStorage.setItem("exchange_rates_cache_v2", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { EUR: 0.9, CNY: 7, USD: 1 },
      cachedAt: Date.now(),
      requestedProvider: "floatrates",
      provider: "floatrates",
    }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(result.current.rates["CNY"]).toBe(supportedRates["CNY"]);
  });

  it("fetches FloatRates by default and does not call exchange-api when it succeeds", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["CNY"]).toBe(supportedRates["CNY"]);
    expect(result.current.rates["USD"]).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");

    const cached = JSON.parse(localStorage.getItem("exchange_rates_cache_v3") ?? "{}") as {
      base?: string;
      provider?: string;
      requestedProvider?: string;
      rates?: Record<string, number>;
    };
    expect(cached["base"]).toBe("USD");
    expect(cached["provider"]).toBe("floatrates");
    expect(cached["requestedProvider"]).toBe("floatrates");
    expect(cached["rates"]?.["CNY"]).toBe(supportedRates["CNY"]);
    expect(cached["rates"]?.["USD"]).toBe(1);
  });

  it("uses exchange-api first when selected", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeExchangeApiUsdResponse()));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("exchange-api");
    expect(result.current.rates["CNY"]).toBe(supportedRates["CNY"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
  });

  it("uses the exchange-api Cloudflare fallback when jsDelivr fails", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("jsdelivr down"))
      .mockResolvedValueOnce(jsonResponse(makeExchangeApiUsdResponse()));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("exchange-api");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestPath(0)).toBe("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
    expect(requestPath(1)).toBe("https://latest.currency-api.pages.dev/v1/currencies/usd.min.json");
    exchangeRateLogs.expectWarning("exchange-api endpoint https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
  });

  it("falls back to FloatRates when exchange-api fails", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("jsdelivr down"))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["CNY"]).toBe(supportedRates["CNY"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(requestPath(2)).toBe("https://www.floatrates.com/daily/usd.json");
    exchangeRateLogs.expectWarning("exchange-api endpoint https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
    exchangeRateLogs.expectWarning("exchange-api endpoint https://latest.currency-api.pages.dev/v1/currencies/usd.min.json");
    exchangeRateLogs.expectWarning("exchange rates from exchange-api");

    const cached = JSON.parse(localStorage.getItem("exchange_rates_cache_v3") ?? "{}") as {
      provider?: string;
      requestedProvider?: string;
    };
    expect(cached["provider"]).toBe("floatrates");
    expect(cached["requestedProvider"]).toBe("exchange-api");
  });

  it("falls back to exchange-api when FloatRates fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse({ cny: undefined })))
      .mockResolvedValueOnce(jsonResponse(makeExchangeApiUsdResponse()));

    const { result } = renderHook(() => useExchangeRates("floatrates"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("exchange-api");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(requestPath(1)).toBe("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json");
  });

  it.each([
    ["missing currency", () => {
      const response = makeFloatRatesResponse();
      delete response["cny"];
      return response;
    }],
    ["alphaCode/key mismatch", () => makeFloatRatesResponse({
      cny: { alphaCode: "EUR", rate: supportedRates["CNY"], date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
    ["string rate", () => makeFloatRatesResponse({
      cny: { alphaCode: "CNY", rate: "oops", date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
    ["non-positive rate", () => makeFloatRatesResponse({
      cny: { alphaCode: "CNY", rate: 0, date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
  ])("reports contract errors when FloatRates has %s and exchange-api also fails", async (_caseName, makePayload) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(makePayload()))
      .mockRejectedValueOnce(new Error("exchange-api primary down"))
      .mockRejectedValueOnce(new Error("exchange-api fallback down"));

    const { result } = renderHook(() => useExchangeRates("floatrates"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("汇率响应格式异常");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it.each([
    ["missing currency", () => {
      const response = makeExchangeApiUsdResponse();
      delete response.usd["cny"];
      return response;
    }],
    ["string rate", () => makeExchangeApiUsdResponse({ cny: "oops" })],
    ["non-positive rate", () => makeExchangeApiUsdResponse({ cny: 0 })],
  ])("reports contract errors when exchange-api has %s and FloatRates also fails", async (_caseName, makePayload) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(makePayload()))
      .mockRejectedValueOnce(new Error("exchange-api fallback down"))
      .mockRejectedValueOnce(new Error("floatrates down"));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("汇率响应格式异常");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it("falls back to FloatRates for exchange-api HTTP failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it("falls back to FloatRates when both exchange-api endpoints time out", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("falls back with the timeout message when all remote requests time out", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const { result } = renderHook(() => useExchangeRates());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("请求超时，请稍后重试");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
    exchangeRateLogs.expectWarning("exchange rates from floatrates");
    exchangeRateLogs.expectWarning("exchange rates from exchange-api");
    exchangeRateLogs.expectError("Failed to fetch exchange rates");
  });

  it("refresh skips cache and can use the new requested provider immediately", async () => {
    localStorage.setItem("exchange_rates_cache_v3", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { ...supportedRates, EUR: 0.9, CNY: 7, USD: 1 },
      cachedAt: Date.now(),
      requestedProvider: "exchange-api",
      provider: "exchange-api",
    }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh("floatrates");
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(result.current.activeProvider).toBe("floatrates");

    const cached = JSON.parse(localStorage.getItem("exchange_rates_cache_v3") ?? "{}") as {
      provider?: string;
      requestedProvider?: string;
    };
    expect(cached["provider"]).toBe("floatrates");
    expect(cached["requestedProvider"]).toBe("floatrates");
  });

  it("reuses an in-flight request for the same requested provider", async () => {
    let signal: AbortSignal | undefined;
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((resolve, reject) => {
      signal = (init as RequestInit).signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      resolveFetch = resolve;
    }));

    const { result } = renderHook(() => useExchangeRates("floatrates"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      const refreshPromise = result.current.refresh("floatrates");
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(false);
      resolveFetch?.(jsonResponse(makeFloatRatesResponse()));
      await refreshPromise;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it("aborts an in-flight request when the requested provider changes", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = (init as RequestInit).signal;
      if (signal) {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }
    }));

    const { result, unmount } = renderHook(() => useExchangeRates("exchange-api"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      void result.current.refresh("floatrates");
      await Promise.resolve();
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    unmount();
  });

  it("does not start a request for the fake StrictMode mount", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );

    const { result } = renderHook(() => useExchangeRates("floatrates"), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
  });

  it("aborts in-flight requests on unmount", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      signal = (init as RequestInit).signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const { unmount } = renderHook(() => useExchangeRates());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
