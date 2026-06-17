// Worker 订阅 mapper 测试保护 D1 行契约，避免新增字段在 create/update/import/export 边界漂移。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptionNormalizationFixtures } from "@renewlet/shared/contract-fixtures";
import { toApiSubscription } from "./db";
import { toSubscriptionRow, updateSubscription, type SubscriptionBody } from "./subscriptions";
import type { Env, SubscriptionRow } from "./types";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

vi.mock("./auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

const USER_ID = "usr_subscription_owner";

function subscriptionBody(overrides: Partial<SubscriptionBody> = {}): SubscriptionBody {
  return {
    name: "Three Year Plan",
    logo: null,
    price: 360,
    currency: "USD",
    billingCycle: "monthly",
    customDays: null,
    customCycleUnit: null,
    oneTimeTermCount: null,
    oneTimeTermUnit: null,
    category: "productivity",
    status: "active",
    pinned: false,
    publicHidden: false,
    paymentMethod: null,
    startDate: "2026-05-14",
    nextBillingDate: "2029-05-14",
    autoRenew: false,
    autoCalculateNextBillingDate: true,
    trialEndDate: null,
    website: null,
    notes: null,
    tags: [],
    reminderDays: 3,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    extra: {},
    ...overrides,
  };
}

describe("Cloudflare subscription mapper", () => {
  beforeEach(() => {
    authMocks.requireAuth.mockReset();
    authMocks.requireAuth.mockResolvedValue({
      user: { id: USER_ID },
      session: { id: "ses" },
      token: "test",
    });
  });

  it.each(subscriptionNormalizationFixtures)("matches shared normalization fixture $name", (fixture) => {
    const body = subscriptionBody(fixture.input);
    const row = toSubscriptionRow("sub_fixture", "usr_fixture", body, "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");
    const apiSubscription = toApiSubscription(row);

    expect(row.custom_days).toBe(fixture.expected.customDays);
    expect(row.custom_cycle_unit).toBe(fixture.expected.customCycleUnit);
    expect(row.one_time_term_count).toBe(fixture.expected.oneTimeTermCount);
    expect(row.one_time_term_unit).toBe(fixture.expected.oneTimeTermUnit);
    expect(apiSubscription.autoRenew).toBe(fixture.expected.autoRenew);
    expect(apiSubscription.autoCalculateNextBillingDate).toBe(fixture.expected.autoCalculateNextBillingDate);
  });

  it("persists and exposes custom cycle units", () => {
    const row = toSubscriptionRow("sub_custom", "usr_custom", subscriptionBody({
      billingCycle: "custom",
      customDays: 3,
      customCycleUnit: "year",
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    expect(row.custom_days).toBe(3);
    expect(row.custom_cycle_unit).toBe("year");
    expect(toApiSubscription(row)).toMatchObject({
      billingCycle: "custom",
      customDays: 3,
      customCycleUnit: "year",
    });
  });

  it("clears custom fields for fixed cycles", () => {
    const row = toSubscriptionRow("sub_monthly", "usr_custom", subscriptionBody({
      billingCycle: "monthly",
      customDays: 45,
      customCycleUnit: "week",
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    const apiSubscription = toApiSubscription(row);

    expect(row.custom_days).toBeNull();
    expect(row.custom_cycle_unit).toBeNull();
    expect(apiSubscription).not.toHaveProperty("customDays");
    expect(apiSubscription).not.toHaveProperty("customCycleUnit");
  });

  it("persists one-time fixed terms and exposes them through the API mapper", () => {
    const row = toSubscriptionRow("sub_one_time", "usr_custom", subscriptionBody({
      billingCycle: "one-time",
      oneTimeTermCount: 6,
      oneTimeTermUnit: "month",
      customDays: 45,
      customCycleUnit: "week",
      autoCalculateNextBillingDate: true,
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    expect(row.custom_days).toBeNull();
    expect(row.custom_cycle_unit).toBeNull();
    expect(row.one_time_term_count).toBe(6);
    expect(row.one_time_term_unit).toBe("month");
    expect(row.auto_renew).toBe(0);
    expect(row.auto_calculate_next_billing_date).toBe(0);
    expect(toApiSubscription(row)).toMatchObject({
      billingCycle: "one-time",
      oneTimeTermCount: 6,
      oneTimeTermUnit: "month",
      autoRenew: false,
      autoCalculateNextBillingDate: false,
    });
  });

  it("defaults D1 rows to manual renewal while preserving explicit auto renewal", () => {
    const manual = toSubscriptionRow("sub_manual", "usr_custom", subscriptionBody(), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");
    const auto = toSubscriptionRow("sub_auto", "usr_custom", subscriptionBody({
      autoRenew: true,
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    expect(manual.auto_renew).toBe(0);
    expect(toApiSubscription(manual)).toMatchObject({
      autoRenew: false,
    });
    expect(auto.auto_renew).toBe(1);
    expect(toApiSubscription(auto)).toMatchObject({
      autoRenew: true,
    });
  });

  it("persists disabled reminder days through the API mapper", () => {
    const row = toSubscriptionRow("sub_quiet", "usr_custom", subscriptionBody({
      reminderDays: -2,
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    expect(row.reminder_days).toBe(-2);
    expect(toApiSubscription(row)).toMatchObject({
      reminderDays: -2,
    });
  });

  it("persists public hidden through the API mapper", () => {
    const row = toSubscriptionRow("sub_private", "usr_custom", subscriptionBody({
      publicHidden: true,
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    expect(row.public_hidden).toBe(1);
    expect(toApiSubscription(row)).toMatchObject({
      publicHidden: true,
    });
  });

  it("normalizes dirty tags_json while applying a subscription PATCH", async () => {
    const existing = {
      ...toSubscriptionRow("sub_dirty_tags", USER_ID, subscriptionBody({ tags: ["legacy"] }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z"),
      tags_json: "{dirty-json",
    } satisfies SubscriptionRow;
    let updateValues: unknown[] | null = null;
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => ({
            first: async <T>() => sql.includes("FROM subscriptions") ? existing as T : null,
            run: async () => {
              updateValues = values;
              return { success: true, meta: { changes: 1 }, results: [] } as unknown as D1Result;
            },
          }),
        }),
      } as unknown as D1Database,
      ASSETS: {} as Fetcher,
      ASSETS_BUCKET: {} as R2Bucket,
    } satisfies Env;

    const response = await updateSubscription(new Request("https://renewlet.test/api/app/subscriptions/sub_dirty_tags", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ notes: "updated" }),
    }), env, "sub_dirty_tags");
    const body = await response.json() as { subscription: { tags: string[] } };

    expect(response.status).toBe(200);
    expect(body.subscription.tags).toEqual([]);
    expect(updateValues?.[21]).toBe("[]");
  });

  it("clears one-time term fields for recurring subscriptions", () => {
    const row = toSubscriptionRow("sub_monthly", "usr_custom", subscriptionBody({
      billingCycle: "monthly",
      oneTimeTermCount: 6,
      oneTimeTermUnit: "month",
    }), "2026-06-05T00:00:00.000Z", "2026-06-05T00:00:00.000Z");

    const apiSubscription = toApiSubscription(row);

    expect(row.one_time_term_count).toBeNull();
    expect(row.one_time_term_unit).toBeNull();
    expect(apiSubscription).not.toHaveProperty("oneTimeTermCount");
    expect(apiSubscription).not.toHaveProperty("oneTimeTermUnit");
  });

  it("adds custom_cycle_unit through the standalone migration only", () => {
    // D1 migration 必须保持增量拆分；一键部署和本地 migration 都依赖旧库逐步补列，而不是重建初始表。
    const initialMigration = readFileSync(resolve("migrations/0001_initial.sql"), "utf8");
    const customUnitMigration = readFileSync(resolve("migrations/0007_subscription_custom_cycle_unit.sql"), "utf8");
    const oneTimeTermMigration = readFileSync(resolve("migrations/0008_subscription_one_time_term.sql"), "utf8");
    const publicStatusMigration = readFileSync(resolve("migrations/0009_public_status.sql"), "utf8");
    const autoRenewMigration = readFileSync(resolve("migrations/0010_subscription_auto_renew.sql"), "utf8");
    const logoIndexMigration = readFileSync(resolve("migrations/0014_subscription_logo_index.sql"), "utf8");
    const notificationIndexesMigration = readFileSync(resolve("migrations/0016_notification_scheduler_indexes.sql"), "utf8");

    expect(initialMigration).not.toContain("custom_cycle_unit");
    expect(initialMigration).not.toContain("one_time_term");
    expect(initialMigration).not.toContain("public_hidden");
    expect(initialMigration).not.toContain("public_status_pages");
    expect(initialMigration).not.toContain("auto_renew");
    expect(customUnitMigration.trim()).toBe("ALTER TABLE subscriptions ADD COLUMN custom_cycle_unit TEXT;");
    expect(oneTimeTermMigration.trim()).toBe([
      "ALTER TABLE subscriptions ADD COLUMN one_time_term_count INTEGER;",
      "ALTER TABLE subscriptions ADD COLUMN one_time_term_unit TEXT;",
    ].join("\n"));
    expect(publicStatusMigration).toContain("ALTER TABLE subscriptions ADD COLUMN public_hidden INTEGER NOT NULL DEFAULT 0;");
    expect(publicStatusMigration).toContain("CREATE TABLE IF NOT EXISTS public_status_pages");
    expect(autoRenewMigration).toContain("ALTER TABLE subscriptions ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0;");
    expect(autoRenewMigration).toContain("UPDATE subscriptions SET auto_renew = 0 WHERE billing_cycle = 'one-time';");
    expect(logoIndexMigration.trim()).toBe("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_logo ON subscriptions (user_id, logo);");
    expect(notificationIndexesMigration).toContain("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_auto_renew_due");
    expect(notificationIndexesMigration).toContain("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_reminder_due");
    expect(notificationIndexesMigration).toContain("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_trial_reminder");
    expect(notificationIndexesMigration).toContain("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_repeat_reminder");
  });
});
