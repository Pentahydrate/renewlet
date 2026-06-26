import type { Subscription, SubscriptionDraft } from "@/types/subscription";

export function cloneSubscriptionExtra(extra: Subscription["extra"]): Subscription["extra"] {
  if (!extra) return undefined;
  const nextExtra = { ...extra };
  // extra.import 是导入幂等键；克隆订阅若继续携带它，后续导入会把原记录和副本误判为同源。
  delete nextExtra["import"];
  return nextExtra;
}

export function buildClonedSubscriptionDraft(source: Subscription, draft: SubscriptionDraft): SubscriptionDraft {
  const extra = cloneSubscriptionExtra(source.extra);
  const base = {
    ...draft,
    pinned: source.pinned,
    extra,
  };

  if (draft.billingCycle === "custom") {
    return {
      ...base,
      billingCycle: "custom",
      customDays: draft.customDays,
      customCycleUnit: draft.customCycleUnit,
      oneTimeTermCount: undefined,
      oneTimeTermUnit: undefined,
    };
  }

  if (draft.billingCycle === "one-time") {
    return {
      ...base,
      billingCycle: "one-time",
      customDays: undefined,
      customCycleUnit: undefined,
      oneTimeTermCount: draft.oneTimeTermCount,
      oneTimeTermUnit: draft.oneTimeTermUnit,
    };
  }

  return {
    ...base,
    billingCycle: draft.billingCycle,
    customDays: undefined,
    customCycleUnit: undefined,
    oneTimeTermCount: undefined,
    oneTimeTermUnit: undefined,
  };
}
