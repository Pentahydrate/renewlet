import { memo, useCallback, useMemo } from "react";
import { FieldError } from "@/components/ui/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { compareDateOnly } from "@/lib/time/date-only";
import { LogoPicker } from "@/components/logo-picker";
import { SubscriptionFormDateFields } from "@/components/subscription-form-date-fields";
import { SubscriptionPaymentMethodSelect } from "@/components/subscription-payment-method-select";
import { SubscriptionTagInput } from "@/components/subscription-tag-input";
import type {
  BillingCycle,
  CostSharing,
  CostSharingMember,
  RepeatReminderInterval,
  RepeatReminderWindow,
  SubscriptionStatus,
} from "@/types/subscription";
import {
  DISABLED_REMINDER_DAYS,
  INHERIT_REMINDER_DAYS,
  CURRENCY_OPTIONS,
  CUSTOM_CYCLE_UNITS,
  CYCLE_LABELS,
  REMINDER_DAYS_OPTIONS,
  REPEAT_REMINDER_INTERVAL_OPTIONS,
  REPEAT_REMINDER_SENTENCE_INTERVAL_LABELS,
  REPEAT_REMINDER_WINDOW_OPTIONS,
} from "@/types/subscription";
import type { SubscriptionFormReminderType, SubscriptionFormState } from "@/types/subscription-form";
import { createCurrencySelectOptions } from "@/lib/searchable-options";
import { toReminderDays } from "@/lib/subscription-form";
import { customCycleUnitLabelKey } from "@/lib/subscription-billing";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey, MessageParams } from "@/i18n/messages";
import { localizedLabel } from "@/i18n/locales";
import { errorFieldByFormKey, type SubscriptionFormErrors, type SubscriptionFormFieldsProps } from "@/components/subscription-form-fields-model";
import { calculateCostSharingSummary } from "@renewlet/shared/cost-sharing";
import { Plus, Trash2 } from "lucide-react";
import type { SearchableSelectOption } from "@/lib/searchable-options";

export type { SubscriptionFormReminderType };
export type { SubscriptionFormState };
export type { SubscriptionFormErrors, SubscriptionFormFieldsProps };

function disabledReminderFields(): Pick<SubscriptionFormState, "reminderType" | "reminderDays" | "repeatReminderEnabled"> {
  return {
    reminderType: "disabled",
    reminderDays: String(DISABLED_REMINDER_DAYS),
    repeatReminderEnabled: false,
  };
}

function inheritedReminderFields(): Pick<SubscriptionFormState, "reminderType" | "reminderDays"> {
  return {
    reminderType: "inherit",
    reminderDays: String(INHERIT_REMINDER_DAYS),
  };
}

function newCostSharingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultCostSharing(t: (key: MessageKey, values?: MessageParams) => string): CostSharing {
  const firstMemberId = newCostSharingId();
  return {
    enabled: true,
    payerMemberId: firstMemberId,
    selfMemberId: firstMemberId,
    splitMode: "equal",
    members: [
      { id: firstMemberId, name: t("subscription.costSharing.memberDefault", { index: 1 }), included: true },
    ],
  };
}

function normalizeCostSharingSelection(costSharing: CostSharing): CostSharing {
  // v1 表单只支持“所有成员参与分摊”；included 字段仍随 API 保存，给后续排除成员 UI 留同一 wire shape。
  const members = (costSharing.members.length > 0 ? costSharing.members : [{ id: newCostSharingId(), name: "Member 1", included: true }])
    .map((member) => ({ ...member, included: true }));
  const ids = new Set(members.map((member) => member.id));
  const firstId = members[0]!.id;
  return {
    ...costSharing,
    members,
    selfMemberId: ids.has(costSharing.selfMemberId) ? costSharing.selfMemberId : firstId,
    payerMemberId: ids.has(costSharing.payerMemberId) ? costSharing.payerMemberId : firstId,
  };
}

function costSharingMemberInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

