import { describe, expect, it } from "vitest";
import { createDefaultAppSettings } from "@renewlet/shared/settings-defaults";
import type { SubscriptionRow, UserRow, Env, CalendarFeedRow, SessionAuthRow } from "./types";
import {
  calendarFeedIcs,
  createCalendarFeed,
  createSubscriptionCalendarFeed,
  deleteCalendarFeed,
  deleteSubscriptionCalendarFeed,
  readCalendarFeed,
} from "./calendar-feed";
import { sha256 } from "./crypto";

const SESSION_TOKEN = "session-token";
const USER_ID = "usr_calendar";

describe("calendar feed worker handlers", () => {
  it("creates a reusable global feed, returns the URL on status, renders filtered ICS by token, and revokes the URL", async () => {
    const env = await createCalendarFeedTestEnv();
    const request = authorizedRequest("https://renewlet.example/api/app/calendar-feed", {
      body: "{}",
      headers: { "accept-language": "en-US" },
      method: "POST",
    });

    const createResponse = await createCalendarFeed(request, env);
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as { calendarFeed: { feedUrl: string; enabled: boolean } };
    expect(created.calendarFeed.enabled).toBe(true);
    expect(created.calendarFeed.feedUrl).toMatch(/^https:\/\/renewlet\.example\/calendar\/renewals\.ics\?token=/);

    const token = new URL(created.calendarFeed.feedUrl).searchParams.get("token") ?? "";
    expect(token).not.toBe("");
    const storedFeed = env.__state.feeds[0];
    expect(storedFeed?.scope).toBe("all");
    expect(storedFeed?.token).toBe(token);

    const statusResponse = await readCalendarFeed(authorizedRequest("https://renewlet.example/api/app/calendar-feed"), env);
    const status = await statusResponse.json() as { calendarFeed: Record<string, unknown> };
    expect(status.calendarFeed).toMatchObject({ enabled: true, feedUrl: created.calendarFeed.feedUrl });

    const icsResponse = await calendarFeedIcs(new Request(created.calendarFeed.feedUrl), env);
    expect(icsResponse.status).toBe(200);
    const ics = await icsResponse.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Active Plan");
    expect(ics).toContain("DTSTART;VALUE=DATE:20990602");
    expect(ics).toContain("TRIGGER:-P5D");
    expect(ics).not.toContain("Paused Plan");
    expect(ics).not.toContain("Cancelled Plan");
    expect(ics).not.toContain("Expired Plan");
    expect(ics).not.toContain("One Time Plan");

    const rotateResponse = await createCalendarFeed(authorizedRequest("https://renewlet.example/api/app/calendar-feed", {
      body: "{}",
      method: "POST",
    }), env);
    const rotated = await rotateResponse.json() as { calendarFeed: { feedUrl: string } };
    expect(rotated.calendarFeed.feedUrl).toBe(created.calendarFeed.feedUrl);

    const deleteResponse = await deleteCalendarFeed(authorizedRequest("https://renewlet.example/api/app/calendar-feed", { method: "DELETE" }), env);
    expect(deleteResponse.status).toBe(200);
    await expect(calendarFeedIcs(new Request(rotated.calendarFeed.feedUrl), env)).rejects.toMatchObject({ status: 404 });
  });

  it("creates one reusable subscription-scoped feed token and revokes it", async () => {
    const env = await createCalendarFeedTestEnv();

    const firstResponse = await createSubscriptionCalendarFeed(authorizedRequest("https://renewlet.example/api/app/subscriptions/sub_paused/calendar-feed", {
      body: "{}",
      method: "POST",
    }), env, "sub_paused");
    const secondResponse = await createSubscriptionCalendarFeed(authorizedRequest("https://renewlet.example/api/app/subscriptions/sub_paused/calendar-feed", {
      body: "{}",
      method: "POST",
    }), env, "sub_paused");
    const first = await firstResponse.json() as { calendarFeed: { feedUrl: string } };
    const second = await secondResponse.json() as { calendarFeed: { feedUrl: string } };

    expect(first.calendarFeed.feedUrl).toBe(second.calendarFeed.feedUrl);
    expect(env.__state.feeds.filter((feed) => feed.scope === "subscription" && feed.subscription_id === "sub_paused")).toHaveLength(1);

    const firstIcs = await (await calendarFeedIcs(new Request(first.calendarFeed.feedUrl), env)).text();
    const secondIcs = await (await calendarFeedIcs(new Request(second.calendarFeed.feedUrl), env)).text();
    expect(firstIcs).toContain("NAME:Renewlet - Paused Plan");
    expect(firstIcs).toContain("SUMMARY:Paused Plan");
    expect(firstIcs).not.toContain("Active Plan");
    expect(secondIcs).toContain("SUMMARY:Paused Plan");

    const deleteResponse = await deleteSubscriptionCalendarFeed(authorizedRequest("https://renewlet.example/api/app/subscriptions/sub_paused/calendar-feed", { method: "DELETE" }), env, "sub_paused");
    expect(deleteResponse.status).toBe(200);
    await expect(calendarFeedIcs(new Request(first.calendarFeed.feedUrl), env)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects subscription-scoped feed creation for another user's subscription", async () => {
    const env = await createCalendarFeedTestEnv();
    env.__state.subscriptions.push({
      ...subscriptionRow("sub_other", "Other User Plan", "active", "monthly", "2099-06-05"),
      user_id: "usr_other",
    });

    await expect(createSubscriptionCalendarFeed(authorizedRequest("https://renewlet.example/api/app/subscriptions/sub_other/calendar-feed", {
      body: "{}",
      method: "POST",
    }), env, "sub_other")).rejects.toMatchObject({ status: 404 });
  });

  it("returns 404 when a subscription-scoped feed points at a removed subscription", async () => {
    const env = await createCalendarFeedTestEnv();
    const response = await createSubscriptionCalendarFeed(authorizedRequest("https://renewlet.example/api/app/subscriptions/sub_active/calendar-feed", {
      body: "{}",
      method: "POST",
    }), env, "sub_active");
    const created = await response.json() as { calendarFeed: { feedUrl: string } };

    env.__state.subscriptions = env.__state.subscriptions.filter((subscription) => subscription.id !== "sub_active");

    await expect(calendarFeedIcs(new Request(created.calendarFeed.feedUrl), env)).rejects.toMatchObject({ status: 404 });
  });

  it("self-repairs a missing calendar feed table before creating a feed", async () => {
    const env = await createCalendarFeedTestEnv({ calendarFeedsTableExists: false });
    const request = authorizedRequest("https://renewlet.example/api/app/calendar-feed", {
      body: "{}",
      headers: { "accept-language": "en-US" },
      method: "POST",
    });

    const createResponse = await createCalendarFeed(request, env);
    const created = await createResponse.json() as { calendarFeed: { feedUrl: string; enabled: boolean } };

    expect(createResponse.status).toBe(200);
    expect(created.calendarFeed.enabled).toBe(true);
    expect(env.__state.calendarFeedsTableExists).toBe(true);
    expect(env.__state.calendarFeedScopedSchema).toBe(true);
    expect(env.__state.feeds).toHaveLength(1);
  });

  it("self-repairs a legacy hash-only calendar feed table by dropping unrecoverable old feeds", async () => {
    const env = await createCalendarFeedTestEnv({
      calendarFeedScopedSchema: false,
      feeds: [calendarFeedRow({
        id: "",
        scope: "all",
        subscription_id: null,
        token: "legacy-token",
      })],
    });

    const response = await createSubscriptionCalendarFeed(authorizedRequest("https://renewlet.example/api/app/subscriptions/sub_active/calendar-feed", {
      body: "{}",
      method: "POST",
    }), env, "sub_active");

    expect(response.status).toBe(200);
    expect(env.__state.calendarFeedScopedSchema).toBe(true);
    expect(env.__state.feeds.some((feed) => feed.scope === "all" && feed.token === "legacy-token")).toBe(false);
    expect(env.__state.feeds.some((feed) => feed.scope === "subscription" && feed.subscription_id === "sub_active")).toBe(true);
  });

  it("returns a stable migration-required error when the calendar feed table cannot be repaired", async () => {
    const env = await createCalendarFeedTestEnv({
      calendarFeedSchemaError: new Error("D1_ERROR: permission denied"),
      calendarFeedsTableExists: false,
    });
    const request = authorizedRequest("https://renewlet.example/api/app/calendar-feed", {
      body: "{}",
      headers: { "accept-language": "en-US" },
      method: "POST",
    });

    await expect(createCalendarFeed(request, env)).rejects.toMatchObject({
      code: "MIGRATION_REQUIRED",
      message: "Calendar feed storage is not ready. Re-run the Cloudflare D1 migrations and try again.",
      status: 500,
    });
    expect(env.__state.feeds).toHaveLength(0);
  });

  it("does not create the calendar feed table from the public ICS endpoint", async () => {
    const env = await createCalendarFeedTestEnv({ calendarFeedsTableExists: false });

    await expect(calendarFeedIcs(new Request("https://renewlet.example/calendar/renewals.ics?token=missing"), env)).rejects.toMatchObject({ status: 404 });
    expect(env.__state.calendarFeedsTableExists).toBe(false);
  });
});

type CalendarFeedTestEnv = Env & {
  __state: CalendarFeedTestState;
};

interface CalendarFeedTestState {
  calendarFeedSchemaError: Error | null;
  calendarFeedScopedSchema: boolean;
  calendarFeedsTableExists: boolean;
  feeds: CalendarFeedRow[];
  legacyFeeds: CalendarFeedRow[];
  sessionHash: string;
  settingsJson: string;
  subscriptions: SubscriptionRow[];
  user: UserRow;
}

interface CalendarFeedTestOptions {
  calendarFeedSchemaError?: Error | null;
  calendarFeedScopedSchema?: boolean;
  calendarFeedsTableExists?: boolean;
  feeds?: CalendarFeedRow[];
}

async function createCalendarFeedTestEnv(options: CalendarFeedTestOptions = {}): Promise<CalendarFeedTestEnv> {
  const settings = {
    ...createDefaultAppSettings(),
    locale: "en-US" as const,
    timezone: "UTC",
    notificationReminderDays: 5,
  };
  const state: CalendarFeedTestState = {
    sessionHash: await sha256(SESSION_TOKEN),
    user: {
      id: USER_ID,
      email: "calendar@example.com",
      name: "Calendar User",
      role: "user",
      banned: 0,
      ban_reason: "",
      password_hash: "hash",
      reset_token_hash: null,
      reset_token_expires_at: null,
      created_at: "2026-05-29T00:00:00.000Z",
      updated_at: "2026-05-29T00:00:00.000Z",
    },
    calendarFeedSchemaError: options.calendarFeedSchemaError ?? null,
    calendarFeedScopedSchema: options.calendarFeedScopedSchema ?? true,
    calendarFeedsTableExists: options.calendarFeedsTableExists ?? true,
    feeds: options.feeds ?? [],
    legacyFeeds: [],
    settingsJson: JSON.stringify(settings),
    subscriptions: [
      subscriptionRow("sub_active", "Active Plan", "active", "monthly", "2099-06-02"),
      subscriptionRow("sub_paused", "Paused Plan", "paused", "monthly", "2099-06-03"),
      subscriptionRow("sub_cancelled", "Cancelled Plan", "cancelled", "monthly", "2099-06-03"),
      subscriptionRow("sub_expired", "Expired Plan", "expired", "monthly", "2099-06-03"),
      subscriptionRow("sub_once", "One Time Plan", "active", "one-time", "2099-06-04"),
    ],
  };
  return {
    DB: new CalendarFeedTestDB(state) as unknown as D1Database,
    ASSETS_BUCKET: {} as R2Bucket,
    __state: state,
  };
}

function authorizedRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${SESSION_TOKEN}`);
  return new Request(url, { ...init, headers });
}

function subscriptionRow(id: string, name: string, status: string, billingCycle: string, nextBillingDate: string): SubscriptionRow {
  return {
    id,
    user_id: USER_ID,
    name,
    logo: null,
    price: 12.5,
    currency: "USD",
    billing_cycle: billingCycle,
    custom_days: null,
    category: "Productivity",
    status,
    payment_method: "Visa",
    start_date: "2099-01-01",
    next_billing_date: nextBillingDate,
    auto_calculate_next_billing_date: 1,
    trial_end_date: null,
    website: "https://example.com",
    notes: "Team plan",
    tags_json: "[]",
    reminder_days: -1,
    repeat_reminder_enabled: 0,
    repeat_reminder_interval: "24h",
    repeat_reminder_window: "24h",
    extra_json: "{}",
    created_at: `2026-05-29T00:00:0${id.endsWith("active") ? 1 : 2}.000Z`,
    updated_at: "2026-05-29T00:00:00.000Z",
  };
}

function calendarFeedRow(overrides: Partial<CalendarFeedRow> = {}): CalendarFeedRow {
  return {
    id: "cal_existing",
    user_id: USER_ID,
    scope: "all",
    subscription_id: null,
    token: "feed-token",
    created_at: "2026-05-29T00:00:00.000Z",
    updated_at: "2026-05-29T00:00:00.000Z",
    ...overrides,
  };
}

class CalendarFeedTestDB {
  constructor(private readonly state: CalendarFeedTestState) {}

  prepare(sql: string) {
    return new CalendarFeedTestStatement(this.state, sql);
  }
}

class CalendarFeedTestStatement {
  private values: unknown[] = [];

  constructor(
    private readonly state: CalendarFeedTestState,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM sessions JOIN users")) {
      if (this.values[0] !== this.state.sessionHash) return null;
      const row: SessionAuthRow = {
        session_id: "ses_calendar",
        session_token_hash: this.state.sessionHash,
        session_user_id: USER_ID,
        session_expires_at: "2099-01-01T00:00:00.000Z",
        session_created_at: "2026-05-29T00:00:00.000Z",
        session_last_seen_at: "2026-05-29T00:00:00.000Z",
        ...this.state.user,
      };
      return row as T;
    }
    if (this.sql.includes("FROM calendar_feeds")) {
      this.assertCalendarFeedTableReadable();
      if (this.sql.includes("WHERE token =")) {
        return this.state.feeds.find((feed) => feed.token === this.values[0]) as T | undefined ?? null;
      }
      if (this.sql.includes("scope = 'all'")) {
        return this.state.feeds.find((feed) => feed.user_id === this.values[0] && feed.scope === "all") as T | undefined ?? null;
      }
      if (this.sql.includes("scope = 'subscription'")) {
        return this.state.feeds.find((feed) => feed.user_id === this.values[0] && feed.scope === "subscription" && feed.subscription_id === this.values[1]) as T | undefined ?? null;
      }
    }
    if (this.sql.includes("SELECT settings_json FROM settings")) {
      return { settings_json: this.state.settingsJson } as T;
    }
    if (this.sql.includes("FROM subscriptions WHERE user_id = ? AND id = ?")) {
      return this.state.subscriptions.find((row) => row.user_id === this.values[0] && row.id === this.values[1]) as T | undefined ?? null;
    }
    return null;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("PRAGMA table_info(calendar_feeds)")) {
      if (!this.state.calendarFeedsTableExists) return d1Result([]);
      const names = this.state.calendarFeedScopedSchema
        ? ["id", "user_id", "scope", "subscription_id", "token", "created_at", "updated_at"]
        : ["user_id", "token_hash", "created_at", "updated_at"];
      return d1Result(names.map((name) => ({ name })) as T[]);
    }
    if (this.sql.includes("FROM subscriptions")) {
      return d1Result(this.state.subscriptions as T[]);
    }
    return d1Result([]);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS calendar_feeds")) {
      this.assertCalendarFeedSchemaWritable();
      this.state.calendarFeedsTableExists = true;
      this.state.calendarFeedScopedSchema = true;
      return d1Result([]);
    }
    if (this.sql.includes("ALTER TABLE calendar_feeds RENAME TO calendar_feeds_legacy")) {
      this.assertCalendarFeedSchemaWritable();
      this.assertCalendarFeedTableExists();
      this.state.legacyFeeds = [...this.state.feeds];
      this.state.feeds = [];
      this.state.calendarFeedsTableExists = false;
      return d1Result([]);
    }
    if (this.sql.includes("DROP TABLE calendar_feeds_legacy")) {
      this.state.legacyFeeds = [];
      return d1Result([]);
    }
    if (this.sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feeds_user_all_unique")
      || this.sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feeds_token")
      || this.sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_feeds_user_subscription_unique")) {
      this.assertCalendarFeedSchemaWritable();
      this.assertCalendarFeedTableReadable();
      return d1Result([]);
    }
    if (this.sql.includes("INSERT INTO calendar_feeds")) {
      this.assertCalendarFeedTableReadable();
      const [id, userId, scope, subscriptionId, token, createdAt, updatedAt] = this.values as [string, string, CalendarFeedRow["scope"], string | null, string, string, string];
      this.state.feeds.push({
        id,
        user_id: userId,
        scope,
        subscription_id: subscriptionId,
        token,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    }
    if (this.sql.includes("DELETE FROM calendar_feeds")) {
      this.assertCalendarFeedTableReadable();
      if (this.sql.includes("scope = 'all'")) {
        this.state.feeds = this.state.feeds.filter((feed) => !(feed.user_id === this.values[0] && feed.scope === "all"));
      } else if (this.sql.includes("scope = 'subscription'")) {
        this.state.feeds = this.state.feeds.filter((feed) => !(feed.user_id === this.values[0] && feed.scope === "subscription" && feed.subscription_id === this.values[1]));
      }
    }
    return d1Result([]);
  }

  private assertCalendarFeedSchemaWritable() {
    if (this.state.calendarFeedSchemaError) throw this.state.calendarFeedSchemaError;
  }

  private assertCalendarFeedTableExists() {
    if (!this.state.calendarFeedsTableExists) {
      throw new Error("D1_ERROR: no such table: calendar_feeds: SQLITE_ERROR");
    }
  }

  private assertCalendarFeedTableReadable() {
    this.assertCalendarFeedTableExists();
    if (!this.state.calendarFeedScopedSchema) {
      throw new Error("D1_ERROR: no such column: scope: SQLITE_ERROR");
    }
  }
}

function d1Result<T = unknown>(results: T[]): D1Result<T> {
  return {
    results,
    success: true,
    meta: {},
  } as D1Result<T>;
}
