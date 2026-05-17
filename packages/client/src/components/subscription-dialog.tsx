/**
 * 订阅弹窗（新增/编辑复用）。
 *
 * 架构位置：
 * - Add/Edit 适配器只负责打开方式。
 * - 本组件负责表单状态初始化、自动计算下次扣费日、上传状态阻塞和提交转换。
 *
 * 状态链路：
 * ```
 * props(open/subscription) -> 初始化 formData
 * 用户编辑 -> SubscriptionFormFields
 * 提交 -> toSubscriptionDraft -> onSubmit(create/update)
 * ```
 *
 * 注意： Logo 上传中的状态由 `logoUploadStatus` 控制，提交时必须阻止 data URL 进入订阅数据。
 * 注意： 新增模式的默认货币会跟随 Settings/defaultCurrency，但用户手动选择后必须停止自动同步。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { SubscriptionFormFields, type SubscriptionFormErrors } from "@/components/subscription-form-fields";
import type { UploadStatus as LogoUploadStatus } from "@/components/logo-picker";
import { calculateNextBillingDate } from "@/lib/subscription-billing";
import {
  isOptionalHttpUrl,
  getTagsValidationError,
  parseNonNegativeFiniteNumberInput,
  parseNonNegativeIntegerInput,
  parsePositiveIntegerInput,
  toSubscriptionDraft,
} from "@/lib/subscription-form";
import { useCustomConfig } from "@/contexts/CustomConfigContext";
import { useDeferredDialogCleanup } from "@/hooks/use-deferred-dialog-cleanup";
import { useSettings } from "@/hooks/use-settings";
import type { Subscription, SubscriptionDraft } from "@/types/subscription";
import { REMINDER_DAYS_OPTIONS } from "@/types/subscription";
import { createSubscriptionFormState, type SubscriptionFormState } from "@/types/subscription-form";
import { useI18n } from "@/i18n/I18nProvider";
import { todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import { getSystemTimeZone } from "@/lib/time/time-zone";

type CreateDialogProps = {
  mode: "create";
  /** 弹窗是否打开（由上层控制）。 */
  open: boolean;
  /** 弹窗开关回调。 */
  onOpenChange: (open: boolean) => void;
  /** 新增提交回调（不含 id）。 */
  onSubmit: (subscription: SubscriptionDraft) => void;
  /** 当前用户已有标签建议。 */
  availableTags?: readonly string[] | undefined;
  /** 触发器（可选，通常是“添加订阅”按钮）。 */
  trigger?: ReactNode;
};

type EditDialogProps = {
  mode: "edit";
  /** 弹窗是否打开（由上层控制）。 */
  open: boolean;
  /** 弹窗开关回调。 */
  onOpenChange: (open: boolean) => void;
  /** 当前正在编辑的订阅（null 表示未选中）。 */
  subscription: Subscription | null;
  /** 保存回调（回传完整 Subscription）。 */
  onSubmit: (subscription: Subscription) => void;
  /** 当前用户已有标签建议。 */
  availableTags?: readonly string[] | undefined;
};

export type SubscriptionDialogProps = CreateDialogProps | EditDialogProps;

