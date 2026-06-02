/**
 * 设置页 application controller。
 *
 * 架构位置：
 * - presentation 只渲染 `SettingsScreen`，所有副作用都在这里收敛。
 * - domain 只提供纯规则（分类使用计数、货币启用策略），避免框架依赖进入业务规则。
 *
 * 关键依赖：
 * - React Query hooks：读取/保存 settings、subscriptions、自定义配置。
 * - 本地 ThemeProvider + theme-storage：处理“立即预览但稍后保存”的外观状态。
 * - toast/api hooks：把网络错误转成用户可理解的反馈。
 *
 * 状态流转：
 * ```
 * 远端 settings -> 首次初始化本地表单
 *              -> 若本地外观有 pending，则外观字段以 localStorage 为准
 * 用户编辑表单 -> draft state
 *              -> 保存更改 -> API -> React Query 缓存 + saved snapshot
 * ```
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearThemeModeOverride, useTheme } from "@/lib/theme-provider";
import { useCustomConfig } from "@/contexts/CustomConfigContext";
import { useExchangeRates } from "@/hooks/use-exchange-rates";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { usePasswordResetAvailability } from "@/hooks/use-password-reset-availability";
import { useCalendarFeedStatus, useCreateCalendarFeed, useDeleteCalendarFeed } from "@/hooks/use-calendar-feed";
import { useToast } from "@/hooks/use-toast";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { applyThemeVariant } from "@/lib/theme-variant";
import {
  readAppearancePendingFromStorage,
  readSettingsAppearanceDraftFromStorage,
  clearSettingsAppearanceDraftFromStorage,
  writeAppearancePendingToStorage,
  writeCustomThemeColorToStorage,
  writeSettingsThemeModeToStorage,
  writeThemeVariantToStorage,
} from "@/lib/theme-storage";
import type { ExchangeRateProvider, ExchangeRates } from "@/lib/api/schemas/exchange-rates";
import type { CalendarFeedStatus } from "@/lib/api/schemas/calendar-feed";
import { DEFAULT_SETTINGS, type AppSettings, type NotificationChannel, type Subscription } from "@/types/subscription";
import { normalizePaymentMethods, type ConfigItem, type CustomConfig } from "@/types/config";
import type { CustomThemeColor, ThemeMode, ThemeVariant } from "@/types/theme";
import { parseNonNegativeFiniteNumberInput } from "@/lib/subscription-form";
import { normalizeCustomConfig } from "@/modules/custom-config/domain/normalize-custom-config";
import { isCloudflareRuntime } from "@/services/runtime";
import { countSubscriptionsByCategory } from "../domain/category-usage";
import { enforceCurrencyConfigPolicy } from "../domain/currency-config-policy";
import { useAccountIdentity } from "./use-account-email";
import { useNotificationTest } from "./use-notification-test";
import { usePasswordChange, type PasswordChangeController } from "./use-password-change";
import {
  useNotificationHistory,
  type NotificationHistoryResponse,
  type NotificationHistoryStatusFilter,
} from "./use-notification-history";
import { useI18n } from "@/i18n/I18nProvider";

type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numericField(value: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number") return candidate;
  }
  return null;
}

function stringField(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function isPocketBaseUpdateRecord400(error: unknown): boolean {
  if (!isObjectRecord(error)) return false;

  const response = isObjectRecord(error["response"]) ? error["response"] : null;
  // PocketBase SDK/自定义 API 对错误对象包装不完全一致，因此这里从顶层和 response 双路径读取状态码。
  const status = numericField(error, ["status", "statusCode"])
    ?? (response ? numericField(response, ["status", "statusCode"]) : null);
  if (status !== 400) return false;

  const message = [
    stringField(error, ["message", "detail", "error"]),
    response ? stringField(response, ["message", "detail", "error"]) : null,
  ].filter(Boolean).join(" ").toLowerCase();

  return message.includes("failed to update record");
}

function getExchangeRateProviderSaveErrorMessage(error: unknown, t: ReturnType<typeof useI18n>["t"]) {
  if (isPocketBaseUpdateRecord400(error)) {
    return t("settings.exchangeRateProviderServerOutdated");
  }
  return getDisplayErrorMessage(error, t("settings.exchangeRateProviderSaveFailed"));
}

function areJsonSnapshotsEqual(left: unknown, right: unknown): boolean {
  // settings/customConfig 都是由 schema 生成的稳定普通对象；用 JSON 快照比深比较依赖更轻量。
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeAccountRecipientEmail(accountEmail: string | null): string {
  const email = (accountEmail ?? "").trim();
  return email && email.includes("@") ? email : "";
}

function createDraftSettingsFromRemote(remoteSettings: AppSettings, accountEmail: string | null): AppSettings {
  const recipientEmail = remoteSettings.recipientEmail.trim()
    ? remoteSettings.recipientEmail
    : normalizeAccountRecipientEmail(accountEmail);
  const baseSettings: AppSettings = recipientEmail && recipientEmail !== remoteSettings.recipientEmail
    ? { ...remoteSettings, recipientEmail }
    : remoteSettings;

  if (!readAppearancePendingFromStorage()) return baseSettings;
  // Settings 外观草稿用独立 pending 存储恢复；不能读取 Header 的本机主题偏好，否则全局切换会污染表单 dirty。
  const appearanceDraft = readSettingsAppearanceDraftFromStorage();
  return {
    ...baseSettings,
    themeMode: appearanceDraft.themeMode ?? baseSettings.themeMode,
    themeVariant: appearanceDraft.themeVariant ?? baseSettings.themeVariant,
    themeCustomColor: appearanceDraft.themeCustomColor ?? baseSettings.themeCustomColor,
  };
}

interface SettingsSubscriptionsQuery {
  data: Subscription[] | undefined;
  isPending: boolean;
  status: "pending" | "error" | "success";
}

interface SettingsNotificationHistoryController {
  data: NotificationHistoryResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  historyStatus: NotificationHistoryStatusFilter;
  setStatus: (status: NotificationHistoryStatusFilter) => void;
  loadMore: () => void;
  refetch: () => void | Promise<unknown>;
}

interface SettingsCalendarFeedController {
  data: CalendarFeedStatus | undefined;
  feedUrl: string | null;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  createOrRotate: () => Promise<void>;
  copyUrl: () => Promise<void>;
  regenerate: () => Promise<void>;
  revoke: () => Promise<void>;
}

export interface SettingsFormController {
  settings: AppSettings;
  effectiveThemeMode: ThemeMode;
  accountEmail: string | null;
  canAccessPocketBaseAdmin: boolean;
  customConfig: CustomConfig;
  subscriptionsQuery: SettingsSubscriptionsQuery;
  categoryUsageCount: Map<string, number>;
  rates: ExchangeRates;
  activeRateProvider: ExchangeRateProvider | "builtin";
  ratesLoading: boolean;
  lastUpdated: Date | null;
  ratesError: string | null;
  getCurrencySymbol: (currency: string) => string;
  updateCategories: (items: ConfigItem[]) => void;
  updateStatuses: (items: ConfigItem[]) => void;
  updatePaymentMethods: (items: ConfigItem[]) => void;
  updateCurrencies: (items: ConfigItem[]) => void;
  updateSetting: UpdateSetting;
  monthlyBudgetError: string | null;
  handleMonthlyBudgetInputChange: (rawValue: string) => void;
  toggleChannel: (channel: NotificationChannel) => void;
  handleRefreshRates: () => Promise<void>;
  handleUpdateCurrencies: (items: ConfigItem[]) => void;
  hasUnsavedChanges: boolean;
  handleSaveChanges: () => Promise<void>;
  handleDiscardChanges: () => void;
  isSavingSettings: boolean;
  handleDefaultCurrencyChange: (value: string) => void;
  handleExchangeRateProviderChange: (value: ExchangeRateProvider) => void;
  handleThemeModeChange: (value: ThemeMode) => void;
  handleThemeVariantChange: (value: ThemeVariant) => void;
  handleThemeCustomColorChange: (value: CustomThemeColor) => void;
  testingChannel: NotificationChannel | null;
  handleTestConnection: (channel: NotificationChannel) => void | Promise<void>;
  notificationHistory: SettingsNotificationHistoryController;
  calendarFeed: SettingsCalendarFeedController;
  password: PasswordChangeController;
  passwordResetEnabled: boolean;
}

/**
 * 集中协调 Settings 页的远端状态、本地编辑态和跨模块用例。
 *
 * 注意： Settings 页只有这一处写入口。新增设置字段时，要同时检查：
 * settings schema、默认值、API merge 策略，以及是否应该纳入统一保存草稿。
 */
