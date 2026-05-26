import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import { DEFAULT_SETTINGS, MAX_REMINDER_DAYS, type Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import { translate } from "@/i18n/messages";
import { parseJsonText } from "./wallos-import";
import { formatImportMessage } from "./import-message-format";

const context = {
  config: DEFAULT_CUSTOM_CONFIG,
  settings: DEFAULT_SETTINGS,
  today: assertDateOnly("2026-05-21"),
};

describe("wallos import", () => {
  it("parses legacy Renewlet bare subscription arrays", async () => {
    const prepared = await parseJsonText(JSON.stringify([
      {
        id: "03v2x7u3pyafogh",
        name: "Docker",
        logo: "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/docker/default.svg",
        price: 10,
        currency: "USD",
        category: "productivity",
        status: "active",
        startDate: "2026-04-16",
        nextBillingDate: "2026-06-16",
        autoCalculateNextBillingDate: true,
        trialEndDate: null,
        tags: [],
        reminderDays: 3,
        repeatReminderEnabled: false,
        repeatReminderInterval: "1h",
        repeatReminderWindow: "72h",
        billingCycle: "monthly",
      },
      {
        id: "qu10wug84u2y1fe",
        name: "Linear Business",
        price: 16,
        currency: "USD",
        category: "business",
        status: "active",
        paymentMethod: "google_pay",
        startDate: "2026-02-14",
        nextBillingDate: "2026-06-18",
        autoCalculateNextBillingDate: false,
        trialEndDate: null,
        website: "https://linear.app",
        tags: ["Issues", "Planning"],
        reminderDays: 7,
        repeatReminderEnabled: false,
        repeatReminderInterval: "1h",
        repeatReminderWindow: "72h",
        billingCycle: "monthly",
      },
    ]), context);

    expect(prepared.payload.source).toBe("renewlet");
    expect(prepared.payload.subscriptions).toHaveLength(2);
    expect(prepared.payload.subscriptions[0]?.name).toBe("Docker");
    expect(prepared.payload.subscriptions[0]?.extra.import.sourceId).toBe("03v2x7u3pyafogh");
    expect(prepared.payload.subscriptions[1]?.paymentMethod).toBe("google_pay");
  });

  it("parses legacy Renewlet JSON and fills current import defaults", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      subscriptions: [{
        id: "legacy-1",
        name: "Legacy Netflix",
        price: 15.99,
        currency: "usd",
        billingCycle: "monthly",
        category: "streaming",
        status: "active",
        startDate: "2026-01-01",
        nextBillingDate: "2026-06-01",
        autoCalculateNextBillingDate: true,
        reminderDays: 5,
      }],
    }), context);

    const subscription = prepared.payload.subscriptions[0];

    expect(prepared.payload.source).toBe("renewlet");
    expect(subscription?.extra.import).toEqual({
      source: "renewlet",
      sourceId: "legacy-1",
      confidence: "high",
    });
    expect(subscription?.repeatReminderEnabled).toBe(false);
    expect(subscription?.repeatReminderInterval).toBe("1h");
    expect(subscription?.repeatReminderWindow).toBe("72h");
    expect(prepared.payload.settings).toBeUndefined();
    expect(prepared.payload.customConfig).toBeUndefined();
  });

  it("supports legacy Renewlet data nested under data", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      data: {
        subscriptions: [{
          name: "Legacy Tool",
          price: 49,
          currency: "EUR",
          billingCycle: "annual",
          category: "business",
          status: "trial",
          startDate: "2026-02-01",
          nextBillingDate: "2026-08-01",
        }],
      },
    }), context);

    expect(prepared.payload.source).toBe("renewlet");
    expect(prepared.payload.subscriptions[0]?.extra.import.sourceId).toMatch(/^legacy:/);
  });

  it("drops unsupported legacy Renewlet logos and formats the warning", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      subscriptions: [{
        id: "legacy-logo",
        name: "Legacy Logo",
        price: 3,
        currency: "CNY",
        billingCycle: "monthly",
        category: "other",
        status: "active",
        startDate: "2026-03-01",
        nextBillingDate: "2026-06-01",
        logo: "data:image/png;base64,AAAA",
      }],
    }), context);

    const formatted = prepared.warnings.map((warning) => formatImportMessage(warning, (key, params) => translate("zh-CN", key, params)));

    expect(prepared.payload.subscriptions[0]?.logo).toBeNull();
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Logo|IMPORT_WARNING_RENEWLET_LEGACY_LOGO_DROPPED");
    expect(formatted).toContain("Legacy Logo：旧版 Renewlet Logo 形态已不再支持，已清空，可在预览中重新指定。");
  });

  it("keeps supported legacy Renewlet logos and preserves asset paths", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      subscriptions: [
        {
          id: "legacy-http-logo",
          name: "Legacy HTTP Logo",
          price: 3,
          currency: "CNY",
          billingCycle: "monthly",
          category: "other",
          status: "active",
          startDate: "2026-03-01",
          nextBillingDate: "2026-06-01",
          reminderDays: 3,
          repeatReminderInterval: "1h",
          repeatReminderWindow: "72h",
          logo: "https://cdn.example.com/logo.png",
        },
        {
          id: "legacy-asset-logo",
          name: "Legacy Asset Logo",
          price: 3,
          currency: "CNY",
          billingCycle: "monthly",
          category: "other",
          status: "active",
          startDate: "2026-03-01",
          nextBillingDate: "2026-06-01",
          reminderDays: 3,
          repeatReminderInterval: "1h",
          repeatReminderWindow: "72h",
          logo: "/api/app/assets/asset_123",
        },
      ],
    }), context);

    expect(prepared.payload.subscriptions[0]?.logo).toBe("https://cdn.example.com/logo.png");
    expect(prepared.payload.subscriptions[1]?.logo).toBe("/api/app/assets/asset_123");
    expect(prepared.warnings).toHaveLength(0);
  });

  it("warns when legacy Renewlet fallbacks change unsafe field values", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      subscriptions: [{
        id: "legacy-invalid",
        name: "Legacy Invalid",
        price: "bad",
        currency: "US",
        billingCycle: "unknown",
        category: "other",
        status: "sleeping",
        startDate: "2026-02-31",
        nextBillingDate: "2026-06-31",
        trialEndDate: "2026-13-01",
        website: "bad-url with spaces",
        reminderDays: MAX_REMINDER_DAYS + 1,
        repeatReminderInterval: "2h",
        repeatReminderWindow: "forever",
        tags: ["a".repeat(60), "", 42],
      }],
    }), context);

    const subscription = prepared.payload.subscriptions[0];

    expect(subscription).toMatchObject({
      price: 0,
      currency: "USD",
      billingCycle: "monthly",
      status: "active",
      startDate: context.today,
      nextBillingDate: context.today,
      trialEndDate: null,
      website: null,
      reminderDays: MAX_REMINDER_DAYS,
      repeatReminderInterval: "1h",
      repeatReminderWindow: "72h",
    });
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_INVALID_WEBSITE");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_PRICE_DEFAULTED");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_CURRENCY_DEFAULTED|USD");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_BILLING_CYCLE_DEFAULTED|monthly");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_STATUS_DEFAULTED|active");
    expect(prepared.warnings).toContain(`IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_DATE_INVALID|renewletStartDate|${context.today}`);
    expect(prepared.warnings).toContain(`IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_DATE_INVALID|renewletDueDate|${context.today}`);
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_DATE_INVALID|renewletTrialEndDate|empty");
    expect(prepared.warnings).toContain(`IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_REMINDER_DAYS_DEFAULTED|${MAX_REMINDER_DAYS}`);
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_REPEAT_INTERVAL_DEFAULTED|1h");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_REPEAT_WINDOW_DEFAULTED|72h");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_TAGS_TRIMMED");
  });

  it("keeps current Renewlet v1 exports on the schema-backed path", async () => {
    const subscription = {
      id: "current-1",
      name: "Current Backup",
      logo: undefined,
      price: 42,
      currency: "USD",
      billingCycle: "monthly",
      customDays: undefined,
      category: "developer_tools",
      status: "active",
      paymentMethod: undefined,
      startDate: assertDateOnly("2026-05-01"),
      nextBillingDate: assertDateOnly("2026-06-01"),
      autoCalculateNextBillingDate: true,
      trialEndDate: undefined,
      website: undefined,
      notes: undefined,
      tags: [],
      reminderDays: 3,
      repeatReminderEnabled: false,
      repeatReminderInterval: "1h",
      repeatReminderWindow: "72h",
      extra: {},
    } satisfies Subscription;

    const prepared = await parseJsonText(JSON.stringify({
      kind: "renewlet-export",
      schemaVersion: 1,
      exportedAt: "2026-05-26T00:00:00.000Z",
      data: {
        subscriptions: [subscription],
        settings: { defaultCurrency: "USD" },
        customConfig: DEFAULT_CUSTOM_CONFIG,
        assets: [],
      },
    }), context);

    expect(prepared.payload.source).toBe("renewlet");
    expect(prepared.payload.subscriptions[0]?.extra.import).toEqual({
      source: "renewlet",
      sourceId: "current-1",
      confidence: "high",
    });
    expect(prepared.payload.settings?.defaultCurrency).toBe("USD");
    expect(prepared.payload.customConfig?.statuses.some((item) => item.value === "expired")).toBe(true);
    expect(prepared.warnings).toHaveLength(0);
  });

  it("routes Wallos UI arrays to Wallos display import before any Renewlet legacy fallback", async () => {
    const prepared = await parseJsonText(JSON.stringify([
      {
        Name: "Wallos UI Row",
        Price: "$12.00",
        "Payment Cycle": "Monthly",
        "Next Payment": "2026-06-01",
        Category: "Developer",
        "Payment Method": "Visa",
      },
    ]), context);

    expect(prepared.payload.source).toBe("wallos");
    expect(prepared.payload.subscriptions[0]?.name).toBe("Wallos UI Row");
    expect(prepared.warnings).toContain("IMPORT_WARNING_WALLOS_DISPLAY_LOW_CONFIDENCE");
  });

  it("maps Wallos API subscriptions with source ids and custom cycles", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 12,
        user_id: 7,
        name: "GitHub",
        price: 4,
        currency_id: 1,
        start_date: "2026-01-01",
        next_payment: "2026-06-01",
        cycle: 2,
        frequency: 2,
        auto_renew: 1,
        inactive: 0,
        notify: 1,
        notify_days_before: -1,
        category_name: "Developer",
        payment_method_name: "Visa",
      }],
    }), context);

    expect(prepared.payload.source).toBe("wallos");
    expect(prepared.payload.subscriptions[0]?.billingCycle).toBe("custom");
    expect(prepared.payload.subscriptions[0]?.customDays).toBe(14);
    expect(prepared.payload.subscriptions[0]?.reminderDays).toBe(-1);
    expect(prepared.payload.subscriptions[0]?.extra.import.sourceId).toBe("7:12");
    expect(prepared.payload.subscriptions[0]?.logo).toBeNull();
    expect(prepared.payload.customConfig?.categories.some((item) => item.labels["en-US"] === "Developer")).toBe(true);
  });

  it("keeps explicit Wallos reminder days while mapping only -1 to inherited reminders", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [
        {
          id: 31,
          user_id: 7,
          name: "Inherited",
          price: 4,
          currency_id: 1,
          next_payment: "2026-06-01",
          cycle: 3,
          frequency: 1,
          inactive: 0,
          notify: 1,
          notify_days_before: -1,
        },
        {
          id: 32,
          user_id: 7,
          name: "Explicit",
          price: 8,
          currency_id: 1,
          next_payment: "2026-06-01",
          cycle: 3,
          frequency: 1,
          inactive: 0,
          notify: 1,
          notify_days_before: 7,
        },
      ],
    }), context);

    expect(prepared.payload.subscriptions.map((subscription) => subscription.reminderDays)).toEqual([-1, 7]);
  });

  it("imports Wallos categories with localized labels without rewriting Renewlet built-ins", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 13,
        user_id: 7,
        name: "Spotify",
        price: 10,
        next_payment: "2026-06-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
        category_name: "Music",
      }],
    }), context);

    const subscription = prepared.payload.subscriptions[0];
    const builtInMusic = prepared.payload.customConfig?.categories.find((item) => item.value === "music");
    const wallosMusic = prepared.payload.customConfig?.categories.find((item) => item.value === "wallos_category_music");

    expect(subscription?.category).toBe("wallos_category_music");
    expect(builtInMusic?.labels).toEqual({ "zh-CN": "音乐", "en-US": "Music" });
    expect(wallosMusic?.labels).toEqual({ "zh-CN": "音乐", "en-US": "Music" });
  });

  it("keeps unknown Wallos category labels as source text instead of guessing translations", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Team SaaS",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$19.99",
      Category: "Internal Ops",
      "Payment Method": "Card",
    }]), context);

    const category = prepared.payload.customConfig?.categories.find((item) => item.value === "wallos_category_internal_ops");

    expect(prepared.payload.subscriptions[0]?.category).toBe("wallos_category_internal_ops");
    expect(category?.labels).toEqual({ "zh-CN": "Internal Ops", "en-US": "Internal Ops" });
  });

  it("resolves Wallos yen symbol to CNY when display exports omit ISO code", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "¥68",
      Category: "Software",
      "Payment Method": "Card",
    }]), context);

    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
    expect(prepared.warnings.join("\n")).not.toContain("IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS");
  });

  it("does not fall back to USD for Wallos yen symbols when USD is the current default currency", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "¥10",
      Category: "Utilities",
      "Payment Method": "PayPal",
    }]), {
      ...context,
      settings: { ...DEFAULT_SETTINGS, defaultCurrency: "USD" },
      config: {
        ...DEFAULT_CUSTOM_CONFIG,
        currencies: DEFAULT_CUSTOM_CONFIG.currencies.filter((currency) => currency.value === "USD"),
      },
    });

    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
    expect(prepared.payload.subscriptions[0]?.currency).not.toBe("USD");
    expect(prepared.payload.customConfig?.currencies.some((currency) => currency.value === "CNY" && currency.enabled)).toBe(true);
    expect(prepared.warnings.join("\n")).not.toContain("IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS");
  });

  it("keeps the current default JPY when Wallos yen symbols are imported from a JPY workspace", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Apple Japan",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "￥980",
      Category: "Utilities",
      "Payment Method": "PayPal",
    }]), {
      ...context,
      settings: { ...DEFAULT_SETTINGS, defaultCurrency: "JPY" },
    });

    expect(prepared.payload.subscriptions[0]?.currency).toBe("JPY");
  });

  it("uses Wallos default currency ids when API payloads do not include a currencies table", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 20,
        user_id: 1,
        name: "RMB Service",
        price: 12,
        currency_id: 20,
        next_payment: "2026-07-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
      }],
    }), context);

    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
  });

  it("uses merged Wallos API lookup tables when subscriptions include only ids", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      users: [{ id: 2, username: "ethan" }],
      currencies: [{ id: 54, code: "JPY", symbol: "¥" }],
      categories: [{ id: 77, name: "Utilities" }],
      payment_methods: [{ id: 88, name: "PayPal" }],
      household: [{ id: 99, name: "Alex" }],
      subscriptions: [{
        id: 21,
        user_id: 2,
        name: "Apple",
        price: 10,
        currency_id: 54,
        category_id: 77,
        payment_method_id: 88,
        payer_user_id: 99,
        next_payment: "2026-07-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
      }],
    }), context);

    const subscription = prepared.payload.subscriptions[0];

    expect(subscription?.currency).toBe("JPY");
    expect(subscription?.category).toBe("wallos_category_utilities");
    expect(subscription?.paymentMethod).toBe("paypal");
    expect(subscription?.notes).toContain("Wallos paid by: Alex");
  });

  it("maps Wallos default payment methods to Renewlet built-ins", async () => {
    const wallosDefaults = [
      ["Direct Debit", "direct_debit"],
      ["Money", "money"],
      ["Samsung Pay", "samsung_pay"],
      ["Klarna", "klarna"],
      ["Amazon Pay", "amazon_pay"],
      ["SEPA", "sepa"],
      ["Skrill", "skrill"],
      ["Sofort", "sofort"],
      ["Stripe", "stripe"],
      ["Affirm", "affirm"],
      ["Elo", "elo"],
      ["Facebook Pay", "facebook_pay"],
      ["GiroPay", "giropay"],
      ["iDeal", "ideal"],
      ["Union Pay", "union_pay"],
      ["Interac", "interac"],
      ["Paysafe", "paysafe"],
      ["Poli", "poli"],
      ["Qiwi", "qiwi"],
      ["ShopPay", "shop_pay"],
      ["Venmo", "venmo"],
      ["VeriFone", "verifone"],
      ["WebMoney", "webmoney"],
    ] as const;
    const prepared = await parseJsonText(JSON.stringify(wallosDefaults.map(([name], index) => ({
      Name: `Payment ${index}`,
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$10",
      Category: "Software",
      "Payment Method": name,
    }))), context);

    expect(prepared.payload.subscriptions.map((subscription) => subscription.paymentMethod)).toEqual(wallosDefaults.map(([, value]) => value));
    expect(prepared.payload.customConfig?.paymentMethods.some((item) => item.value.startsWith("wallos_payment_"))).toBe(false);
  });

  it("maps Wallos one-time purchases to native one-time billing without cancelling them", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 21,
        user_id: 1,
        name: "Lifetime Tool",
        price: 199,
        currency_id: 2,
        next_payment: "2026-07-01",
        cycle: 5,
        frequency: 1,
        inactive: 0,
      }],
    }), context);
    const subscription = prepared.payload.subscriptions[0];

    expect(subscription?.billingCycle).toBe("one-time");
    expect(subscription?.customDays).toBeNull();
    expect(subscription?.status).toBe("active");
    expect(subscription?.autoCalculateNextBillingDate).toBe(false);
    expect(subscription?.extra["wallos"]).toMatchObject({ oneTime: true });
  });

  it("formats Wallos API and database warnings instead of showing raw warning codes", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 22,
        user_id: 1,
        name: "Lifetime Tool",
        price: 199,
        currency_id: 2,
        next_payment: "2026-07-01",
        cycle: 5,
        frequency: 1,
        inactive: 0,
        notify: 0,
      }],
    }), context);
    const formatted = prepared.warnings.map((warning) => formatImportMessage(warning, (key, params) => translate("zh-CN", key, params)));

    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Lifetime Tool|IMPORT_WARNING_WALLOS_ONE_TIME");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Lifetime Tool|IMPORT_WARNING_WALLOS_NOTIFY_DISABLED");
    expect(formatted).toContain("Lifetime Tool：一次性购买已按买断记录导入，不参与自动续费。");
    expect(formatted).toContain("Lifetime Tool：Wallos 这条订阅关闭了通知；Renewlet 没有单条通知开关，已保留默认提前 3 天提醒。");
    expect(formatted.join("\n")).not.toContain("IMPORT_WARNING_WALLOS");
  });

  it("maps Wallos empty category names to Renewlet other without adding a custom category", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Unsorted",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$1.99",
      Category: "无分类",
      "Payment Method": "Card",
    }]), context);

    expect(prepared.payload.subscriptions[0]?.category).toBe("other");
    expect(prepared.payload.customConfig?.categories.some((item) => item.value.startsWith("wallos_category_"))).toBe(false);
  });

  it("marks Wallos display export as low confidence", async () => {
    const prepared = await parseJsonText(JSON.stringify([
      {
        Name: "Netflix",
        "Payment Cycle": "Every 3 Months",
        "Next Payment": "2026-07-01",
        Price: "$15.99",
        Category: "Streaming",
        "Payment Method": "PayPal",
        "Paid By": "Alex",
        Active: "Yes",
      },
    ]), context);

    const subscription = prepared.payload.subscriptions[0];
    expect(subscription?.billingCycle).toBe("quarterly");
    expect(subscription?.paymentMethod).toBe("paypal");
    expect(subscription?.notes).toContain("Wallos paid by: Alex");
    expect(subscription?.extra.import.confidence).toBe("low");
    expect(prepared.warnings).toContain("IMPORT_WARNING_WALLOS_DISPLAY_LOW_CONFIDENCE");
  });

  it("keeps Wallos display source ids stable when payment values change", async () => {
    const first = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$9.99",
      Category: "Software",
      "Payment Method": "Card",
    }]), context);
    const second = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-08-01",
      Price: "$12.99",
      Category: "Software",
      "Payment Method": "Card",
    }]), context);

    expect(first.payload.subscriptions[0]?.extra.import.sourceId).toBe(second.payload.subscriptions[0]?.extra.import.sourceId);
  });

  it("keeps Wallos URL without assigning guessed logo candidates", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 9,
        name: "Custom Service",
        price: 8,
        next_payment: "2026-06-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
        notify: 1,
        url: "https://billing.example.app/account",
      }],
    }), context);

    expect(prepared.payload.subscriptions[0]?.website).toBe("https://billing.example.app/account");
    expect(prepared.payload.subscriptions[0]?.logo).toBeNull();
  });
});
