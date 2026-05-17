import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { useExchangeRates } from "./use-exchange-rates";

const supportedRates = {
  AUD: 1.39,
  BRL: 5.01,
  CAD: 1.37,
  CHF: 0.78,
  CNY: 6.8,
  CZK: 20.87,
  DKK: 6.4,
  EUR: 0.86,
  GBP: 0.75,
  HKD: 7.84,
  HUF: 308.22,
  IDR: 17513,
  ILS: 2.91,
  INR: 95.85,
  ISK: 123.24,
  JPY: 158.48,
  KRW: 1496.42,
  MXN: 17.33,
  MYR: 3.94,
  NOK: 9.27,
  NZD: 1.7,
  PHP: 61.67,
  PLN: 3.64,
  RON: 4.46,
  SEK: 9.39,
  SGD: 1.27,
  THB: 32.54,
  TRY: 45.5,
  ZAR: 16.58,
};

function makeFrankfurterV2Rows() {
  return Object.entries(supportedRates).map(([quote, rate]) => ({
    date: "2026-05-16",
    base: "USD",
    quote,
    rate,
  }));
}

function makeFloatRatesResponse(overrides: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(supportedRates).map(([alphaCode, rate]) => [
        alphaCode.toLowerCase(),
        {
          code: `USD/${alphaCode}`,
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

describe("useExchangeRates", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a valid localStorage cache for the requested provider without calling the network", async () => {
    localStorage.setItem("exchange_rates_cache_v2", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { EUR: 0.9, CNY: 7, USD: 1 },
      cachedAt: Date.now(),
      requestedProvider: "frankfurter",
      provider: "floatrates",
    }));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rates["EUR"]).toBe(0.9);
    expect(result.current.rates["USD"]).toBe(1);
    expect(result.current.activeProvider).toBe("floatrates");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores cache written for another requested provider", async () => {
    localStorage.setItem("exchange_rates_cache_v2", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { EUR: 0.9, CNY: 7, USD: 1 },
      cachedAt: Date.now(),
      requestedProvider: "frankfurter",
      provider: "frankfurter",
    }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("floatrates"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(result.current.activeProvider).toBe("floatrates");
  });

  it("ignores the old v1 cache key and fetches current default rates", async () => {
    localStorage.setItem("exchange_rates_cache", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { EUR: 0.9, CNY: 7 },
      cachedAt: Date.now(),
    }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(result.current.rates["CNY"]).toBe(6.8);
  });

  it("fetches FloatRates by default and does not call Frankfurter when it succeeds", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["CNY"]).toBe(6.8);
    expect(result.current.rates["USD"]).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");

    const cached = JSON.parse(localStorage.getItem("exchange_rates_cache_v2") ?? "{}") as {
      base?: string;
      provider?: string;
      requestedProvider?: string;
      rates?: Record<string, number>;
    };
    expect(cached["base"]).toBe("USD");
    expect(cached["provider"]).toBe("floatrates");
    expect(cached["requestedProvider"]).toBe("floatrates");
    expect(cached["rates"]?.["CNY"]).toBe(6.8);
    expect(cached["rates"]?.["USD"]).toBe(1);
  });

  it("uses Frankfurter first when selected", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFrankfurterV2Rows()));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("frankfurter");
    expect(result.current.rates["CNY"]).toBe(6.8);
    expect(fetch).toHaveBeenCalledTimes(1);

    const [requestUrl] = vi.mocked(fetch).mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.frankfurter.dev/v2/rates");
    expect(url.searchParams.get("base")).toBe("USD");
    expect(url.searchParams.get("quotes")?.split(",")).toContain("CNY");
    expect(url.searchParams.has("symbols")).toBe(false);
  });

  it("falls back to FloatRates when Frankfurter fails", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["CNY"]).toBe(6.8);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestPath(0)).toBe("https://api.frankfurter.dev/v2/rates");
    expect(requestPath(1)).toBe("https://www.floatrates.com/daily/usd.json");

    const cached = JSON.parse(localStorage.getItem("exchange_rates_cache_v2") ?? "{}") as {
      provider?: string;
      requestedProvider?: string;
    };
    expect(cached["provider"]).toBe("floatrates");
    expect(cached["requestedProvider"]).toBe("frankfurter");
  });

  it("falls back to FloatRates when Frankfurter has a contract error", async () => {
    const rows = makeFrankfurterV2Rows().filter((row) => row.quote !== "CNY");
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(rows))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["CNY"]).toBe(6.8);
  });

  it("falls back to Frankfurter when FloatRates fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse({ cny: undefined })))
      .mockResolvedValueOnce(jsonResponse(makeFrankfurterV2Rows()));

    const { result } = renderHook(() => useExchangeRates("floatrates"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("frankfurter");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(requestPath(1)).toBe("https://api.frankfurter.dev/v2/rates");
  });

  it("ignores unknown fields in Frankfurter v2 rows", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(
      makeFrankfurterV2Rows().map((row) => ({
        ...row,
        amount: 1,
        provider: "frankfurter",
      })),
    ));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.rates["CNY"]).toBe(6.8);
  });

  it("rejects dirty cache and falls back when both remote providers fail", async () => {
    localStorage.setItem("exchange_rates_cache_v2", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { EUR: "oops" },
      cachedAt: Date.now(),
      requestedProvider: "floatrates",
      provider: "floatrates",
    }));
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useExchangeRates());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("网络请求失败");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing currency", () => {
      const response = makeFloatRatesResponse();
      delete response["cny"];
      return response;
    }],
    ["alphaCode/key mismatch", () => makeFloatRatesResponse({
      cny: { alphaCode: "EUR", rate: 6.8, date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
    ["impossible key shape", () => makeFloatRatesResponse({
      cny: undefined,
      cny_extra: { alphaCode: "CNY", rate: 6.8, date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
    ["string rate", () => makeFloatRatesResponse({
      cny: { alphaCode: "CNY", rate: "oops", date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
    ["non-positive rate", () => makeFloatRatesResponse({
      cny: { alphaCode: "CNY", rate: 0, date: "Fri, 15 May 2026 23:55:05 GMT" },
    })],
  ])("reports contract errors when FloatRates has %s and Frankfurter also fails", async (_caseName, makePayload) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(makePayload()))
      .mockRejectedValueOnce(new Error("frankfurter down"));

    const { result } = renderHook(() => useExchangeRates("floatrates"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("汇率响应格式异常");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it.each([
    ["duplicate quote", () => [...makeFrankfurterV2Rows(), makeFrankfurterV2Rows()[0]]],
    ["non-USD base", () => makeFrankfurterV2Rows().map((row, index) => index === 0 ? { ...row, base: "EUR" } : row)],
    ["string rate", () => makeFrankfurterV2Rows().map((row, index) => index === 0 ? { ...row, rate: "oops" } : row)],
    ["non-positive rate", () => makeFrankfurterV2Rows().map((row, index) => index === 0 ? { ...row, rate: 0 } : row)],
  ])("reports contract errors when Frankfurter has %s and FloatRates also fails", async (_caseName, makeRows) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(makeRows()))
      .mockRejectedValueOnce(new Error("floatrates down"));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("汇率响应格式异常");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it("falls back to FloatRates for Frankfurter HTTP failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it("falls back to FloatRates when Frankfurter times out", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockResolvedValueOnce(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.activeProvider).toBe("floatrates");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back with the timeout message when both providers time out", async () => {
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
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("请求超时，请稍后重试");
    expect(result.current.activeProvider).toBe("builtin");
    expect(result.current.rates["USD"]).toBe(1);
  });

  it("refresh skips cache and can use the new requested provider immediately", async () => {
    localStorage.setItem("exchange_rates_cache_v2", JSON.stringify({
      base: "USD",
      date: "2026-01-01",
      rates: { EUR: 0.9, CNY: 7, USD: 1 },
      cachedAt: Date.now(),
      requestedProvider: "frankfurter",
      provider: "frankfurter",
    }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(makeFloatRatesResponse()));

    const { result } = renderHook(() => useExchangeRates("frankfurter"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh("floatrates");
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestPath(0)).toBe("https://www.floatrates.com/daily/usd.json");
    expect(result.current.activeProvider).toBe("floatrates");

    const cached = JSON.parse(localStorage.getItem("exchange_rates_cache_v2") ?? "{}") as {
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

    const { result, unmount } = renderHook(() => useExchangeRates("frankfurter"));

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