export function useSettingsFormController(): SettingsFormController {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [customConfig, setCustomConfig] = useState<CustomConfig>(() => normalizeCustomConfig(null));
  const [savedCustomConfig, setSavedCustomConfig] = useState<CustomConfig>(() => normalizeCustomConfig(null));
  const [hasInitializedFromRemote, setHasInitializedFromRemote] = useState(false);
  const [hasInitializedCustomConfig, setHasInitializedCustomConfig] = useState(false);
  const [monthlyBudgetError, setMonthlyBudgetError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const accountIdentity = useAccountIdentity();
  const accountEmail = accountIdentity.email;
  const { data: remoteSettings } = useSettings();
  const subscriptionsQuery = useSubscriptions();
  const updateSettings = useUpdateSettings();
  const { theme, setTheme } = useTheme();
  const { config: persistedCustomConfig, saveConfig } = useCustomConfig();
  const {
    rates,
    activeProvider: activeRateProvider,
    loading: ratesLoading,
    lastUpdated,
    refresh: refreshRates,
    error: ratesError,
    getCurrencySymbol,
  } = useExchangeRates(savedSettings.exchangeRateProvider);
  const { toast } = useToast();
  const { t, setLocale } = useI18n();
  const password = usePasswordChange();
  const passwordResetEnabled = usePasswordResetAvailability();
  const notificationTest = useNotificationTest(settings);
  const notificationHistory = useNotificationHistory();
  const calendarFeedStatus = useCalendarFeedStatus();
  const createCalendarFeed = useCreateCalendarFeed();
  const deleteCalendarFeed = useDeleteCalendarFeed();
  const { refetch: refetchNotificationHistory } = notificationHistory;
  const hasResolvedDefaultRecipientEmailRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  const customConfigDirtyRef = useRef(false);

  const categoryUsageCount = useMemo(
    () => countSubscriptionsByCategory(subscriptionsQuery.data ?? []),
    [subscriptionsQuery.data],
  );

  const settingsDirty = useMemo(
    () => !areJsonSnapshotsEqual(settings, savedSettings),
    [settings, savedSettings],
  );
  const customConfigDirty = useMemo(
    () => !areJsonSnapshotsEqual(customConfig, savedCustomConfig),
    [customConfig, savedCustomConfig],
  );
  const hasUnsavedChanges = settingsDirty || customConfigDirty;
  const effectiveThemeMode: ThemeMode = theme;

  useEffect(() => {
    // effect 读取 ref 而不是把 draft 放入依赖，是为了在远端刷新时判断“当前是否仍可安全覆盖本地草稿”。
    settingsDirtyRef.current = settingsDirty;
  }, [settingsDirty]);

  useEffect(() => {
    // 自定义配置可能由独立 Provider 防抖保存回流；dirty ref 防止回流覆盖用户正在编辑的草稿。
    customConfigDirtyRef.current = customConfigDirty;
  }, [customConfigDirty]);

  useEffect(() => {
    if (!remoteSettings) return;
    // 收件人邮箱默认值必须和远端 settings 同步在同一条 effect 里生成，避免 Cloudflare session 先恢复时被下一轮远端草稿覆盖。
    const shouldDefaultRecipientEmail = !hasResolvedDefaultRecipientEmailRef.current;
    const nextDraft = createDraftSettingsFromRemote(
      remoteSettings,
      shouldDefaultRecipientEmail ? accountEmail : null,
    );
    const hasResolvedRecipientEmail = Boolean(nextDraft.recipientEmail.trim());
    if (!hasInitializedFromRemote) {
      setSavedSettings(remoteSettings);
      setSettings(nextDraft);
      if (hasResolvedRecipientEmail) hasResolvedDefaultRecipientEmailRef.current = true;
      setHasInitializedFromRemote(true);
      return;
    }

    setSavedSettings(remoteSettings);
    // 只有本地草稿未脏时才用远端刷新覆盖，避免 React Query 背景刷新吞掉用户未保存编辑。
    if (!settingsDirtyRef.current) {
      setSettings(nextDraft);
      if (hasResolvedRecipientEmail) hasResolvedDefaultRecipientEmailRef.current = true;
    } else if (remoteSettings.recipientEmail.trim()) {
      hasResolvedDefaultRecipientEmailRef.current = true;
    }
  }, [accountEmail, hasInitializedFromRemote, remoteSettings]);

  useEffect(() => {
    const normalized = normalizeCustomConfig(persistedCustomConfig);
    if (!hasInitializedCustomConfig) {
      setSavedCustomConfig(normalized);
      setCustomConfig(normalized);
      setHasInitializedCustomConfig(true);
      return;
    }

    if (!customConfigDirtyRef.current) {
      // Provider 的防抖保存会回流远端配置；未脏时同步，脏时让用户继续编辑当前草稿。
      setSavedCustomConfig(normalized);
      setCustomConfig(normalized);
    }
  }, [hasInitializedCustomConfig, persistedCustomConfig]);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleMonthlyBudgetInputChange = useCallback(
    (rawValue: string) => {
      if (rawValue.trim() === "") {
        setMonthlyBudgetError(null);
        updateSetting("monthlyBudget", 0);
        return;
      }

      const parsed = parseNonNegativeFiniteNumberInput(rawValue);
      if (parsed === null) {
        setMonthlyBudgetError(t("settings.budgetInvalid"));
        return;
      }

      setMonthlyBudgetError(null);
      updateSetting("monthlyBudget", parsed);
    },
    [t, updateSetting],
  );

  const toggleChannel = useCallback((channel: NotificationChannel) => {
    setSettings((prev) => ({
      ...prev,
      enabledChannels: prev.enabledChannels.includes(channel)
        ? prev.enabledChannels.filter((c) => c !== channel)
        : [...prev.enabledChannels, channel],
    }));
  }, []);

  const updateCategories = useCallback((items: ConfigItem[]) => {
    setCustomConfig((prev) => ({ ...prev, categories: items }));
  }, []);

  const updateStatuses = useCallback((items: ConfigItem[]) => {
    setCustomConfig((prev) => ({ ...prev, statuses: items }));
  }, []);

  const updatePaymentMethods = useCallback((items: ConfigItem[]) => {
    setCustomConfig((prev) => ({ ...prev, paymentMethods: normalizePaymentMethods(items) }));
  }, []);

  const updateCurrencies = useCallback((items: ConfigItem[]) => {
    setCustomConfig((prev) => ({ ...prev, currencies: items }));
  }, []);

  const handleRefreshRates = useCallback(async () => {
    await refreshRates(savedSettings.exchangeRateProvider);
    toast({
      title: t("settings.ratesUpdated"),
      description: t("settings.ratesUpdatedDescription"),
    });
  }, [refreshRates, savedSettings.exchangeRateProvider, t, toast]);

  const handleUpdateCurrencies = useCallback(
    (items: ConfigItem[]) => {
      // 货币开关会影响新增订阅下拉和全站统计口径，因此策略放在 domain 层统一约束。
      const result = enforceCurrencyConfigPolicy(items, settings.defaultCurrency);
      if (result.ok) {
        updateCurrencies(result.items);
        return;
      }

      toast({
        title: result.reason === "none-enabled"
          ? t("settings.currencyPolicy.noneTitle")
          : t("settings.currencyPolicy.defaultTitle"),
        description: result.reason === "none-enabled"
          ? t("settings.currencyPolicy.noneDescription")
          : t("settings.currencyPolicy.defaultDescription", { currency: settings.defaultCurrency }),
        variant: "destructive",
      });

      if (result.items) updateCurrencies(result.items);
    },
    [settings.defaultCurrency, t, toast, updateCurrencies],
  );

  const syncSavedPreviewState = useCallback(
    (nextSettings: AppSettings, options: { syncAppearance: boolean }) => {
      if (options.syncAppearance) {
        clearThemeModeOverride();
        setTheme(nextSettings.themeMode, { localOverride: false });
        applyThemeVariant(nextSettings.themeVariant, nextSettings.themeCustomColor);
        writeThemeVariantToStorage(nextSettings.themeVariant);
        writeCustomThemeColorToStorage(nextSettings.themeCustomColor);
        clearSettingsAppearanceDraftFromStorage();
      }
      setLocale(nextSettings.locale, { persist: false, markAsSaved: true });
    },
    [setLocale, setTheme],
  );

  const handleSaveChanges = useCallback(async () => {
    if (isSavingSettings || !hasUnsavedChanges) return;
    if (monthlyBudgetError) {
      toast({
        title: t("settings.saveFailed"),
        description: monthlyBudgetError,
        variant: "destructive",
      });
      return;
    }

    setIsSavingSettings(true);
    const shouldSaveSettings = settingsDirty;
    const shouldSaveCustomConfig = customConfigDirty;
    const providerChanged = settings.exchangeRateProvider !== savedSettings.exchangeRateProvider;
    const appearanceChanged = settings.themeMode !== savedSettings.themeMode
      || settings.themeVariant !== savedSettings.themeVariant
      || !areJsonSnapshotsEqual(settings.themeCustomColor, savedSettings.themeCustomColor);

    try {
      const settingsPromise: Promise<AppSettings | null> = shouldSaveSettings
        ? updateSettings.mutateAsync(settings)
        : Promise.resolve(null);
      const customConfigPromise: Promise<CustomConfig | null> = shouldSaveCustomConfig
        ? saveConfig(customConfig)
        : Promise.resolve(null);
      // settings 与 custom config 是两个持久化边界；allSettled 能保留部分成功结果并给出精确失败范围。
      // 不能用 Promise.all，否则其中一个失败会掩盖另一个已经成功的事实，导致 saved snapshot 与远端不一致。
      const [settingsResult, customConfigResult] = await Promise.allSettled([
        settingsPromise,
        customConfigPromise,
      ] as const);

      const failedScopes: string[] = [];
      let firstError: unknown = null;

      if (settingsResult.status === "fulfilled" && settingsResult.value) {
        const saved = settingsResult.value;
        setSavedSettings(saved);
        setSettings(saved);
        syncSavedPreviewState(saved, { syncAppearance: appearanceChanged });
        void refetchNotificationHistory();
        if (providerChanged) {
          try {
            await refreshRates(saved.exchangeRateProvider);
          } catch (e) {
            console.warn("Failed to refresh exchange rates after saving settings:", e);
          }
        }
      } else if (settingsResult.status === "rejected") {
        failedScopes.push(t("settings.appSettingsScope"));
        firstError = settingsResult.reason;
      }

      if (customConfigResult.status === "fulfilled" && customConfigResult.value) {
        const savedConfig = customConfigResult.value;
        setSavedCustomConfig(savedConfig);
        setCustomConfig(savedConfig);
      } else if (customConfigResult.status === "rejected") {
        failedScopes.push(t("settings.customConfigScope"));
        firstError ??= customConfigResult.reason;
      }

      if (failedScopes.length === 0) {
        toast({
          title: t("settings.saved"),
          description: t("settings.savedDescription"),
        });
        return;
      }

      const fallbackDescription = providerChanged && firstError
        ? getExchangeRateProviderSaveErrorMessage(firstError, t)
        : getDisplayErrorMessage(firstError, t("settings.saveFailedDescription"));
      toast({
        title: t("settings.saveFailed"),
        description: failedScopes.length > 1
          ? t("settings.partialSaveFailedDescription", { scope: failedScopes.join(", ") })
          : fallbackDescription,
        variant: "destructive",
      });
    } finally {
      setIsSavingSettings(false);
    }
  }, [
    customConfig,
    customConfigDirty,
    hasUnsavedChanges,
    isSavingSettings,
    monthlyBudgetError,
    refetchNotificationHistory,
    refreshRates,
    saveConfig,
    savedSettings.exchangeRateProvider,
    savedSettings.themeCustomColor,
    savedSettings.themeMode,
    savedSettings.themeVariant,
    settings,
    settingsDirty,
    syncSavedPreviewState,
    t,
    toast,
    updateSettings,
  ]);

  const handleDiscardChanges = useCallback(() => {
    setSettings(savedSettings);
    setCustomConfig(savedCustomConfig);
    setMonthlyBudgetError(null);
    syncSavedPreviewState(savedSettings, { syncAppearance: true });
  }, [savedCustomConfig, savedSettings, syncSavedPreviewState]);

  const handleDefaultCurrencyChange = useCallback(
    (value: string) => {
      updateSetting("defaultCurrency", value);
    },
    [updateSetting],
  );

  const handleExchangeRateProviderChange = useCallback(
    (value: ExchangeRateProvider) => {
      updateSetting("exchangeRateProvider", value);
    },
    [updateSetting],
  );

  const handleCreateCalendarFeed = useCallback(async () => {
    try {
      // Feed URL 是低权限 bearer secret；创建成功后由 React Query 缓存接住新 token，避免用户复制旧地址。
      await createCalendarFeed.mutateAsync();
      toast({
        title: t("settings.calendarFeedGenerated"),
        description: t("settings.calendarFeedGeneratedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.calendarFeedFailed"),
        description: getDisplayErrorMessage(error, t("settings.calendarFeedFailedDescription")),
        variant: "destructive",
      });
    }
  }, [createCalendarFeed, t, toast]);

  const handleCopyCalendarFeedUrl = useCallback(async () => {
    const feedUrl = calendarFeedStatus.data?.feedUrl;
    if (!feedUrl) return;
    try {
      // 复制只读当前缓存中的 URL；不在点击时重新请求，避免系统剪贴板权限弹窗和网络竞态叠加。
      await navigator.clipboard.writeText(feedUrl);
      toast({
        title: t("settings.calendarFeedCopied"),
        description: t("settings.calendarFeedCopiedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.calendarFeedCopyFailed"),
        description: getDisplayErrorMessage(error, t("settings.calendarFeedCopyFailedDescription")),
        variant: "destructive",
      });
    }
  }, [calendarFeedStatus.data?.feedUrl, t, toast]);

  const handleRevokeCalendarFeed = useCallback(async () => {
    try {
      // 撤销必须立即清远端 token；前端缓存只负责让 UI 及时显示 disabled，不作为安全边界。
      await deleteCalendarFeed.mutateAsync();
      toast({
        title: t("settings.calendarFeedRevoked"),
        description: t("settings.calendarFeedRevokedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.calendarFeedFailed"),
        description: getDisplayErrorMessage(error, t("settings.calendarFeedRevokeFailedDescription")),
        variant: "destructive",
      });
    }
  }, [deleteCalendarFeed, t, toast]);

  const handleRegenerateCalendarFeed = useCallback(async () => {
    try {
      // 轮换使用“先撤销后创建”，确保旧 URL 在服务端失效后才展示新 URL。
      await deleteCalendarFeed.mutateAsync();
      await createCalendarFeed.mutateAsync();
      toast({
        title: t("settings.calendarFeedRegenerated"),
        description: t("settings.calendarFeedRegeneratedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.calendarFeedFailed"),
        description: getDisplayErrorMessage(error, t("settings.calendarFeedFailedDescription")),
        variant: "destructive",
      });
    }
  }, [createCalendarFeed, deleteCalendarFeed, t, toast]);

  const handleThemeModeChange = useCallback(
    (value: ThemeMode) => {
      updateSetting("themeMode", value);
      setTheme(value);
      writeSettingsThemeModeToStorage(value);
      writeAppearancePendingToStorage(true);
    },
    [setTheme, updateSetting],
  );

  const handleThemeVariantChange = useCallback(
    (value: ThemeVariant) => {
      // 主题风格先写 DOM 再等待统一保存；这是为了让 Settings 页像控制面板一样即时反馈。
      setSettings((prev) => ({
        ...prev,
        themeMode: effectiveThemeMode,
        themeVariant: value,
      }));
      writeSettingsThemeModeToStorage(effectiveThemeMode);
      applyThemeVariant(value, settings.themeCustomColor);
      writeThemeVariantToStorage(value);
      writeAppearancePendingToStorage(true);
    },
    [effectiveThemeMode, settings.themeCustomColor],
  );

  const handleThemeCustomColorChange = useCallback(
    (value: CustomThemeColor) => {
      // 自定义色只有在 custom 主题下才需要立即覆写 CSS 变量，其他主题仅保存候选值。
      setSettings((prev) => ({
        ...prev,
        themeMode: effectiveThemeMode,
        themeCustomColor: value,
      }));
      writeSettingsThemeModeToStorage(effectiveThemeMode);
      writeCustomThemeColorToStorage(value);
      writeAppearancePendingToStorage(true);

      if (settings.themeVariant === "custom") {
        applyThemeVariant("custom", value);
      }
    },
    [effectiveThemeMode, settings.themeVariant],
  );

  return {
    settings,
    effectiveThemeMode,
    accountEmail,
    canAccessPocketBaseAdmin: accountIdentity.role === "admin" && !isCloudflareRuntime,
    customConfig,
    subscriptionsQuery,
    categoryUsageCount,
    rates,
    activeRateProvider,
    ratesLoading,
    lastUpdated,
    ratesError,
    getCurrencySymbol,
    updateCategories,
    updateStatuses,
    updatePaymentMethods,
    updateCurrencies,
    updateSetting,
    monthlyBudgetError,
    handleMonthlyBudgetInputChange,
    toggleChannel,
    handleRefreshRates,
    handleUpdateCurrencies,
    hasUnsavedChanges,
    handleSaveChanges,
    handleDiscardChanges,
    isSavingSettings,
    handleDefaultCurrencyChange,
    handleExchangeRateProviderChange,
    handleThemeModeChange,
    handleThemeVariantChange,
    handleThemeCustomColorChange,
    testingChannel: notificationTest.testingChannel,
    handleTestConnection: notificationTest.testConnection,
    notificationHistory,
    calendarFeed: {
      data: calendarFeedStatus.data,
      feedUrl: calendarFeedStatus.data?.feedUrl ?? null,
      isLoading: calendarFeedStatus.isLoading,
      isCreating: createCalendarFeed.isPending,
      isDeleting: deleteCalendarFeed.isPending,
      createOrRotate: handleCreateCalendarFeed,
      copyUrl: handleCopyCalendarFeedUrl,
      regenerate: handleRegenerateCalendarFeed,
      revoke: handleRevokeCalendarFeed,
    },
    password,
    passwordResetEnabled,
  };
}
