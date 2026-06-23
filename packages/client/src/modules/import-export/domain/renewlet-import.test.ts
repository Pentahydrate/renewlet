// Renewlet 导入测试保护正式导出格式和旧导入桥的收敛边界，确保彻底转换后不放宽新契约。
import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import { DEFAULT_SETTINGS, MAX_REMINDER_DAYS, type Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import { renewletExportV1Schema } from "@/lib/api/schemas/import-export";
import { translate } from "@/i18n/messages";
import { parseJsonText } from "./wallos-import";
import { formatImportMessage } from "./import-message-format";
import { subscriptionToExportRow } from "./import-export-model";

const context = {
  config: DEFAULT_CUSTOM_CONFIG,
  settings: DEFAULT_SETTINGS,
  today: assertDateOnly("2026-05-21"),
};

const currentExportSubscription = {
  id: "current-1",
  name: "Current Backup",
  logo: undefined,
  price: 42,
  currency: "USD",
  billingCycle: "monthly",
  customDays: undefined,
  customCycleUnit: undefined,
  category: "developer_tools",
  status: "active",
  pinned: true,
  publicHidden: false,
  paymentMethod: undefined,
  startDate: assertDateOnly("2026-05-01"),
  nextBillingDate: assertDateOnly("2026-06-01"),
  autoRenew: true,
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

describe("renewlet import", () => {
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
    expect(subscription?.autoRenew).toBe(false);
    expect(prepared.payload.settings).toBeUndefined();
    expect(prepared.payload.customConfig).toBeUndefined();
  });

  it("preserves explicit legacy Renewlet autoRenew values", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      subscriptions: [
        {
          id: "legacy-auto",
          name: "Legacy Auto",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          category: "productivity",
          status: "active",
          startDate: "2026-01-01",
          nextBillingDate: "2026-02-01",
          autoRenew: true,
        },
        {
          id: "legacy-manual",
          name: "Legacy Manual",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          category: "productivity",
          status: "active",
          startDate: "2026-01-01",
          nextBillingDate: "2026-02-01",
          autoRenew: false,
        },
      ],
    }), context);

    expect(prepared.payload.subscriptions.map((subscription) => subscription.autoRenew)).toEqual([true, false]);
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
      startDate: null,
      nextBillingDate: context.today,
      autoCalculateNextBillingDate: false,
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
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_DATE_INVALID|renewletStartDate|empty");
    expect(prepared.warnings).toContain(`IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_DATE_INVALID|renewletDueDate|${context.today}`);
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_DATE_INVALID|renewletTrialEndDate|empty");
    expect(prepared.warnings).toContain(`IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_REMINDER_DAYS_DEFAULTED|${MAX_REMINDER_DAYS}`);
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_REPEAT_INTERVAL_DEFAULTED|1h");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_REPEAT_WINDOW_DEFAULTED|72h");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Legacy Invalid|IMPORT_WARNING_RENEWLET_LEGACY_TAGS_TRIMMED");
  });

  it("accepts disabled reminder days from legacy Renewlet imports", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      subscriptions: [{
        id: "legacy-quiet",
        name: "Legacy Quiet",
        price: 10,
        currency: "USD",
        billingCycle: "monthly",
        category: "productivity",
        status: "active",
        startDate: "2026-01-01",
        nextBillingDate: "2026-02-01",
        reminderDays: -2,
      }],
    }), context);

    expect(prepared.payload.subscriptions[0]?.reminderDays).toBe(-2);
  });

  it("builds current Renewlet v1 export rows that satisfy schema and keep pinned", () => {
    const row = subscriptionToExportRow(currentExportSubscription);

    const parsed = renewletExportV1Schema.parse({
      kind: "renewlet-export",
      schemaVersion: 1,
      exportedAt: "2026-05-26T00:00:00.000Z",
      data: {
        subscriptions: [row],
        settings: { defaultCurrency: "USD" },
        customConfig: DEFAULT_CUSTOM_CONFIG,
        assets: [],
      },
    });

    expect(row.pinned).toBe(true);
    expect(parsed.data.subscriptions[0]?.pinned).toBe(true);
  });

  it("keeps current Renewlet v1 exports on the schema-backed path", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      kind: "renewlet-export",
      schemaVersion: 1,
      exportedAt: "2026-05-26T00:00:00.000Z",
      data: {
        subscriptions: [currentExportSubscription],
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
    expect(prepared.payload.subscriptions[0]?.pinned).toBe(true);
    expect(prepared.payload.settings?.defaultCurrency).toBe("USD");
    expect(prepared.payload.customConfig?.statuses.some((item) => item.value === "expired")).toBe(true);
    expect(prepared.warnings).toHaveLength(0);
  });
});
