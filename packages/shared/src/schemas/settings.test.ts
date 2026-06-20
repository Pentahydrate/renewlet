import { describe, expect, it } from "vitest";
import { createDefaultAppSettings } from "../settings-defaults";
import { appSettingsSchema } from "./settings";

describe("settings schema", () => {
  it("supports only plain or html Telegram message formats", () => {
    expect(createDefaultAppSettings().telegramMessageFormat).toBe("plain");
    expect(appSettingsSchema.pick({ telegramMessageFormat: true }).parse({ telegramMessageFormat: "plain" }).telegramMessageFormat).toBe("plain");
    expect(appSettingsSchema.pick({ telegramMessageFormat: true }).parse({ telegramMessageFormat: "html" }).telegramMessageFormat).toBe("html");
    expect(appSettingsSchema.pick({ telegramMessageFormat: true }).safeParse({ telegramMessageFormat: "markdown" }).success).toBe(false);
  });
});
