// Worker 手动续订测试保护 owner 过滤和状态推进，避免 Cloudflare API 与 Go/PocketBase route 分叉。
import { afterEach, describe, expect, it, vi } from "vitest";
import { renewSubscription } from "./subscriptions";
import type { Env, SubscriptionRow } from "./types";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

vi.mock("./auth", () => ({
  requireAuth: authMocks.requireAuth,
}));

function requestFixture(body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "x-renewlet-locale": "en-US",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://renewlet.test/api/app/subscriptions/sub_manual/renew", init);
}

function envFixture(row: SubscriptionRow | null) {
  // 捕获 lookup/update 参数，确保手动续订在 SQL 层按 owner 过滤，不能先读全局记录再在内存判断。
  let subscriptionLookupParams: unknown[] | null = null;
  let updateParams: unknown[] | null = null;
  const env = {
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: vi.fn(async () => {
            if (sql.includes("FROM subscriptions")) {
              subscriptionLookupParams = params;
              return row;
            }
            if (sql.includes("SELECT settings_json FROM settings")) {
              return null;
            }
            throw new Error(`unexpected first query: ${sql}`);
          }),
          run: vi.fn(async () => {
            if (sql.includes("UPDATE subscriptions SET next_billing_date")) {
              updateParams = params;
              return { success: true, meta: { changes: 1 } };
            }
            throw new Error(`unexpected run query: ${sql}`);
          }),
        }),
      })),
    } as unknown as D1Database,
    ASSETS: {} as Fetcher,
    ASSETS_BUCKET: {} as R2Bucket,
  } satisfies Env;
  return {
    env,
    get subscriptionLookupParams() {
      return subscriptionLookupParams;
    },
    get updateParams() {
      return updateParams;
    },
  };
}

function subscriptionRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub_manual",
    user_id: "usr_owner",
    name: "Manual Plan",
    logo: null,
    price: 12,
    currency: "USD",
    billing_cycle: "monthly",
    custom_days: null,
    custom_cycle_unit: null,
    one_time_term_count: null,
    one_time_term_unit: null,
    category: "productivity",
    status: "expired",
    pinned: 0,
    public_hidden: 0,
    payment_method: null,
    start_date: "2026-01-31",
    next_billing_date: "2026-01-31",
    auto_renew: 0,
    auto_calculate_next_billing_date: 1,
    trial_end_date: null,
    website: null,
    notes: null,
    tags_json: "[]",
    reminder_days: 3,
    repeat_reminder_enabled: 0,
    repeat_reminder_interval: "1h",
    repeat_reminder_window: "72h",
    extra_json: "{}",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-31T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Cloudflare subscription renewal route", () => {
  it("advances a manual expired subscription and keeps the lookup owner-scoped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T08:00:00.000Z"));
    authMocks.requireAuth.mockResolvedValue({ user: { id: "usr_owner" }, session: { id: "ses" }, token: "test" });
    const fixture = envFixture(subscriptionRow());

    const response = await renewSubscription(requestFixture(), fixture.env, "sub_manual");
    const json = await response.json() as { subscription: { autoRenew: boolean; nextBillingDate: string; status: string } };

    expect(response.status).toBe(200);
    expect(fixture.subscriptionLookupParams).toEqual(["usr_owner", "sub_manual"]);
    expect(fixture.updateParams?.[0]).toBe("2026-02-28");
    expect(fixture.updateParams?.[1]).toBe("active");
    expect(json.subscription).toMatchObject({
      autoRenew: false,
      nextBillingDate: "2026-02-28",
      status: "active",
    });
  });

  it("rejects auto-renewing subscriptions from the manual renew endpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T08:00:00.000Z"));
    authMocks.requireAuth.mockResolvedValue({ user: { id: "usr_owner" }, session: { id: "ses" }, token: "test" });
    const fixture = envFixture(subscriptionRow({ auto_renew: 1 }));

    await expect(renewSubscription(requestFixture({}), fixture.env, "sub_manual"))
      .rejects.toMatchObject({ status: 400, code: "SUBSCRIPTION_RENEW_NOT_ALLOWED" });

    expect(fixture.updateParams).toBeNull();
  });
});
