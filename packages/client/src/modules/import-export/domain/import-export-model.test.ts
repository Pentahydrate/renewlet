import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/types/subscription";
import { sanitizeSettingsForExport } from "./import-export-model";

describe("sanitizeSettingsForExport", () => {
  it("strips Discord and PushPlus notification secrets unless explicitly included", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      discordWebhookUrl: "https://discord.com/api/webhooks/123/secret",
      discordBotUsername: "Renewlet",
      discordBotAvatarUrl: "https://cdn.example.com/avatar.png",
      pushplusToken: "push-token",
    };

    const sanitized = sanitizeSettingsForExport(settings, false);
    expect(sanitized).not.toHaveProperty("discordWebhookUrl");
    expect(sanitized).not.toHaveProperty("discordBotUsername");
    expect(sanitized).not.toHaveProperty("discordBotAvatarUrl");
    expect(sanitized).not.toHaveProperty("pushplusToken");
    expect(JSON.stringify(sanitized)).not.toContain("push-token");

    const withSecrets = sanitizeSettingsForExport(settings, true);
    expect(withSecrets.discordWebhookUrl).toBe("https://discord.com/api/webhooks/123/secret");
    expect(withSecrets.discordBotUsername).toBe("Renewlet");
    expect(withSecrets.discordBotAvatarUrl).toBe("https://cdn.example.com/avatar.png");
    expect(withSecrets.pushplusToken).toBe("push-token");
  });
});
