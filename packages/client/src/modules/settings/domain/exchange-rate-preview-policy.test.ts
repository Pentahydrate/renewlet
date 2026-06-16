import { describe, expect, it } from "vitest";
import type { ConfigItem } from "@/types/config";
import {
  getDirectExchangeRateQuote,
  getExchangeRatePreviewCurrencies,
} from "./exchange-rate-preview-policy";

const currency = (value: string, enabled = true): ConfigItem => ({
  id: value,
  value,
  labels: {
    "zh-CN": value,
    "en-US": value,
  },
  enabled,
});

const values = (items: readonly ConfigItem[]) => items.map((item) => item.value);

describe("getExchangeRatePreviewCurrencies", () => {
  it("uses the primary common-currency order when CNY is the default currency", () => {
    // 汇率预览使用固定常用货币顺序，不继承用户配置顺序，保证设置页信息密度稳定。
    const currencies = [
      currency("AED"),
      currency("AFN"),
      currency("USD"),
      currency("EUR"),
      currency("GBP"),
      currency("AUD"),
      currency("TRY"),
      currency("NGN"),
      currency("ARS"),
      currency("PHP"),
      currency("JPY"),
    ];

    expect(values(getExchangeRatePreviewCurrencies(currencies, "CNY"))).toEqual([
      "USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP",
    ]);
  });

  it("fills disabled primary currencies from the common fallback pool", () => {
    // 主推荐币种被禁用时从 fallback 池补齐，而不是展示不可用币种占位。
    const currencies = [
      "USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP",
      "JPY", "CNY", "CAD", "CHF", "HKD", "SGD", "NZD", "SEK", "NOK",
    ].map((value) => currency(
      value,
      !["USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP"].includes(value),
    ));

    expect(values(getExchangeRatePreviewCurrencies(currencies, "CNY"))).toEqual([
      "JPY", "CAD", "CHF", "HKD", "SGD", "NZD", "SEK", "NOK",
    ]);
  });

  it("shows CNY first when USD is the default currency", () => {
    const currencies = [
      "USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP", "JPY", "CNY",
    ].map((value) => currency(value));

    expect(values(getExchangeRatePreviewCurrencies(currencies, "USD"))).toEqual([
      "CNY", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP",
    ]);
  });

  it("shows CNY first and skips the default currency when another common currency is selected", () => {
    const currencies = [
      "USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP", "JPY", "CNY",
    ].map((value) => currency(value));

    expect(values(getExchangeRatePreviewCurrencies(currencies, "EUR"))).toEqual([
      "CNY", "USD", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP",
    ]);
  });

  it("skips disabled CNY and fills the preview to the requested limit", () => {
    const currencies = [
      currency("CNY", false),
      ...["USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP", "JPY"]
        .map((value) => currency(value)),
    ];

    expect(values(getExchangeRatePreviewCurrencies(currencies, "USD"))).toEqual([
      "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP", "JPY",
    ]);
  });

  it("skips missing CNY without duplicating fallback entries", () => {
    const currencies = [
      "USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP", "JPY",
    ].map((value) => currency(value));

    expect(values(getExchangeRatePreviewCurrencies(currencies, "USD"))).toEqual([
      "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP", "JPY",
    ]);
  });

  it("does not inherit a custom or alphabetical config order", () => {
    const currencies = [
      "PHP", "ARS", "NGN", "TRY", "AUD", "GBP", "EUR", "USD", "AED", "AFN",
    ].map((value) => currency(value));

    expect(values(getExchangeRatePreviewCurrencies(currencies, "CNY"))).toEqual([
      "USD", "EUR", "GBP", "AUD", "TRY", "NGN", "ARS", "PHP",
    ]);
  });

  it("skips missing currencies without duplicating fallback entries", () => {
    const currencies = [
      currency("USD"),
      currency("USD"),
      currency("GBP"),
      currency("JPY"),
      currency("CAD"),
      currency("CHF"),
    ];

    expect(values(getExchangeRatePreviewCurrencies(currencies, "CNY"))).toEqual([
      "USD", "GBP", "JPY", "CAD", "CHF",
    ]);
  });

  it("returns an empty preview when all candidate currencies are unavailable", () => {
    const currencies = [
      currency("USD", false),
      currency("EUR", false),
      currency("AFN"),
    ];

    expect(getExchangeRatePreviewCurrencies(currencies, "CNY")).toEqual([]);
  });
});

describe("getDirectExchangeRateQuote", () => {
  it("quotes one foreign currency unit in the reporting currency", () => {
    expect(getDirectExchangeRateQuote({ USD: 1, CNY: 6.78 }, "USD", "CNY")).toBeCloseTo(6.78);
    expect(getDirectExchangeRateQuote({ USD: 1, CNY: 6.78 }, "CNY", "USD")).toBeCloseTo(0.1475, 4);
  });

  it("supports reporting currencies other than CNY", () => {
    expect(getDirectExchangeRateQuote({ USD: 1, EUR: 0.92 }, "EUR", "USD")).toBeCloseTo(1.087, 3);
  });

  it("falls back to 1 for missing rates without producing invalid numbers", () => {
    expect(getDirectExchangeRateQuote({ CNY: 6.78 }, "USD", "CNY")).toBe(6.78);
    expect(Number.isFinite(getDirectExchangeRateQuote({}, "USD", "CNY"))).toBe(true);
  });
});
