// Worker 通知测试保护 Cron/手动运行共享的内容收集口径，避免 D1 reminder_days 哨兵和 Go 后端分叉。
import { describe, expect, it, vi } from "vitest";
import { createDefaultAppSettings } from "@renewlet/shared/settings-defaults";
import type { ApiSubscription } from "@renewlet/shared/schemas/subscriptions";
import { collectNotificationItemsForLocalDate } from "./notifications";
import { sendServerChan, serverChanEndpoint } from "./notification-serverchan";

vi.mock("./smtp", () => ({
  notificationSmtpConfig: () => {
    throw new Error("SMTP should not be used by notification collection tests");
  },
  sendSmtpEmail: async () => undefined,
}));

function subscription(overrides: Partial<ApiSubscription> = {}): ApiSubscription {
  return {
    id: "sub_quiet",
    name: "Quiet SaaS",
    price: 10,
    currency: "USD",
    billingCycle: "monthly",
    category: "productivity",
    status: "active",
    pinned: false,
    startDate: "2026-01-01",
    nextBillingDate: "2026-01-10",
    autoCalculateNextBillingDate: true,
    tags: [],
    reminderDays: 0,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    ...overrides,
  };
}

describe("Cloudflare notifications", () => {
  it("skips subscriptions with disabled reminders", () => {
    const items = collectNotificationItemsForLocalDate(
      "2026-01-10",
      { ...createDefaultAppSettings(), timezone: "UTC", showExpired: false },
      [subscription({ reminderDays: -2 })],
    );

    expect(items).toEqual([]);
  });

  it("builds ServerChan endpoints for Turbo and ServerChan 3 SendKeys", () => {
    expect(serverChanEndpoint("SCT123456")).toBe("https://sctapi.ftqq.com/SCT123456.send");
    expect(serverChanEndpoint("sctp123tabcdef")).toBe("https://123.push.ft07.com/send/sctp123tabcdef.send");
    expect(() => serverChanEndpoint("sctpabcdef")).toThrow("Server酱 SendKey 格式无效");
  });

  it("sends ServerChan JSON payloads and requires code zero", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://sctapi.ftqq.com/SCT123456.send");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        title: "Renewlet test",
        desp: "Channel works\n\n2026-05-14 08:00 UTC",
      });
      return new Response(JSON.stringify({ code: 0, message: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendServerChan(
      { ...createDefaultAppSettings(), serverchanSendKey: "SCT123456" },
      { title: "Renewlet test", content: "Channel works", timestamp: "2026-05-14 08:00 UTC", hasPayload: true, items: [] },
      "zh-CN",
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends ServerChan 3 SendKeys to the derived ft07 host", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://456.push.ft07.com/send/sctp456tabcdef.send");
      return new Response(JSON.stringify({ code: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendServerChan(
      { ...createDefaultAppSettings(), serverchanSendKey: "sctp456tabcdef" },
      { title: "Renewlet test", content: "Channel works", timestamp: "2026-05-14 08:00 UTC", hasPayload: true, items: [] },
      "zh-CN",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats ServerChan business failures as channel errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 40001,
      message: "SCTsecret disabled",
      detail: "secret should not appear",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(sendServerChan(
      { ...createDefaultAppSettings(), serverchanSendKey: "SCTsecret" },
      { title: "Renewlet test", content: "Channel works", timestamp: "2026-05-14 08:00 UTC", hasPayload: true, items: [] },
      "zh-CN",
    )).rejects.toThrow("[redacted] disabled");
  });

  it("uses a generic ServerChan detail for non-JSON HTTP failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SCTsecret upstream", { status: 502, statusText: "Bad Gateway" })));

    await expect(sendServerChan(
      { ...createDefaultAppSettings(), serverchanSendKey: "SCTsecret" },
      { title: "Renewlet test", content: "Channel works", timestamp: "2026-05-14 08:00 UTC", hasPayload: true, items: [] },
      "zh-CN",
    )).rejects.toThrow("Server酱响应格式无效");
  });

  it("rejects malformed ServerChan success responses without leaking the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SCTsecret raw response", { status: 200 })));

    await expect(sendServerChan(
      { ...createDefaultAppSettings(), serverchanSendKey: "SCTsecret" },
      { title: "Renewlet test", content: "Channel works", timestamp: "2026-05-14 08:00 UTC", hasPayload: true, items: [] },
      "zh-CN",
    )).rejects.toThrow("Server酱响应格式无效");
  });
});