/** 订阅弹窗组件（新增/编辑共用）。 */
export function SubscriptionDialog(props: SubscriptionDialogProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { config } = useCustomConfig();
  const { data: settings } = useSettings();
  const { t } = useI18n();
  const statisticCurrency = settings?.defaultCurrency ?? "CNY";

  // 新建订阅时默认货币：
  // - 优先使用“统计货币”（Settings.defaultCurrency）
  // - 若该货币被用户在「货币管理」中禁用，则回退到第一个启用的货币
  // 注意： 这里和 Settings 的“不能禁用统计货币”策略互相补位，保证新建订阅永远有可用默认货币。
  const enabledCurrencyValues = useMemo(
    () => config.currencies.filter((c) => c.enabled !== false).map((c) => c.value),
    [config.currencies],
  );
  const defaultCreateCurrency = useMemo(() => {
    if (enabledCurrencyValues.includes(statisticCurrency)) return statisticCurrency;
    return enabledCurrencyValues[0] ?? statisticCurrency;
  }, [enabledCurrencyValues, statisticCurrency]);
  const billingReferenceDate = useMemo(
    () => todayDateOnlyInTimeZone(new Date(), settings?.timezone ?? getSystemTimeZone("UTC")),
    [settings?.timezone],
  );

  const [logoUploadStatus, setLogoUploadStatus] = useState<LogoUploadStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<SubscriptionFormErrors>({});
  const [createCurrencyManuallySelected, setCreateCurrencyManuallySelected] = useState(false);
  const [formData, setFormData] = useState<SubscriptionFormState>(() =>
    props.mode === "edit"
      ? createSubscriptionFormState()
      : createSubscriptionFormState({ currency: defaultCreateCurrency }),
  );
  const resetTransientDialogState = useCallback(() => {
    setLogoUploadStatus("idle");
    setSubmitError(null);
    setFormErrors({});
  }, []);
  const { scheduleCleanup: scheduleTransientCleanup, cancelCleanup: cancelTransientCleanup } =
    useDeferredDialogCleanup(resetTransientDialogState);

  const editSubscription = props.mode === "edit" ? props.subscription : null;

  const idPrefix = props.mode === "edit" ? "edit-" : "";

  // 弹窗关闭动画开始后再重置临时状态，避免关闭交互帧叠加额外 setState。
  useEffect(() => {
    if (props.open) {
      cancelTransientCleanup();
      return;
    }
    scheduleTransientCleanup();
  }, [cancelTransientCleanup, props.open, scheduleTransientCleanup]);

  // 新增模式：当弹窗打开且表单处于“空白态”时，同步默认货币为统计货币（或启用的第一项）。
  // 这样用户在设置页切换统计货币后，新增订阅的默认货币也会跟随更新。
  useEffect(() => {
    if (props.mode !== "create") return;
    if (!props.open) return;

    const isPristine =
      formData.name.trim().length === 0 &&
      formData.price.trim().length === 0 &&
      formData.website.trim().length === 0 &&
      formData.notes.trim().length === 0 &&
      formData.tags.length === 0;

    const currencyDisabled = !enabledCurrencyValues.includes(formData.currency);
    const shouldSync = (!createCurrencyManuallySelected && isPristine) || currencyDisabled;

    // 只在空白态同步默认货币，是为了避免用户输入到一半时被 settings 异步刷新覆盖；
    // 但当前货币已被禁用时必须强制修正，否则提交会写入不可选配置值。
    if (shouldSync && formData.currency !== defaultCreateCurrency) {
      setFormData((prev) => ({ ...prev, currency: defaultCreateCurrency }));
    }
  }, [
    defaultCreateCurrency,
    enabledCurrencyValues,
    createCurrencyManuallySelected,
    formData.currency,
    formData.name,
    formData.notes,
    formData.price,
    formData.tags,
    formData.website,
    props.mode,
    props.open,
  ]);

  // 编辑模式：每次打开（或 subscription 变化）都用 subscription 重新初始化表单，避免“关闭后再打开仍保留未保存修改”。
  useEffect(() => {
    if (props.mode !== "edit") return;
    if (!props.open) return;
    if (!editSubscription) return;

    const subscription = editSubscription;
    const isPresetReminder = REMINDER_DAYS_OPTIONS.some((opt) => opt.value === subscription.reminderDays);

    setFormData({
      name: subscription.name,
      logo: subscription.logo,
      price: subscription.price.toString(),
      currency: subscription.currency,
      billingCycle: subscription.billingCycle,
      customDays: subscription.customDays?.toString() || "",
      category: subscription.category,
      status: subscription.status,
      paymentMethod: subscription.paymentMethod || "",
      startDate: subscription.startDate,
      nextBillingDate: subscription.nextBillingDate,
      autoCalculate: subscription.autoCalculateNextBillingDate,
      reminderType: isPresetReminder ? "preset" : "custom",
      reminderDays: isPresetReminder ? subscription.reminderDays.toString() : "3",
      customReminderDays: !isPresetReminder ? subscription.reminderDays.toString() : "",
      repeatReminderEnabled: subscription.repeatReminderEnabled,
      repeatReminderInterval: subscription.repeatReminderInterval,
      repeatReminderWindow: subscription.repeatReminderWindow,
      website: subscription.website ?? "",
      notes: subscription.notes ?? "",
      tags: subscription.tags ?? [],
    });
    setLogoUploadStatus("idle");
    setFormErrors({});
  }, [editSubscription, props.mode, props.open]);

  // 自动推算 nextBillingDate（仅当 autoCalculate=true 且已选择 startDate）。
  // 注意： 这里依赖 DateOnly 字符串算法，不应引入 JS Date 时区换算，否则跨时区用户会看到扣费日漂移。
  useEffect(() => {
    if (formData.autoCalculate && formData.startDate) {
      const customDays = formData.billingCycle === "custom" ? parsePositiveIntegerInput(formData.customDays) ?? 30 : undefined;
      const nextDate = calculateNextBillingDate(formData.startDate, formData.billingCycle, customDays, billingReferenceDate);
      setFormData((prev) => ({ ...prev, nextBillingDate: nextDate }));
    }
  }, [billingReferenceDate, formData.startDate, formData.billingCycle, formData.customDays, formData.autoCalculate]);

  /** 表单提交：create → 回传 draft；edit → merge id 后回传完整 Subscription。 */
  const handleFieldChange = useCallback(
    (key: keyof SubscriptionFormState) => {
      if (props.mode === "create" && key === "currency") {
        setCreateCurrencyManuallySelected(true);
      }
    },
    [props.mode],
  );

  const validateForm = useCallback(() => {
    const errors: SubscriptionFormErrors = {};

    if (!formData.name.trim()) errors.name = t("subscription.validation.nameRequired");
    if (parseNonNegativeFiniteNumberInput(formData.price) === null) {
      errors.price = t("subscription.validation.amountInvalid");
    }
    if (!formData.startDate || !formData.nextBillingDate) {
      errors.dates = t("subscription.validation.datesRequired");
    }
    if (formData.billingCycle === "custom" && parsePositiveIntegerInput(formData.customDays) === null) {
      errors.customDays = t("subscription.validation.customCycleInvalid");
    }
    if (parseNonNegativeIntegerInput(
      formData.reminderType === "custom" ? formData.customReminderDays : formData.reminderDays,
    ) === null) {
      errors.reminderDays = t("subscription.validation.reminderInvalid");
    }
    if (!isOptionalHttpUrl(formData.website)) {
      errors.website = t("subscription.validation.websiteInvalid");
    }
    const tagsError = getTagsValidationError(formData.tags);
    if (tagsError) {
      errors.tags = tagsError;
    }

    return errors;
  }, [formData, t]);

  const clearFieldError = useCallback((field: keyof SubscriptionFormErrors) => {
    setSubmitError(null);
    setFormErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // 彻底杜绝把临时 data URL 写入数据库：上传未完成时禁止提交
    if (logoUploadStatus === "uploading") return;

    const nextErrors = validateForm();
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      setSubmitError(null);
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled])')?.focus();
      return;
    }

    setFormErrors({});
    const draft = toSubscriptionDraft(formData);
    if (!draft) {
      setSubmitError(t("subscription.formIncomplete"));
      return;
    }
    setSubmitError(null);

    if (props.mode === "create") {
      props.onSubmit(draft);
      setFormData(createSubscriptionFormState({ currency: defaultCreateCurrency }));
      setCreateCurrencyManuallySelected(false);
      setLogoUploadStatus("idle");
      setFormErrors({});
      props.onOpenChange(false);
      return;
    }

    const base = props.subscription;
    if (!base) return;
    props.onSubmit({ ...base, ...draft });
    setFormErrors({});
    props.onOpenChange(false);
  };

  const submitDisabled = logoUploadStatus === "uploading";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {"trigger" in props && props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}

      <DialogContent className="flex max-h-[90vh] min-h-0 flex-col border-border bg-card p-0 sm:max-w-lg">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-xl font-semibold">
            {props.mode === "create" ? t("subscription.dialogCreateTitle") : t("subscription.dialogEditTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {props.mode === "create"
              ? t("subscription.dialogCreateDescription")
              : t("subscription.dialogEditDescription")}
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden" noValidate>
          <div className="min-h-0 flex-1 grid gap-5 overflow-y-auto px-6 py-4">
            <SubscriptionFormFields
              idPrefix={idPrefix}
              config={config}
              formData={formData}
              setFormData={setFormData}
              availableTags={props.availableTags}
              onLogoUploadStatusChange={setLogoUploadStatus}
              onFieldChange={handleFieldChange}
              errors={formErrors}
              onClearFieldError={clearFieldError}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border bg-card p-6 pt-4 sm:flex-row sm:justify-end">
            {submitError ? (
              <p className="w-full min-w-0 break-words text-center text-sm text-destructive sm:mr-auto sm:w-auto sm:text-left">
                {submitError}
              </p>
            ) : null}
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} className="w-full border-border sm:w-auto">
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitDisabled}
              className="w-full bg-primary text-primary-foreground hover:bg-primary-glow sm:w-auto"
            >
              {logoUploadStatus === "uploading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {props.mode === "create" ? t("subscription.dialogCreateSubmit") : t("subscription.dialogEditSubmit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
