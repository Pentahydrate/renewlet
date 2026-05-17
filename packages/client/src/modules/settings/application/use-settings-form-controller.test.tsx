import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUSTOM_CONFIG, type CustomConfig } from "@/types/config";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types/subscription";
import { useSettingsFormController } from "./use-settings-form-controller";

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  recipientEmail: "alice@example.com",
};

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  updateSettingsMutateAsync: vi.fn(),
  refreshRates: vi.fn(),
  remoteSettings: undefined as unknown,
  customConfig: undefined as unknown,
  saveConfig: vi.fn(),
  setTheme: vi.fn(),
  setLocale: vi.fn(),
  testConnection: vi.fn(),
  refetchNotificationHistory: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mocks.toast,
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: mocks.remoteSettings,
  }),
  useUpdateSettings: () => ({
    mutateAsync: mocks.updateSettingsMutateAsync,
  }),
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    rates: {},
    activeProvider: "floatrates",
    loading: false,
    lastUpdated: null,
    refresh: mocks.refreshRates,
    error: null,
    getCurrencySymbol: () => "¥",
  }),
}));

vi.mock("@/hooks/use-subscriptions", () => ({
  useSubscriptions: () => ({
    data: [],
    isPending: false,
    status: "success",
  }),
}));

vi.mock("@/hooks/use-password-reset-availability", () => ({
  usePasswordResetAvailability: () => true,
}));

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: mocks.setTheme,
  }),
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: mocks.customConfig,
    saveConfig: mocks.saveConfig,
  }),
}));

vi.mock("@/i18n/I18nProvider", () => {
  const messages: Record<string, string | ((params: Record<string, string | number>) => string)> = {
    "settings.saved": "设置已保存",
    "settings.savedDescription": "所有更改已同步。",
    "settings.saveFailed": "保存失败",
    "settings.saveFailedDescription": "无法保存设置，请稍后重试",
    "settings.appSettingsScope": "应用设置",
    "settings.customConfigScope": "数据配置",
    "settings.exchangeRateProviderSaveFailed": "无法保存汇率来源，请稍后重试",
    "settings.exchangeRateProviderServerOutdated": "无法保存汇率来源。服务端可能还没更新或重启，请重启后端服务后再试。",
    "settings.partialSaveFailedDescription": ({ scope }) => `以下内容未保存：${scope}。请检查后重试。`,
  };

  return {
    useI18n: () => ({
      t: (key: string, params: Record<string, string | number> = {}) => {
        const message = messages[key];
        return typeof message === "function" ? message(params) : message ?? key;
      },
      setLocale: mocks.setLocale,
    }),
  };
});

vi.mock("./use-account-email", () => ({
  useAccountIdentity: () => ({
    email: "alice@example.com",
    role: "admin",
  }),
}));

vi.mock("./use-notification-test", () => ({
  useNotificationTest: () => ({
    testingChannel: null,
    testConnection: mocks.testConnection,
  }),
}));

vi.mock("./use-password-change", () => ({
  usePasswordChange: () => ({
    passwordDialogOpen: false,
    setPasswordDialogOpen: vi.fn(),
    handlePasswordDialogOpenChange: vi.fn(),
    currentPassword: "",
    setCurrentPassword: vi.fn(),
    newPassword: "",
    setNewPassword: vi.fn(),
    confirmPassword: "",
    setConfirmPassword: vi.fn(),
    isUpdatingPassword: false,
    updatePassword: vi.fn(),
  }),
}));

vi.mock("./use-notification-history", () => ({
  useNotificationHistory: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    historyStatus: "all",
    setStatus: vi.fn(),
    loadMore: vi.fn(),
    refetch: mocks.refetchNotificationHistory,
  }),
}));

describe("useSettingsFormController", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.updateSettingsMutateAsync.mockReset();
    mocks.refreshRates.mockReset();
    mocks.saveConfig.mockReset();
    mocks.setTheme.mockReset();
    mocks.setLocale.mockReset();
    mocks.refetchNotificationHistory.mockReset();
    mocks.remoteSettings = BASE_SETTINGS;
    mocks.customConfig = DEFAULT_CUSTOM_CONFIG;
    mocks.updateSettingsMutateAsync.mockImplementation(async (settings: AppSettings) => settings);
    mocks.saveConfig.mockImplementation(async (config: CustomConfig) => config);
    mocks.refreshRates.mockResolvedValue(undefined);
  });

  it("starts clean and does not save or refresh when the exchange-rate source only changes draft", () => {
    const { result } = renderHook(() => useSettingsFormController());

    expect(result.current.hasUnsavedChanges).toBe(false);

    act(() => {
      result.current.handleExchangeRateProviderChange("frankfurter");
    });

    expect(result.current.settings.exchangeRateProvider).toBe("frankfurter");
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(mocks.updateSettingsMutateAsync).not.toHaveBeenCalled();
    expect(mocks.refreshRates).not.toHaveBeenCalled();
  });

  it("saves draft settings and refreshes rates only after the provider is saved", async () => {
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.handleExchangeRateProviderChange("frankfurter");
    });

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.updateSettingsMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      exchangeRateProvider: "frankfurter",
    }));
    expect(mocks.refreshRates).toHaveBeenCalledWith("frankfurter");
    expect(result.current.settings.exchangeRateProvider).toBe("frankfurter");
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "设置已保存",
      description: "所有更改已同步。",
    });
  });

  it("keeps the draft dirty and shows the server restart hint when saving the provider hits PocketBase 400", async () => {
    mocks.updateSettingsMutateAsync.mockRejectedValue({
      status: 400,
      message: "Failed to update record.",
      response: {
        status: 400,
        message: "Failed to update record.",
        data: {},
      },
    });
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.handleExchangeRateProviderChange("frankfurter");
    });

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.refreshRates).not.toHaveBeenCalled();
    expect(result.current.settings.exchangeRateProvider).toBe("frankfurter");
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "保存失败",
      description: "无法保存汇率来源。服务端可能还没更新或重启，请重启后端服务后再试。",
      variant: "destructive",
    });
  });

  it("discards draft settings and restores locale/theme previews", () => {
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.handleThemeModeChange("light");
      result.current.updateSetting("locale", "en-US");
    });
    expect(result.current.hasUnsavedChanges).toBe(true);

    act(() => {
      result.current.handleDiscardChanges();
    });

    expect(result.current.settings.themeMode).toBe(BASE_SETTINGS.themeMode);
    expect(result.current.settings.locale).toBe(BASE_SETTINGS.locale);
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(mocks.setTheme).toHaveBeenLastCalledWith(BASE_SETTINGS.themeMode);
    expect(mocks.setLocale).toHaveBeenLastCalledWith(BASE_SETTINGS.locale, {
      persist: false,
      markAsSaved: true,
    });
  });

  it("saves custom configuration changes through the unified save action", async () => {
    const nextCategories = [
      ...DEFAULT_CUSTOM_CONFIG.categories,
      {
        id: "custom",
        value: "custom",
        labels: { "zh-CN": "自定义", "en-US": "Custom" },
        color: "hsl(200 80% 50%)",
      },
    ];
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.updateCategories(nextCategories);
    });

    expect(result.current.hasUnsavedChanges).toBe(true);

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.updateSettingsMutateAsync).not.toHaveBeenCalled();
    expect(mocks.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      categories: nextCategories,
    }));
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});