function CostSharingFields({
  id,
  formData,
  update,
  error,
  currencyOptions,
  currencyConvert,
}: {
  id: (name: string) => string;
  formData: SubscriptionFormState;
  update: <K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => void;
  error?: string | undefined;
  currencyOptions: SearchableSelectOption[];
  currencyConvert?: ((amount: number, fromCurrency: string, toCurrency: string) => number) | undefined;
}) {
  const { t, formatCurrency } = useI18n();
  const costSharing = formData.costSharing;
  const price = Number(formData.price);
  const total = Number.isFinite(price) && price >= 0 ? price : 0;
  const summary = calculateCostSharingSummary(costSharing, total, { baseCurrency: formData.currency, convert: currencyConvert });

  const setCostSharing = (next: CostSharing | undefined) => update("costSharing", next ? normalizeCostSharingSelection(next) : undefined);
  const enabled = Boolean(costSharing?.enabled);
  const members = costSharing?.members ?? [];
  const memberShareInCurrency = (member: CostSharingMember) => {
    const memberCurrency = member.currency ?? formData.currency;
    const baseShare = members.length > 0 ? total / members.length : 0;
    return currencyConvert ? currencyConvert(baseShare, formData.currency, memberCurrency) : baseShare;
  };

  const updateMember = (memberId: string, patch: Partial<CostSharingMember>) => {
    if (!costSharing) return;
    setCostSharing({
      ...costSharing,
      members: costSharing.members.map((member) => member.id === memberId ? { ...member, ...patch } : member),
    });
  };

  const removeMember = (memberId: string) => {
    if (!costSharing || costSharing.members.length <= 1) return;
    setCostSharing({
      ...costSharing,
      members: costSharing.members.filter((member) => member.id !== memberId),
    });
  };

  const addMember = () => {
    const base = costSharing ?? defaultCostSharing(t);
    setCostSharing({
      ...base,
      enabled: true,
      members: [
        ...base.members,
        {
          id: newCostSharingId(),
          name: t("subscription.costSharing.memberDefault", { index: base.members.length + 1 }),
          included: true,
        },
      ],
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={id("costSharingEnabled")} className="cursor-pointer text-sm font-medium">
            {t("subscription.costSharing.title")}
          </Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("subscription.costSharing.help")}</p>
        </div>
        <Switch
          id={id("costSharingEnabled")}
          checked={enabled}
          onCheckedChange={(checked) => setCostSharing(checked ? { ...(costSharing ?? defaultCostSharing(t)), enabled: true } : undefined)}
          aria-label={t("subscription.costSharing.title")}
        />
      </div>

      {enabled && costSharing ? (
        <>
          <div className="grid gap-3 sm:max-w-xs">
            <div className="grid gap-2">
              <Label htmlFor={id("costSharingSplitMode")}>{t("subscription.costSharing.splitMode")}</Label>
              <Select value={costSharing.splitMode} onValueChange={(value) => setCostSharing({ ...costSharing, splitMode: value as CostSharing["splitMode"] })}>
                <SelectTrigger id={id("costSharingSplitMode")} className="border-border bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equal">{t("subscription.costSharing.equal")}</SelectItem>
                  <SelectItem value="custom">{t("subscription.costSharing.custom")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="grid gap-2.5 rounded-lg border border-border bg-background/70 p-3 shadow-sm transition-colors hover:bg-background sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,11rem)_2.25rem] sm:items-center"
              >
                <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-primary shadow-inner">
                    {costSharingMemberInitial(member.name)}
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={id(`costSharingMemberName-${member.id}`)} className="sr-only">
                      {t("subscription.costSharing.memberName")}
                    </Label>
                    <Input
                      id={id(`costSharingMemberName-${member.id}`)}
                      value={member.name}
                      onChange={(event) => updateMember(member.id, { name: event.target.value })}
                      aria-label={t("subscription.costSharing.memberName")}
                      className="h-9 border-border bg-secondary font-medium"
                    />
                    <Label htmlFor={id(`costSharingMemberNote-${member.id}`)} className="sr-only">
                      {t("subscription.costSharing.memberNote")}
                    </Label>
                    <Input
                      id={id(`costSharingMemberNote-${member.id}`)}
                      value={member.note ?? ""}
                      onChange={(event) => updateMember(member.id, { note: event.target.value })}
                      aria-label={t("subscription.costSharing.memberNote")}
                      placeholder={t("subscription.costSharing.memberNotePlaceholder")}
                      className="h-8 border-border bg-secondary text-sm text-muted-foreground placeholder:text-muted-foreground/70"
                    />
                  </div>
                </div>
                {costSharing.splitMode === "custom" ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-1.5">
                    <NumericInput
                      allowNegative={false}
                      allowedDecimalSeparators={[".", "。"]}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={member.customAmount?.toString() ?? ""}
                      onRawValueChange={(value) => updateMember(member.id, { customAmount: value.trim() === "" ? undefined : Number(value) })}
                      className="h-9 border-border bg-secondary px-2 font-semibold sm:text-right"
                      aria-label={t("subscription.costSharing.customAmount")}
                    />
                    <MemberCurrencySelect
                      value={member.currency ?? formData.currency}
                      onValueChange={(value) => updateMember(member.id, { currency: value })}
                      options={currencyOptions}
                      ariaLabel={t("subscription.costSharing.memberCurrency")}
                      placeholder={t("subscription.placeholder.currency")}
                      searchPlaceholder={t("subscription.search.currency")}
                      emptyMessage={t("subscription.empty.currency")}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-1.5">
                    <span className="truncate rounded-md bg-secondary px-2.5 py-2 text-sm font-semibold text-foreground sm:text-right">
                      {formatCurrency(memberShareInCurrency(member), member.currency ?? formData.currency)}
                    </span>
                    <MemberCurrencySelect
                      value={member.currency ?? formData.currency}
                      onValueChange={(value) => updateMember(member.id, { currency: value })}
                      options={currencyOptions}
                      ariaLabel={t("subscription.costSharing.memberCurrency")}
                      placeholder={t("subscription.placeholder.currency")}
                      searchPlaceholder={t("subscription.search.currency")}
                      emptyMessage={t("subscription.empty.currency")}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 justify-self-end text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeMember(member.id)}
                  disabled={members.length <= 1}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addMember}>
              <Plus className="h-4 w-4" />
              {t("subscription.costSharing.addMember")}
            </Button>
          </div>

          <div className="grid gap-2 rounded-md bg-background/60 p-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("subscription.costSharing.familyContribution")}</p>
              <p className="font-semibold text-warning">{formatCurrency(summary.familyContribution, formData.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("subscription.costSharing.yourShare")}</p>
              <p className="font-semibold text-primary">{formatCurrency(summary.yourShare, formData.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("subscription.costSharing.recoverableAmount")}</p>
              <p className="font-semibold text-foreground">{formatCurrency(summary.recoverableAmount, formData.currency)}</p>
            </div>
          </div>
          <FieldError id={id("costSharing-error")} message={error} />
        </>
      ) : null}
    </div>
  );
}

function MemberCurrencySelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  searchPlaceholder,
  emptyMessage,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  ariaLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
}) {
  return (
    <SearchableSelect
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      className="h-9 border-border bg-secondary px-2 text-sm font-semibold"
      contentClassName="min-w-[16rem]"
      aria-label={ariaLabel}
      renderValue={(option) => (
        <span className="block text-center tracking-wide">{option?.value ?? value}</span>
      )}
      renderOption={(option) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium">{option.value}</span>
          <span className="min-w-0 truncate text-muted-foreground">{option.label}</span>
        </span>
      )}
    />
  );
}

