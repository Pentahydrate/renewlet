import { describe, expect, it } from "vitest";
import { normalizeSettings } from "./settings-service";

describe("settings service normalization", () => {
  it("recovers invalid stored Telegram message format without dropping other fields", () => {
    const settings = normalizeSettings({
      telegramMessageFormat: "markdown",
      monthlyBudget: 2333,
    });

    expect(settings.telegramMessageFormat).toBe("plain");
    expect(settings.monthlyBudget).toBe(2333);
  });
});
