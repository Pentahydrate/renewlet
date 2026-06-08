import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";
import {
  normalizeTagsArray,
  parseNonNegativeFiniteNumberInput,
  parseNonNegativeIntegerInput,
  parsePositiveIntegerInput,
  parseReminderDaysInput,
} from "@/lib/subscription-form";
import { assertDateOnly, type DateOnly } from "@/lib/time/date-only";
import type { CustomConfig } from "@/types/config";
import {
  DISABLED_REMINDER_DAYS,
  INHERIT_REMINDER_DAYS,
  REMINDER_DAYS_OPTIONS,
  type AppSettings,
} from "@/types/subscription";
import { createSubscriptionFormState, type SubscriptionFormState } from "@/types/subscription-form";

interface AIDraftFormContext {
  settings: AppSettings;
  config: CustomConfig;
}

type SuggestedField = AiRecognizedSubscriptionDraft["website"];
type AIDraftFormSourceFields = Pick<AiRecognizedSubscriptionDraft, "website" | "notes" | "trialEndDate">;

export function aiDraftToSubscriptionFormState(
  draft: AiRecognizedSubscriptionDraft,
  context: AIDraftFormContext,
): SubscriptionFormState {
  const isOneTimeBuyout = draft.billingCycle === "one-time" && !draft.oneTimeTermCount;
  const reminderState = isOneTimeBuyout
    ? disabledReminderState()
    : reminderStateFromDraft(draft, context.settings.notificationReminderDays);
  return createSubscriptionFormState({
    name: draft.name,
    logo: undefined,
    price: draft.price === null ? "" : String(draft.price),
    currency: draft.currency ?? context.settings.defaultCurrency,
    billingCycle: draft.billingCycle ?? "monthly",
    customDays: draft.customDays === null ? "" : String(draft.customDays),
    customCycleUnit: draft.customCycleUnit ?? "day",
    oneTimeMode: isOneTimeBuyout ? "buyout" : "term",
    oneTimeTermCount: draft.oneTimeTermCount === null ? "1" : String(draft.oneTimeTermCount),
    oneTimeTermUnit: draft.oneTimeTermUnit ?? "month",
    category: draft.category ?? context.config.categories[0]?.value ?? "other",
    status: draft.status ?? "active",
    paymentMethod: draft.paymentMethod ?? "",
    startDate: toFormDate(draft.startDate),
    nextBillingDate: toFormDate(draft.nextBillingDate),
    autoRenew: false,
    autoCalculate: draft.autoCalculateNextBillingDate ?? true,
    reminderType: reminderState.reminderType,
    reminderDays: reminderState.reminderDays,
    customReminderDays: reminderState.customReminderDays,
    repeatReminderEnabled: isOneTimeBuyout || draft.reminderDays === DISABLED_REMINDER_DAYS ? false : draft.repeatReminderEnabled ?? false,
    repeatReminderInterval: draft.repeatReminderInterval ?? "1h",
    repeatReminderWindow: draft.repeatReminderWindow ?? "72h",
    website: draft.website?.value ?? "",
    notes: draft.notes?.value ?? "",
    tags: draft.tags,
  });
}

export function subscriptionFormStateToAIDraftPatch(
  formData: SubscriptionFormState,
  previousDraft: AIDraftFormSourceFields,
): Partial<AiRecognizedSubscriptionDraft> {
  const reminderDays = formData.billingCycle === "one-time" && formData.oneTimeMode === "buyout"
    ? DISABLED_REMINDER_DAYS
    : reminderDaysFromFormState(formData);
  const oneTimeTermEnabled = formData.billingCycle === "one-time" && formData.oneTimeMode === "term";
  return {
    name: formData.name,
    price: parseNonNegativeFiniteNumberInput(formData.price),
    currency: formData.currency.trim() || null,
    billingCycle: formData.billingCycle,
    customDays: formData.billingCycle === "custom" ? parsePositiveIntegerInput(formData.customDays) : null,
    customCycleUnit: formData.billingCycle === "custom" ? formData.customCycleUnit : null,
    oneTimeTermCount: oneTimeTermEnabled ? parsePositiveIntegerInput(formData.oneTimeTermCount) : null,
    oneTimeTermUnit: oneTimeTermEnabled ? formData.oneTimeTermUnit : null,
    category: formData.category.trim() || null,
    status: formData.status,
    paymentMethod: formData.paymentMethod.trim() || null,
    startDate: formData.startDate ?? null,
    nextBillingDate: formData.nextBillingDate ?? null,
    autoCalculateNextBillingDate: formData.billingCycle === "one-time" ? false : formData.autoCalculate,
    trialEndDate: formData.status === "trial" ? previousDraft.trialEndDate ?? null : null,
    website: suggestedFieldFromFormValue(formData.website, previousDraft.website),
    notes: suggestedFieldFromFormValue(formData.notes, previousDraft.notes),
    tags: normalizeTagsArray(formData.tags),
    reminderDays,
    repeatReminderEnabled: reminderDays === DISABLED_REMINDER_DAYS ? false : formData.repeatReminderEnabled,
    repeatReminderInterval: formData.repeatReminderInterval,
    repeatReminderWindow: formData.repeatReminderWindow,
  };
}

function disabledReminderState(): Pick<SubscriptionFormState, "reminderType" | "reminderDays" | "customReminderDays"> {
  return { reminderType: "disabled", reminderDays: String(DISABLED_REMINDER_DAYS), customReminderDays: "" };
}

function reminderStateFromDraft(
  draft: AiRecognizedSubscriptionDraft,
  defaultReminderDays: number,
): Pick<SubscriptionFormState, "reminderType" | "reminderDays" | "customReminderDays"> {
  const reminderDays = draft.reminderDays ?? INHERIT_REMINDER_DAYS;
  if (reminderDays === DISABLED_REMINDER_DAYS) {
    return disabledReminderState();
  }
  if (reminderDays === INHERIT_REMINDER_DAYS) {
    return { reminderType: "inherit", reminderDays: String(INHERIT_REMINDER_DAYS), customReminderDays: "" };
  }
  if (REMINDER_DAYS_OPTIONS.some((option) => option.value === reminderDays)) {
    return { reminderType: "preset", reminderDays: String(reminderDays), customReminderDays: "" };
  }
  return {
    reminderType: "custom",
    reminderDays: String(defaultReminderDays),
    customReminderDays: String(reminderDays),
  };
}

function reminderDaysFromFormState(formData: SubscriptionFormState): number | null {
  if (formData.reminderType === "disabled") return DISABLED_REMINDER_DAYS;
  if (formData.reminderType === "inherit") return INHERIT_REMINDER_DAYS;
  if (formData.reminderType === "custom") return parseNonNegativeIntegerInput(formData.customReminderDays);
  return parseReminderDaysInput(formData.reminderDays);
}

function suggestedFieldFromFormValue(value: string, previous: SuggestedField): SuggestedField {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return {
    value: trimmed,
    source: previous?.value === trimmed ? previous.source : "input",
  };
}

function toFormDate(value: string | null): DateOnly | undefined {
  return value ? assertDateOnly(value) : undefined;
}