export const SubscriptionFormFields = memo(function SubscriptionFormFields({
  idPrefix,
  config,
  formData,
  setFormData,
  availableTags = [],
  showLogoField = true,
  onLogoUploadStatusChange,
  onFieldChange,
  errors = {},
  onClearFieldError,
  notificationReminderDays,
  costSharingCurrencyConvert,
}: SubscriptionFormFieldsProps) {
  const { t, locale, label } = useI18n();

  const update = useCallback(<K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => {
    setFormData((prev) => {
      if (key === "billingCycle") {
        const nextBillingCycle = value as BillingCycle;
        const leavingImplicitBuyoutReminder =
          prev.billingCycle === "one-time" && prev.oneTimeMode === "buyout" && prev.reminderType === "disabled";
        return {
          ...prev,
          billingCycle: nextBillingCycle,
          customDays: nextBillingCycle === "custom" ? prev.customDays : "",
          customCycleUnit: nextBillingCycle === "custom" ? prev.customCycleUnit : "day",
          // one-time 无服务期是通知/日历契约里的买断语义，默认静默，避免把购买日误当成到期提醒边界。
          oneTimeMode: nextBillingCycle === "one-time" ? "buyout" : prev.oneTimeMode,
          oneTimeTermCount: nextBillingCycle === "one-time" ? prev.oneTimeTermCount || "1" : prev.oneTimeTermCount,
          oneTimeTermUnit: nextBillingCycle === "one-time" ? prev.oneTimeTermUnit || "month" : prev.oneTimeTermUnit,
          // autoRenew 默认关闭；从 one-time 切回周期时保留用户当前选择，不把沉默状态改成自动续订。
          autoRenew: nextBillingCycle === "one-time" ? false : prev.autoRenew,
          autoCalculate: nextBillingCycle === "one-time" ? false : prev.autoCalculate,
          nextBillingDate: nextBillingCycle === "one-time" ? prev.startDate : prev.nextBillingDate,
          ...(nextBillingCycle === "one-time"
            ? disabledReminderFields()
            : leavingImplicitBuyoutReminder
              ? inheritedReminderFields()
              : {}),
        };
      }
      if (key === "oneTimeMode") {
        const nextOneTimeMode = value as SubscriptionFormState["oneTimeMode"];
        return {
          ...prev,
          oneTimeMode: nextOneTimeMode,
          oneTimeTermCount: nextOneTimeMode === "term" ? prev.oneTimeTermCount || "1" : prev.oneTimeTermCount,
          oneTimeTermUnit: nextOneTimeMode === "term" ? prev.oneTimeTermUnit || "month" : prev.oneTimeTermUnit,
          autoCalculate: false,
          nextBillingDate: nextOneTimeMode === "buyout" ? prev.startDate : prev.nextBillingDate,
          ...(nextOneTimeMode === "buyout" ? disabledReminderFields() : inheritedReminderFields()),
        };
      }
      if (key === "startDate") {
        const nextStartDate = value as SubscriptionFormState["startDate"];
        return {
          ...prev,
          startDate: nextStartDate,
          // 开始日后移后，原手动到期日可能变成非法值；清空比静默改成同一天更能保留用户意图。
          // 比较保持在 DateOnly 字符串语义内，避免本地 Date 时区换算导致跨天误判。
          nextBillingDate:
            prev.billingCycle === "one-time"
              ? nextStartDate
              : nextStartDate &&
                  prev.nextBillingDate &&
                  compareDateOnly(prev.nextBillingDate, nextStartDate) < 0
                ? undefined
                : prev.nextBillingDate,
        };
      }
      return { ...prev, [key]: value };
    });
    const errorField = errorFieldByFormKey[key];
    if (errorField) onClearFieldError?.(errorField);
    if (key === "billingCycle") {
      onClearFieldError?.("customDays");
      onClearFieldError?.("oneTimeTerm");
    }
    // onFieldChange 是外层识别“用户明确修改过某字段”的钩子，例如新增订阅默认货币同步策略。
    // 这里保持泛型 key/value 绑定，避免调用方把字段和值的类型拆散。
    onFieldChange?.(key, value);
  }, [onClearFieldError, onFieldChange, setFormData]);

  const id = (name: string) => `${idPrefix}${name}`;
  const categoryId = id("category");

  // 货币选项受“设置 → 货币管理（启用/禁用）”控制：
  // - 默认只展示 enabled=true 的货币
  // - 若当前值是“已禁用货币”（例如历史订阅数据），仍展示一个不可选项用于回显，避免选择器空白
  const currencyOptions = useMemo(
    () =>
      createCurrencySelectOptions({
        currencies: config.currencies,
        currencyOptions: CURRENCY_OPTIONS,
        includeDisabledCurrent: formData.currency,
        locale,
      }),
    [config.currencies, formData.currency, locale],
  );
  const statusLabel = config.statuses.find((status) => status.value === formData.status)?.labels;
  const categoryLabel = config.categories.find((category) => category.value === formData.category)?.labels;
  const paymentMethodLabel =
    config.paymentMethods.find((method) => method.value === formData.paymentMethod)?.labels;
  const repeatReminderSentenceInterval = label(REPEAT_REMINDER_SENTENCE_INTERVAL_LABELS[formData.repeatReminderInterval]);
  const repeatReminderWindowHours =
    formData.repeatReminderWindow === "full" ? null : Number.parseInt(formData.repeatReminderWindow, 10);
  const isReminderDisabled = formData.reminderType === "disabled";
  const isOneTimeBuyout = formData.billingCycle === "one-time" && formData.oneTimeMode === "buyout";
  const reminderDaysForPreview = isReminderDisabled || formData.reminderType === "inherit"
    ? notificationReminderDays
    : toReminderDays(formData);
  const repeatReminderPreview =
    repeatReminderWindowHours === null || reminderDaysForPreview * 24 <= repeatReminderWindowHours
      ? t("subscription.repeatReminderPreview.afterFirst", { interval: repeatReminderSentenceInterval })
      : t("subscription.repeatReminderPreview.finalWindow", { hours: repeatReminderWindowHours });

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={id("name")}>{t("subscription.field.name")}</Label>
        <Input
          id={id("name")} name={id("name")} enterKeyHint="next"
          placeholder={t("subscription.placeholder.name")}
          value={formData.name}
          onChange={(e) => update("name", e.target.value)}
          required
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? id("name-error") : undefined}
          className="border-border bg-secondary"
        />
        <FieldError id={id("name-error")} message={errors.name} />
      </div>

      {showLogoField ? (
        <LogoPicker
          value={formData.logo}
          onChange={(logo) => update("logo", logo)}
          onUploadStatusChange={onLogoUploadStatusChange}
          serviceName={formData.name}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={id("price")}>{t("subscription.field.price")}</Label>
          <NumericInput
            id={id("price")} name={id("price")}
            allowNegative={false}
            allowedDecimalSeparators={[".", "。"]}
            inputMode="decimal" enterKeyHint="next"
            placeholder="0.00"
            thousandSeparator
            value={formData.price}
            onRawValueChange={(value: string) => update("price", value)}
            required
            aria-invalid={Boolean(errors.price)}
            aria-describedby={errors.price ? id("price-error") : undefined}
            className="border-border bg-secondary"
          />
          <FieldError id={id("price-error")} message={errors.price} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id("currency")}>{t("subscription.field.currency")}</Label>
          <SearchableSelect
            value={formData.currency}
            onValueChange={(value) => update("currency", value)}
            options={currencyOptions}
            placeholder={t("subscription.placeholder.currency")}
            searchPlaceholder={t("subscription.search.currency")}
            emptyMessage={t("subscription.empty.currency")}
            className={cn(
              "border-border bg-secondary",
              errors.currency && "border-destructive focus:ring-destructive/40",
            )}
            aria-label={t("subscription.placeholder.currency")}
            aria-invalid={Boolean(errors.currency)}
            aria-describedby={errors.currency ? id("currency-error") : undefined}
          />
          <FieldError id={id("currency-error")} message={errors.currency} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={id("status")}>{t("subscription.field.status")}</Label>
          <Select value={formData.status} onValueChange={(value) => update("status", value as SubscriptionStatus)}>
            <SelectTrigger className="border-border bg-secondary" tooltipContent={statusLabel ? label(statusLabel) : formData.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.statuses.map((status) => (
                <SelectItem key={status.id} value={status.value}>
                  {label(status.labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={categoryId}>{t("subscription.field.category")}</Label>
          <Select value={formData.category} onValueChange={(value) => update("category", value)}>
            <SelectTrigger className="border-border bg-secondary" tooltipContent={categoryLabel ? label(categoryLabel) : formData.category}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.categories.map((category) => (
                <SelectItem key={category.id} value={category.value}>
                  {label(category.labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={id("cycle")}>{t("subscription.field.billingCycle")}</Label>
          <Select
            value={formData.billingCycle}
            onValueChange={(value) => update("billingCycle", value as BillingCycle)}
          >
            <SelectTrigger
              id={id("cycle")}
              className={cn(
                "border-border bg-secondary",
                errors.billingCycle && "border-destructive focus:ring-destructive/40",
              )}
              aria-label={t("subscription.field.billingCycle")}
              aria-invalid={Boolean(errors.billingCycle)}
              aria-describedby={errors.billingCycle ? id("billingCycle-error") : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CYCLE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {localizedLabel(label, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={id("billingCycle-error")} message={errors.billingCycle} />
        </div>

        {formData.billingCycle === "custom" ? (
          <div className="grid gap-2">
            <Label htmlFor={id("customDays")}>{t("subscription.field.customCycle")}</Label>
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_5rem] items-center gap-2" data-testid="custom-cycle-inline-control">
              <span className="whitespace-nowrap text-sm text-muted-foreground">{t("subscription.customCycleEvery")}</span>
              <NumericInput
                id={id("customDays")} name={id("customDays")}
                allowNegative={false}
                decimalScale={0}
                inputMode="numeric" enterKeyHint="next"
                placeholder={t("subscription.customCycleCountPlaceholder")}
                value={formData.customDays}
                onRawValueChange={(value: string) => update("customDays", value)}
                aria-invalid={Boolean(errors.customDays)}
                aria-describedby={errors.customDays ? id("customDays-error") : undefined}
                className="min-w-0 border-border bg-secondary"
              />
              <Select
                value={formData.customCycleUnit}
                onValueChange={(value) => update("customCycleUnit", value as SubscriptionFormState["customCycleUnit"])}
              >
                <SelectTrigger
                  id={id("customCycleUnit")}
                  className="h-10 min-w-0 overflow-hidden border-border bg-secondary px-2"
                  aria-label={t("subscription.field.customCycleUnit")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_CYCLE_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {t(customCycleUnitLabelKey(unit))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FieldError id={id("customDays-error")} message={errors.customDays} />
          </div>
        ) : formData.billingCycle === "one-time" ? (
          <div className="grid gap-2">
            <Label>{t("subscription.field.oneTimeMode")}</Label>
            <div className="grid grid-cols-2 rounded-md border border-border bg-secondary p-1" role="group" aria-label={t("subscription.field.oneTimeMode")}>
              {(["term", "buyout"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "inline-flex min-h-8 min-w-0 items-center justify-center whitespace-nowrap rounded-sm px-2 text-sm font-medium transition-colors",
                    formData.oneTimeMode === mode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={formData.oneTimeMode === mode}
                  onClick={() => update("oneTimeMode", mode)}
                >
                  {mode === "term" ? t("subscription.oneTimeMode.term") : t("subscription.oneTimeMode.buyout")}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor={id("paymentMethod")}>{t("subscription.field.paymentMethod")}</Label>
            <SubscriptionPaymentMethodSelect
              value={formData.paymentMethod}
              methods={config.paymentMethods}
              labelFor={label}
              placeholder={t("subscription.placeholder.paymentMethod")}
              tooltipContent={paymentMethodLabel ? label(paymentMethodLabel) : undefined}
              onValueChange={(value) => update("paymentMethod", value)}
            />
          </div>
        )}
      </div>

      {formData.billingCycle === "one-time" && formData.oneTimeMode === "term" ? (
        <div className="grid gap-2">
          <Label htmlFor={id("oneTimeTermCount")}>{t("subscription.field.oneTimeTerm")}</Label>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_5rem] items-center gap-2" data-testid="one-time-term-inline-control">
            <span className="whitespace-nowrap text-sm text-muted-foreground">{t("subscription.oneTimeTermFor")}</span>
            <NumericInput
              id={id("oneTimeTermCount")} name={id("oneTimeTermCount")}
              allowNegative={false}
              decimalScale={0}
              inputMode="numeric" enterKeyHint="next"
              placeholder={t("subscription.customCycleCountPlaceholder")}
              value={formData.oneTimeTermCount}
              onRawValueChange={(value: string) => update("oneTimeTermCount", value)}
              aria-invalid={Boolean(errors.oneTimeTerm)}
              aria-describedby={errors.oneTimeTerm ? id("oneTimeTerm-error") : undefined}
              className="min-w-0 border-border bg-secondary"
            />
            <Select
              value={formData.oneTimeTermUnit}
              onValueChange={(value) => update("oneTimeTermUnit", value as SubscriptionFormState["oneTimeTermUnit"])}
            >
              <SelectTrigger
                id={id("oneTimeTermUnit")}
                className="h-10 min-w-0 overflow-hidden border-border bg-secondary px-2"
                aria-label={t("subscription.field.oneTimeTermUnit")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_CYCLE_UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {t(customCycleUnitLabelKey(unit))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t("subscription.oneTimeTermHelp")}</p>
          <FieldError id={id("oneTimeTerm-error")} message={errors.oneTimeTerm} />
        </div>
      ) : null}

      {(formData.billingCycle === "custom" || formData.billingCycle === "one-time") && (
        <div className="grid gap-2">
          <Label htmlFor={id("paymentMethod")}>{t("subscription.field.paymentMethod")}</Label>
          <SubscriptionPaymentMethodSelect
            value={formData.paymentMethod}
            methods={config.paymentMethods}
            labelFor={label}
            placeholder={t("subscription.placeholder.paymentMethod")}
            tooltipContent={paymentMethodLabel ? label(paymentMethodLabel) : undefined}
            onValueChange={(value) => update("paymentMethod", value)}
          />
        </div>
      )}

      {formData.billingCycle !== "one-time" ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/30 p-3">
          <div className="min-w-0">
            <Label htmlFor={id("autoRenew")} className="cursor-pointer text-sm font-medium">
              {t("subscription.autoRenew")}
            </Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("subscription.autoRenewHelp")}</p>
          </div>
          <Switch
            id={id("autoRenew")}
            checked={formData.autoRenew}
            onCheckedChange={(checked) => update("autoRenew", checked)}
            aria-label={t("subscription.autoRenew")}
          />
        </div>
      ) : null}

      <SubscriptionFormDateFields id={id} formData={formData} update={update} errors={errors} />

      {isOneTimeBuyout ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/30 p-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">{t("subscription.field.reminder")}</Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("subscription.oneTimeBuyoutReminderHelp")}</p>
          </div>
          <span className="shrink-0 text-sm font-medium text-muted-foreground">{t("subscription.reminderDisabledStatus")}</span>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/30 p-3">
            <div className="min-w-0">
              <Label htmlFor={id("reminderEnabled")} className="cursor-pointer text-sm font-medium">
                {t("subscription.field.reminder")}
              </Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {isReminderDisabled ? t("subscription.reminderDisabledHelp") : t("subscription.reminderEnabledHelp")}
              </p>
            </div>
            <Switch
              id={id("reminderEnabled")}
              checked={!isReminderDisabled}
              onCheckedChange={(checked) => {
                if (checked) {
                  update("reminderType", "inherit");
                  update("reminderDays", String(INHERIT_REMINDER_DAYS));
                  update("repeatReminderEnabled", false);
                } else {
                  update("reminderType", "disabled");
                  update("reminderDays", String(DISABLED_REMINDER_DAYS));
                  update("repeatReminderEnabled", false);
                }
              }}
              aria-label={t("subscription.field.reminder")}
            />
          </div>

          {!isReminderDisabled ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Select
                  value={formData.reminderType === "custom" ? "custom" : formData.reminderType === "inherit" ? String(INHERIT_REMINDER_DAYS) : formData.reminderDays}
                  onValueChange={(value) => {
                    if (value === "custom") {
                      update("reminderType", "custom");
                    } else if (value === String(INHERIT_REMINDER_DAYS)) {
                      update("reminderType", "inherit");
                      update("reminderDays", String(INHERIT_REMINDER_DAYS));
                    } else {
                      update("reminderType", "preset");
                      update("reminderDays", value);
                    }
                  }}
                >
                  <SelectTrigger
                    id={id("reminderDays")}
                    className={cn(
                      "w-full border-border bg-secondary sm:flex-1",
                      errors.reminderDays && "border-destructive focus:ring-destructive/40",
                    )}
                    aria-invalid={Boolean(errors.reminderDays)}
                    aria-describedby={errors.reminderDays ? id("reminder-error") : undefined}
                    aria-label={t("subscription.field.reminder")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(INHERIT_REMINDER_DAYS)}>
                      {t("subscription.reminderInherit", { days: notificationReminderDays })}
                    </SelectItem>
                    {REMINDER_DAYS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {label(option.labels)}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">{t("subscription.reminderCustom")}</SelectItem>
                  </SelectContent>
                </Select>

                {formData.reminderType === "custom" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">{t("subscription.reminderBefore")}</span>
                    <NumericInput
                      name={id("customReminderDays")} allowNegative={false}
                      decimalScale={0}
                      inputMode="numeric" enterKeyHint="next"
                      placeholder={t("subscription.daysPlaceholder")}
                      value={formData.customReminderDays}
                      onRawValueChange={(value: string) => update("customReminderDays", value)}
                      aria-invalid={Boolean(errors.reminderDays)}
                      aria-describedby={errors.reminderDays ? id("reminder-error") : undefined}
                      className="w-20 border-border bg-secondary"
                    />
                    <span className="text-sm text-muted-foreground">{t("subscription.daysUnit")}</span>
                  </div>
                )}
              </div>
              <FieldError id={id("reminder-error")} message={errors.reminderDays} />

              <div className="flex items-center gap-2">
                <Label htmlFor={id("repeatReminderEnabled")} className="text-sm text-muted-foreground cursor-pointer">
                  {t("subscription.repeatReminder")}
                </Label>
                <Switch
                  id={id("repeatReminderEnabled")}
                  checked={formData.repeatReminderEnabled}
                  onCheckedChange={(checked) => update("repeatReminderEnabled", checked)}
                />
              </div>

              {formData.repeatReminderEnabled && (
                <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor={id("repeatReminderInterval")}>{t("subscription.repeatReminderInterval")}</Label>
                    <Select
                      value={formData.repeatReminderInterval}
                      onValueChange={(value) => update("repeatReminderInterval", value as RepeatReminderInterval)}
                    >
                      <SelectTrigger id={id("repeatReminderInterval")} className="border-border bg-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPEAT_REMINDER_INTERVAL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {label(option.labels)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={id("repeatReminderWindow")}>{t("subscription.repeatReminderWindow")}</Label>
                    <Select
                      value={formData.repeatReminderWindow}
                      onValueChange={(value) => update("repeatReminderWindow", value as RepeatReminderWindow)}
                    >
                      <SelectTrigger id={id("repeatReminderWindow")} className="border-border bg-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPEAT_REMINDER_WINDOW_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {label(option.labels)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">{repeatReminderPreview}</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      <CostSharingFields
        id={id}
        formData={formData}
        update={update}
        error={errors.costSharing}
        currencyOptions={currencyOptions}
        currencyConvert={costSharingCurrencyConvert}
      />

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/30 p-3">
        <div className="min-w-0">
          <Label htmlFor={id("publicHidden")} className="cursor-pointer text-sm font-medium">
            {t("subscription.publicHidden")}
          </Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("subscription.publicHiddenHelp")}</p>
        </div>
        <Switch
          id={id("publicHidden")}
          checked={formData.publicHidden}
          onCheckedChange={(checked) => update("publicHidden", checked)}
          aria-label={t("subscription.publicHidden")}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("website")}>{t("subscription.field.website")}</Label>
        <Input
          id={id("website")} name={id("website")} type="url" inputMode="url" enterKeyHint="next" autoCapitalize="none" spellCheck={false}
          placeholder="https://example.com"
          value={formData.website}
          onChange={(e) => update("website", e.target.value)}
          aria-invalid={Boolean(errors.website)}
          aria-describedby={errors.website ? id("website-error") : undefined}
          className="border-border bg-secondary"
        />
        <FieldError id={id("website-error")} message={errors.website} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("notes")}>{t("subscription.field.notes")}</Label>
        <Input
          id={id("notes")} name={id("notes")} enterKeyHint="done"
          placeholder={t("subscription.placeholder.notes")}
          value={formData.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="border-border bg-secondary"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={id("tags")}>{t("subscription.field.tags")}</Label>
        <SubscriptionTagInput
          id={id("tags")}
          value={formData.tags}
          onChange={(tags) => update("tags", tags)}
          suggestions={availableTags}
          error={errors.tags}
          errorId={id("tags-error")}
          onClearError={() => onClearFieldError?.("tags")}
        />
      </div>
    </>
  );
});
