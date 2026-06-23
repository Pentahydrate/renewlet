import { describe, expect, it } from "vitest";
import { createDefaultAppSettings } from "../settings-defaults";
import { appSettingsSchema, settingsUpdateBodySchema } from "./settings";

describe("settings schema", () => {
  it("supports only plain or html Telegram message formats", () => {
    expect(createDefaultAppSettings().telegramMessageFormat).toBe("plain");
    expect(appSettingsSchema.pick({ telegramMessageFormat: true }).parse({ telegramMessageFormat: "plain" }).telegramMessageFormat).toBe("plain");
    expect(appSettingsSchema.pick({ telegramMessageFormat: true }).parse({ telegramMessageFormat: "html" }).telegramMessageFormat).toBe("html");
    expect(appSettingsSchema.pick({ telegramMessageFormat: true }).safeParse({ telegramMessageFormat: "markdown" }).success).toBe(false);
  });

  it("accepts Discord and PushPlus settings while keeping URLs HTTPS-only", () => {
    const defaults = createDefaultAppSettings();
    expect(defaults.discordWebhookUrl).toBe("");
    expect(defaults.discordBotUsername).toBe("");
    expect(defaults.discordBotAvatarUrl).toBe("");
    expect(defaults.pushplusToken).toBe("");

    const parsed = settingsUpdateBodySchema.parse({
      enabledChannels: ["discord", "pushplus"],
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      discordBotUsername: "Renewlet",
      discordBotAvatarUrl: "https://cdn.example.com/avatar.png",
      pushplusToken: "pushplus-token",
    });

    expect(parsed.enabledChannels).toEqual(["discord", "pushplus"]);
    expect(parsed.discordBotUsername).toBe("Renewlet");
    expect(settingsUpdateBodySchema.safeParse({ discordWebhookUrl: "http://discord.com/api/webhooks/123/token" }).success).toBe(false);
    expect(settingsUpdateBodySchema.safeParse({ discordBotAvatarUrl: "http://cdn.example.com/avatar.png" }).success).toBe(false);
    expect(settingsUpdateBodySchema.safeParse({ pushplusToken: "x".repeat(257) }).success).toBe(false);
    expect(settingsUpdateBodySchema.safeParse({ pushplusToken: "pushplus-token", pushplusSecret: "unexpected" }).success).toBe(false);
  });
});
