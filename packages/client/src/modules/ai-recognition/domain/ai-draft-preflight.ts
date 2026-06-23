import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";

export const AI_DRAFT_BLOCKING_ISSUE_CODES = [
  "price",
  "currency",
  "billingCycle",
  "purchaseDate",
  "nextBillingDate",
  "autoCalculateStartDate",
  "customCycle",
] as const;

export type AIDraftBlockingIssueCode = typeof AI_DRAFT_BLOCKING_ISSUE_CODES[number];

export interface AIDraftBlockingIssue {
  code: AIDraftBlockingIssueCode;
  field: "price" | "currency" | "billingCycle" | "dates" | "customDays";
}

// 这些字段缺失会让 import preview 只能靠默认值改写账单事实，所以 AI 入口先要求用户显式修正。
export function getAIDraftBlockingIssues(draft: AiRecognizedSubscriptionDraft): AIDraftBlockingIssue[] {
  const issues: AIDraftBlockingIssue[] = [];

  if (draft.price === null) {
    issues.push({ code: "price", field: "price" });
  }
  if (!draft.currency?.trim()) {
    issues.push({ code: "currency", field: "currency" });
  }
  if (!draft.billingCycle) {
    issues.push({ code: "billingCycle", field: "billingCycle" });
  } else if (draft.billingCycle === "custom" && (!draft.customDays || !draft.customCycleUnit)) {
    issues.push({ code: "customCycle", field: "customDays" });
  }
  const dateIssue = getAIDraftDateBlockingIssue(draft);
  if (dateIssue) {
    issues.push(dateIssue);
  }

  return issues;
}

function getAIDraftDateBlockingIssue(draft: AiRecognizedSubscriptionDraft): AIDraftBlockingIssue | null {
  if (draft.billingCycle === "one-time") {
    if (!draft.startDate) {
      return { code: "purchaseDate", field: "dates" };
    }
    return null;
  }
  if (draft.billingCycle !== null && draft.autoCalculateNextBillingDate === true && !draft.startDate) {
    return { code: "autoCalculateStartDate", field: "dates" };
  }
  if (!draft.nextBillingDate) {
    return { code: "nextBillingDate", field: "dates" };
  }
  return null;
}

export function hasAIDraftBlockingIssues(draft: AiRecognizedSubscriptionDraft): boolean {
  return getAIDraftBlockingIssues(draft).length > 0;
}
