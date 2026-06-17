import { createDefaultAppSettings } from "@renewlet/shared/settings-defaults";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runScheduledNotifications } from "./notifications";
import type { Env } from "./types";

vi.mock("./smtp", () => ({
  notificationSmtpConfig: () => {
    throw new Error("SMTP should not be used by notification scheduler gate tests");
  },
  sendSmtpEmail: async () => undefined,
}));

type FakeD1Query = {
  sql: string;
  params: unknown[];
  method: "all" | "first" | "run";
};

function fakeEnv(handler: (query: FakeD1Query) => unknown | Promise<unknown>): Env {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              all: async () => await handler({ sql, params, method: "all" }),
              first: async () => await handler({ sql, params, method: "first" }),
              run: async () => await handler({ sql, params, method: "run" }),
            } as D1PreparedStatement;
          },
        } as D1PreparedStatement;
      },
    } as unknown as D1Database,
    ASSETS: {} as Fetcher,
    ASSETS_BUCKET: {} as R2Bucket,
  };
}

function d1All<T>(results: T[]): D1Result<T> {
  return { results, success: true, meta: {} as D1Meta } as D1Result<T>;
}

function settings(overrides: Partial<ApiAppSettings> = {}): ApiAppSettings {
  return {
    ...createDefaultAppSettings(),
    timezone: "UTC",
    notificationTimeLocal: "08:00" as ApiAppSettings["notificationTimeLocal"],
    ...overrides,
  };
}

function schedulerState(repeatReminderCount: number) {
  return {
    user_id: "usr_due",
    auto_renew_count: 0,
    repeat_reminder_count: repeatReminderCount,
    last_auto_renew_local_date: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Cloudflare notification scheduler gate", () => {
  it("skips non-due scheduled ticks without subscription candidate scans when repeat gate is empty", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-09T07:00:00.000Z"));
    const subscriptionQueries: string[] = [];
    const env = fakeEnv(({ sql, method }) => {
      if (method === "all" && sql.includes("SELECT id FROM users WHERE banned = 0")) return d1All([{ id: "usr_due" }]);
      if (method === "first" && sql.includes("SELECT settings_json FROM settings")) {
        return { settings_json: JSON.stringify(settings()) };
      }
      if (method === "first" && sql.includes("FROM subscription_scheduler_state")) return schedulerState(0);
      if (method === "all" && sql.includes("FROM subscriptions")) {
        subscriptionQueries.push(sql);
        return d1All([]);
      }
      throw new Error(`unexpected ${method} query: ${sql}`);
    });

    await expect(runScheduledNotifications(env)).resolves.toBeUndefined();

    expect(subscriptionQueries).toHaveLength(0);
  });

  it("uses repeat candidates without full subscription scans when repeat gate is present", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-09T07:00:00.000Z"));
    const subscriptionQueries: string[] = [];
    const env = fakeEnv(({ sql, method }) => {
      if (method === "all" && sql.includes("SELECT id FROM users WHERE banned = 0")) return d1All([{ id: "usr_due" }]);
      if (method === "first" && sql.includes("SELECT settings_json FROM settings")) {
        return { settings_json: JSON.stringify(settings()) };
      }
      if (method === "first" && sql.includes("FROM subscription_scheduler_state")) return schedulerState(1);
      if (method === "all" && sql.includes("FROM subscriptions")) {
        subscriptionQueries.push(sql);
        return d1All([]);
      }
      throw new Error(`unexpected ${method} query: ${sql}`);
    });

    await expect(runScheduledNotifications(env)).resolves.toBeUndefined();

    expect(subscriptionQueries).toHaveLength(1);
    expect(subscriptionQueries[0]).toContain("repeat_reminder_enabled = 1");
    expect(subscriptionQueries[0]).not.toContain("auto_renew = 1");
    expect(subscriptionQueries[0]).not.toMatch(/WHERE user_id = \?\s+ORDER BY created_at DESC, id DESC\s+LIMIT \?/s);
  });
});
