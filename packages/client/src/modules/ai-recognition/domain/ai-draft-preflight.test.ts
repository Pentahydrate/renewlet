import { describe, expect, it } from "vitest";
import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";
import { getAIDraftBlockingIssues, hasAIDraftBlockingIssues } from "./ai-draft-preflight";

function draft(overrides: Partial<AiRecognizedSubscriptionDraft> = {}): AiRecognizedSubscriptionDraft {
  return {
    name: "Service",
    price: 12,
    currency: "USD",
    billingCycle: "monthly",
    customDays: null,
    customCycleUnit: null,
    oneTimeTermCount: null,
    oneTimeTermUnit: null,
    category: null,
    status: "active",
    paymentMethod: null,
    startDate: "2026-06-01",
    nextBillingDate: "2026-07-01",
    autoCalculateNextBillingDate: true,
    trialEndDate: null,
    website: null,
    notes: null,
    tags: [],
    reminderDays: null,
    repeatReminderEnabled: null,
    repeatReminderInterval: null,
    repeatReminderWindow: null,
    confidence: "high",
    warnings: [],
    ...overrides,
  };
}

describe("AI draft preflight", () => {
  it("does not block complete drafts", () => {
    expect(getAIDraftBlockingIssues(draft())).toEqual([]);
    expect(hasAIDraftBlockingIssues(draft())).toBe(false);
  });

  it("blocks drafts missing core billing fields", () => {
    // 这些缺失字段会让导入层只能填默认值，AI 入口必须先拦住让用户确认。
    expect(getAIDraftBlockingIssues(draft({
      price: null,
      currency: null,
      billingCycle: null,
      startDate: null,
      nextBillingDate: null,
    })).map((issue) => issue.code)).toEqual([
      "price",
      "currency",
      "billingCycle",
      "dates",
    ]);
  });

  it("blocks custom cycles without complete cycle details", () => {
    expect(getAIDraftBlockingIssues(draft({
      billingCycle: "custom",
      customDays: null,
      customCycleUnit: "day",
    })).map((issue) => issue.code)).toEqual(["customCycle"]);

    expect(getAIDraftBlockingIssues(draft({
      billingCycle: "custom",
      customDays: 14,
      customCycleUnit: "day",
    }))).toEqual([]);
  });
});
