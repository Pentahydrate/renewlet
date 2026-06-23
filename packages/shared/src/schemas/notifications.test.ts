import { describe, expect, it } from "vitest";
import {
  notificationChannelSchema,
  notificationJobResultResponseSchema,
  notificationsTestBodySchema,
} from "./notifications";

describe("notification schemas", () => {
  it("accepts Discord and PushPlus in channel and history contracts", () => {
    expect(notificationChannelSchema.parse("discord")).toBe("discord");
    expect(notificationChannelSchema.parse("pushplus")).toBe("pushplus");
    expect(notificationsTestBodySchema.parse({
      channel: "pushplus",
      settings: { pushplusToken: "push-token" },
    }).channel).toBe("pushplus");

    const cronResult = {
      source: "cron",
      reason: null,
      force: false,
      windowMinutes: 2,
      triggeredAtUtc: "2026-06-23T00:00:00Z",
      schedule: {
        scheduledLocalDate: "2026-06-23",
        scheduledLocalTime: "08:00",
        timeZone: "UTC",
        scheduledInstantUtc: "2026-06-23T08:00:00Z",
      },
      settings: {
        timezone: "UTC",
        locale: "zh-CN",
        notificationTimeLocal: "08:00",
        enabledChannels: ["discord", "pushplus"],
        showExpired: true,
      },
      message: {
        title: "Renewlet",
        content: "提醒内容",
        timestamp: "2026-06-23 08:00 UTC",
        hasPayload: true,
        items: [],
      },
      channels: {
        attempted: ["discord", "pushplus"],
        succeeded: ["discord"],
        failed: [{ channel: "pushplus", error: "business code 900" }],
      },
    };
    const result = notificationJobResultResponseSchema.parse(cronResult);

    expect(result).toMatchObject({
      source: "cron",
      channels: {
        attempted: ["discord", "pushplus"],
        succeeded: ["discord"],
        failed: [{ channel: "pushplus", error: "business code 900" }],
      },
    });
    expect(notificationJobResultResponseSchema.safeParse({
      source: "cron",
      reason: null,
      force: false,
      windowMinutes: 2,
      triggeredAtUtc: "2026-06-23T00:00:00Z",
      schedule: {
        scheduledLocalDate: "2026-06-23",
        scheduledLocalTime: "08:00",
        timeZone: "UTC",
        scheduledInstantUtc: "2026-06-23T08:00:00Z",
      },
      settings: {
        timezone: "UTC",
        locale: "zh-CN",
        notificationTimeLocal: "08:00",
        enabledChannels: ["matrix"],
        showExpired: true,
      },
      message: {
        title: "Renewlet",
        content: "提醒内容",
        timestamp: "2026-06-23 08:00 UTC",
        hasPayload: true,
        items: [],
      },
      channels: { attempted: ["matrix"], succeeded: [], failed: [] },
    }).success).toBe(false);
    expect(notificationJobResultResponseSchema.safeParse({
      ...cronResult,
      channels: {
        ...cronResult.channels,
        failed: [{ channel: "pushplus", error: "business code 900", rawResponseText: "leak" }],
      },
    }).success).toBe(false);
  });
});
