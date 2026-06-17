// Settings controller 测试保护远端设置、本地草稿、主题/i18n 预览和保存副作用的唯一应用层写入口。
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUSTOM_CONFIG, type CustomConfig } from "@/types/config";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types/subscription";
import { BUILT_IN_ICON_PROVIDERS, type BuiltInIconProvider } from "@renewlet/shared/built-in-icons";
import type { BuiltInIconIndexStatus } from "@/lib/api/schemas/media";
import {
  APPEARANCE_PENDING_STORAGE_KEY,
  SETTINGS_APPEARANCE_PENDING_STORAGE_KEY,
  SETTINGS_THEME_MODE_STORAGE_KEY,
} from "@/lib/theme-storage";
import { useSettingsFormController } from "./use-settings-form-controller";

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  recipientEmail: "alice@example.com",
};

function providerStatusFixtures(counts: Record<BuiltInIconProvider, number>) {
  return BUILT_IN_ICON_PROVIDERS.map((provider) => ({
    provider,
    current: {
      sourceRef: "embedded",
      displayVersion: "bundled",
      commitSha: null,
      commitShortSha: null,
      commitDate: null,
      releaseTag: null,
      releasePublishedAt: null,
    },
    latest: null,
    iconCount: counts[provider],
    checkedAt: null,
    refreshedAt: null,
    lastError: null,
    refreshing: false,
    updateAvailable: false,
  }));
}

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  updateSettingsMutateAsync: vi.fn(),
  refreshRates: vi.fn(),
  remoteSettings: undefined as unknown,
  customConfig: undefined as unknown,
  saveConfig: vi.fn(),
  setTheme: vi.fn(),
  clearThemeModeOverride: vi.fn(),
  theme: "dark",
  setLocale: vi.fn(),
  testConnection: vi.fn(),
  refetchNotificationHistory: vi.fn(),
  calendarFeedStatus: { data: { enabled: false, feedUrl: undefined as string | undefined }, isLoading: false },
  createCalendarFeedMutateAsync: vi.fn(),
  deleteCalendarFeedMutateAsync: vi.fn(),
  publicStatusPageStatus: { data: { enabled: false, pageUrl: undefined as string | undefined, showPrices: false }, isLoading: false },
  createPublicStatusPageMutateAsync: vi.fn(),
  updatePublicStatusPageMutateAsync: vi.fn(),
  deletePublicStatusPageMutateAsync: vi.fn(),
  builtInIconIndexStatus: {
    data: undefined as BuiltInIconIndexStatus | undefined,
    isLoading: false,
    refetch: vi.fn(),
  },
  checkBuiltInIconIndexProviderMutateAsync: vi.fn(),
  checkBuiltInIconIndexProviderIsPending: false,
  refreshBuiltInIconIndexProviderMutateAsync: vi.fn(),
  refreshBuiltInIconIndexProviderIsPending: false,
  writeClipboard: vi.fn(),
  fetch: vi.fn(),
  openWindow: vi.fn(),
  isCloudflareRuntime: false,
  accountIdentity: { email: "alice@example.com" as string | null, role: "admin", banned: false },
  appStatus: { setupRequired: false, setupEnabled: true, demoMode: false, isLoading: false },
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

vi.mock("@/hooks/use-setup-status", () => ({
  useSetupStatus: () => mocks.appStatus,
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

vi.mock("@/hooks/use-calendar-feed", () => ({
  useCalendarFeedStatus: () => mocks.calendarFeedStatus,
  useCreateCalendarFeed: () => ({
    mutateAsync: mocks.createCalendarFeedMutateAsync,
    isPending: false,
  }),
  useDeleteCalendarFeed: () => ({
    mutateAsync: mocks.deleteCalendarFeedMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-public-status-page", () => ({
  usePublicStatusPageStatus: () => mocks.publicStatusPageStatus,
  useCreatePublicStatusPage: () => ({
    mutateAsync: mocks.createPublicStatusPageMutateAsync,
    isPending: false,
  }),
  useUpdatePublicStatusPage: () => ({
    mutateAsync: mocks.updatePublicStatusPageMutateAsync,
    isPending: false,
  }),
  useDeletePublicStatusPage: () => ({
    mutateAsync: mocks.deletePublicStatusPageMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/lib/theme-provider", () => ({
  clearThemeModeOverride: mocks.clearThemeModeOverride,
  useTheme: () => ({
    theme: mocks.theme,
    setTheme: mocks.setTheme,
  }),
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: mocks.customConfig,
    saveConfig: mocks.saveConfig,
  }),
}));

vi.mock("@/services/runtime", () => ({
  get isCloudflareRuntime() {
    return mocks.isCloudflareRuntime;
  },
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
    "settings.calendarFeedGenerated": "日历订阅已生成",
    "settings.calendarFeedGeneratedDescription": "你可以随时回到这里复制 URL 或唤起系统日历订阅。",
    "settings.calendarFeedRegenerated": "日历订阅已重新生成",
    "settings.calendarFeedRegeneratedDescription": "旧 URL 已失效，请把新 URL 添加到你的日历应用。",
    "settings.calendarFeedCopied": "URL 已复制",
    "settings.calendarFeedCopiedDescription": "现在可以在日历应用中添加订阅日历。",
    "settings.calendarFeedCopyFailed": "复制失败",
    "settings.calendarFeedCopyFailedDescription": "当前一键复制不可用，请手动选择并复制 URL。",
    "settings.calendarFeedOpenSystemAttempted": "已尝试唤起系统日历",
    "settings.calendarFeedOpenSystemAttemptedDescription": "如果系统日历拒绝此 URL，请复制 URL 后在日历 App 中手动添加订阅。",
    "settings.calendarFeedOpenSystemFailed": "系统日历订阅打开失败",
    "settings.calendarFeedOpenSystemFailedDescription": "订阅 URL 当前没有返回可用的 ICS 内容；请复制 URL 手动添加订阅。",
    "settings.calendarFeedFailed": "日历订阅操作失败",
    "settings.calendarFeedFailedDescription": "无法生成日历订阅，请稍后重试。",
    "settings.calendarFeedRevoked": "日历订阅已撤销",
    "settings.calendarFeedRevokedDescription": "旧 URL 已失效，日历客户端后续刷新将无法再读取。",
    "settings.calendarFeedRevokeFailedDescription": "无法撤销日历订阅，请稍后重试。",
    "settings.publicStatusGenerated": "公开展示已生成",
    "settings.publicStatusGeneratedDescription": "你可以复制链接，或先按订阅逐条隐藏不想公开的项目。",
    "settings.publicStatusCopied": "URL 已复制",
    "settings.publicStatusCopiedDescription": "现在可以分享这个私密公开链接。",
    "settings.publicStatusCopyFailed": "复制失败",
    "settings.publicStatusCopyFailedDescription": "当前一键复制不可用，请手动选择并复制 URL。",
    "settings.publicStatusRegenerated": "公开展示已重新生成",
    "settings.publicStatusRegeneratedDescription": "旧 URL 已失效，请使用新的公开展示链接。",
    "settings.publicStatusRevoked": "公开展示已撤销",
    "settings.publicStatusRevokedDescription": "旧 URL 已失效，后续访问会得到 404。",
    "settings.publicStatusUpdated": "公开展示已更新",
    "settings.publicStatusPricesEnabled": "公开页会显示价格和币种。",
    "settings.publicStatusFailed": "公开展示操作失败",
    "settings.publicStatusFailedDescription": "无法生成公开展示链接，请稍后重试。",
    "settings.publicStatusRevokeFailedDescription": "无法撤销公开展示，请稍后重试。",
    "settings.publicStatusUpdateFailedDescription": "无法更新公开展示设置，请稍后重试。",
    "settings.builtInIconIndexRefreshSuccess": "图标索引已更新",
    "settings.builtInIconIndexRefreshSuccessDescription": ({ source, count }) => `${source} 已更新，${count} 个图标可用于 Logo 和图标搜索。`,
    "settings.builtInIconIndexRefreshFailed": "图标索引更新失败",
    "settings.builtInIconIndexRefreshFailedDescription": ({ source }) => `无法更新 ${source}，请稍后重试。`,
    "settings.builtInIconSourceShort.thesvg": "TheSVG",
    "settings.builtInIconSourceShort.selfhst": "selfh.st",
    "settings.builtInIconSourceShort.dashboardIcons": "Dashboard",
    "error.code.BUILT_IN_ICON_SOURCE_REQUIRED": "请至少启用一个内置图标来源",
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
  useAccountIdentity: () => mocks.accountIdentity,
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

vi.mock("@/hooks/use-built-in-icon-index", () => ({
  useBuiltInIconIndexStatus: () => mocks.builtInIconIndexStatus,
  useCheckBuiltInIconIndexProvider: () => ({
    mutateAsync: mocks.checkBuiltInIconIndexProviderMutateAsync,
    isPending: mocks.checkBuiltInIconIndexProviderIsPending,
  }),
  useRefreshBuiltInIconIndexProvider: () => ({
    mutateAsync: mocks.refreshBuiltInIconIndexProviderMutateAsync,
    isPending: mocks.refreshBuiltInIconIndexProviderIsPending,
  }),
}));

describe("useSettingsFormController", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.updateSettingsMutateAsync.mockReset();
    mocks.refreshRates.mockReset();
    mocks.saveConfig.mockReset();
    mocks.setTheme.mockReset();
    mocks.clearThemeModeOverride.mockReset();
    mocks.theme = "dark";
    mocks.setLocale.mockReset();
    mocks.refetchNotificationHistory.mockReset();
    mocks.createCalendarFeedMutateAsync.mockReset();
    mocks.deleteCalendarFeedMutateAsync.mockReset();
    mocks.createPublicStatusPageMutateAsync.mockReset();
    mocks.updatePublicStatusPageMutateAsync.mockReset();
    mocks.deletePublicStatusPageMutateAsync.mockReset();
    mocks.checkBuiltInIconIndexProviderMutateAsync.mockReset();
    mocks.checkBuiltInIconIndexProviderIsPending = false;
    mocks.refreshBuiltInIconIndexProviderMutateAsync.mockReset();
    mocks.refreshBuiltInIconIndexProviderIsPending = false;
    mocks.writeClipboard.mockReset();
    mocks.fetch.mockReset();
    mocks.openWindow.mockReset();
    localStorage.removeItem(APPEARANCE_PENDING_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_APPEARANCE_PENDING_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_THEME_MODE_STORAGE_KEY);
    mocks.calendarFeedStatus = { data: { enabled: false, feedUrl: undefined }, isLoading: false };
    mocks.publicStatusPageStatus = { data: { enabled: false, pageUrl: undefined, showPrices: false }, isLoading: false };
    mocks.builtInIconIndexStatus = {
      data: {
        source: "embedded",
        hash: "embedded-hash",
        iconCount: 100,
        providerCounts: { thesvg: 40, selfhst: 30, dashboardIcons: 30 },
        checkedAt: null,
        updatedAt: null,
        refreshing: false,
        providers: providerStatusFixtures({ thesvg: 40, selfhst: 30, dashboardIcons: 30 }),
      },
      isLoading: false,
      refetch: vi.fn(),
    };
    mocks.remoteSettings = BASE_SETTINGS;
    mocks.customConfig = DEFAULT_CUSTOM_CONFIG;
    mocks.isCloudflareRuntime = false;
    mocks.accountIdentity = { email: "alice@example.com", role: "admin", banned: false };
    mocks.appStatus = { setupRequired: false, setupEnabled: true, demoMode: false, isLoading: false };
    mocks.updateSettingsMutateAsync.mockImplementation(async (settings: AppSettings) => settings);
    mocks.saveConfig.mockImplementation(async (config: CustomConfig) => config);
    mocks.refreshRates.mockResolvedValue(undefined);
    mocks.createCalendarFeedMutateAsync.mockResolvedValue({
      enabled: true,
      createdAt: "2026-05-29T00:00:00Z",
      updatedAt: "2026-05-29T00:00:00Z",
      feedUrl: "https://example.com/calendar/renewals.ics?token=secret",
    });
    mocks.deleteCalendarFeedMutateAsync.mockResolvedValue({ ok: true });
    mocks.createPublicStatusPageMutateAsync.mockResolvedValue({
      enabled: true,
      createdAt: "2026-06-07T00:00:00Z",
      updatedAt: "2026-06-07T00:00:00Z",
      pageUrl: "https://example.com/status/secret",
      showPrices: false,
    });
    mocks.updatePublicStatusPageMutateAsync.mockResolvedValue({
      enabled: true,
      createdAt: "2026-06-07T00:00:00Z",
      updatedAt: "2026-06-07T00:00:00Z",
      pageUrl: "https://example.com/status/secret",
      showPrices: true,
    });
    mocks.deletePublicStatusPageMutateAsync.mockResolvedValue({ ok: true });
    mocks.checkBuiltInIconIndexProviderMutateAsync.mockImplementation(async (provider: BuiltInIconProvider) => ({
      status: {
        ...(mocks.builtInIconIndexStatus.data ?? {}),
      },
      provider: providerStatusFixtures({ thesvg: 40, selfhst: 30, dashboardIcons: 30 }).find((item) => item.provider === provider),
    }));
    mocks.refreshBuiltInIconIndexProviderMutateAsync.mockResolvedValue({
      status: {
        source: "runtime",
        hash: "runtime-hash",
        iconCount: 321,
        providerCounts: { thesvg: 120, selfhst: 100, dashboardIcons: 101 },
        checkedAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:00:00Z",
        refreshing: false,
        providers: providerStatusFixtures({ thesvg: 120, selfhst: 100, dashboardIcons: 101 }),
      },
      provider: providerStatusFixtures({ thesvg: 120, selfhst: 100, dashboardIcons: 101 })[0],
    });
    mocks.writeClipboard.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
      headers: { "content-type": "text/calendar; charset=utf-8" },
    }));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mocks.writeClipboard },
      configurable: true,
    });
    vi.stubGlobal("fetch", mocks.fetch);
    Object.defineProperty(window, "open", {
      value: mocks.openWindow,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts clean and does not save or refresh when the exchange-rate source only changes draft", () => {
    const { result } = renderHook(() => useSettingsFormController());

    expect(result.current.hasUnsavedChanges).toBe(false);

    act(() => {
      result.current.handleExchangeRateProviderChange("exchange-api");
    });

    expect(result.current.settings.exchangeRateProvider).toBe("exchange-api");
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(mocks.updateSettingsMutateAsync).not.toHaveBeenCalled();
    expect(mocks.refreshRates).not.toHaveBeenCalled();
  });

  it("does not expose the PocketBase admin entry in Cloudflare runtime", () => {
    mocks.isCloudflareRuntime = true;

    const { result } = renderHook(() => useSettingsFormController());

    expect(result.current.canAccessPocketBaseAdmin).toBe(false);
  });

  it("does not expose user management capability for banned admins", () => {
    mocks.accountIdentity = { email: "admin@example.com", role: "admin", banned: true };

    const { result } = renderHook(() => useSettingsFormController());

    expect(result.current.canManageUsers).toBe(false);
    expect(result.current.canAccessPocketBaseAdmin).toBe(false);
  });

  it("prefills an empty recipient email from the current account email without marking the form dirty", async () => {
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      recipientEmail: "",
    };

    const { result } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.settings.recipientEmail).toBe("alice@example.com");
    });
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("does not prefill or mutate external integration settings in demo mode", async () => {
    mocks.appStatus = { setupRequired: false, setupEnabled: false, demoMode: true, isLoading: false };
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      enabledChannels: [],
      recipientEmail: "",
    };

    const { result } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.externalIntegrationsDisabled).toBe(true);
    });
    expect(result.current.settings.recipientEmail).toBe("");

    act(() => {
      result.current.updateSetting("recipientEmail", "billing@example.com");
      result.current.toggleChannel("telegram");
      void result.current.handleTestConnection("telegram");
    });

    expect(result.current.settings.recipientEmail).toBe("");
    expect(result.current.settings.enabledChannels).toEqual([]);
    expect(mocks.testConnection).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("marks the form dirty when the prefilled recipient email is changed", async () => {
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      recipientEmail: "",
    };

    const { result } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.settings.recipientEmail).toBe("alice@example.com");
    });

    act(() => {
      result.current.updateSetting("recipientEmail", "billing@example.com");
    });

    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it("keeps an existing recipient email from remote settings", async () => {
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      recipientEmail: "billing@example.com",
    };

    const { result } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.settings.recipientEmail).toBe("billing@example.com");
    });
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("does not mark settings dirty when the global header theme changes", async () => {
    localStorage.setItem(APPEARANCE_PENDING_STORAGE_KEY, "1");
    const { result, rerender } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.settings.themeMode).toBe(BASE_SETTINGS.themeMode);
    });
    expect(result.current.effectiveThemeMode).toBe("dark");
    expect(result.current.hasUnsavedChanges).toBe(false);

    act(() => {
      mocks.theme = BASE_SETTINGS.themeMode === "dark" ? "light" : "dark";
      rerender();
    });

    expect(result.current.settings.themeMode).toBe(BASE_SETTINGS.themeMode);
    expect(result.current.effectiveThemeMode).toBe(BASE_SETTINGS.themeMode === "dark" ? "light" : "dark");
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("keeps the current header theme when saving non-appearance settings", async () => {
    mocks.theme = "dark";
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      themeMode: "light",
    };
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.handleExchangeRateProviderChange("exchange-api");
    });

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.updateSettingsMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      exchangeRateProvider: "exchange-api",
    }));
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it("includes the current effective theme when editing a theme variant", async () => {
    mocks.theme = "dark";
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      themeMode: "light",
    };
    const { result } = renderHook(() => useSettingsFormController());

    expect(result.current.hasUnsavedChanges).toBe(false);

    act(() => {
      result.current.handleThemeVariantChange("ocean");
    });

    expect(result.current.settings.themeMode).toBe("dark");
    expect(result.current.settings.themeVariant).toBe("ocean");
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(localStorage.getItem(SETTINGS_THEME_MODE_STORAGE_KEY)).toBe("dark");
  });

  it("restores unsaved settings appearance from the dedicated pending draft", async () => {
    localStorage.setItem(SETTINGS_APPEARANCE_PENDING_STORAGE_KEY, "1");
    localStorage.setItem(SETTINGS_THEME_MODE_STORAGE_KEY, "light");

    const { result } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.settings.themeMode).toBe("light");
    });
    expect(result.current.hasUnsavedChanges).toBe(BASE_SETTINGS.themeMode !== "light");
  });

  it("prefills the recipient email when the account email arrives after settings without marking the form dirty", async () => {
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      recipientEmail: "",
    };
    mocks.accountIdentity = { email: null, role: "admin", banned: false };
    const { result, rerender } = renderHook(() => useSettingsFormController());

    expect(result.current.settings.recipientEmail).toBe("");

    act(() => {
      mocks.accountIdentity = { email: "late@example.com", role: "admin", banned: false };
      rerender();
    });

    await waitFor(() => {
      expect(result.current.settings.recipientEmail).toBe("late@example.com");
    });
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it("does not refill after the user clears the default recipient email", async () => {
    mocks.remoteSettings = {
      ...BASE_SETTINGS,
      recipientEmail: "",
    };
    const { result, rerender } = renderHook(() => useSettingsFormController());

    await waitFor(() => {
      expect(result.current.settings.recipientEmail).toBe("alice@example.com");
    });

    act(() => {
      result.current.updateSetting("recipientEmail", "");
    });

    expect(result.current.settings.recipientEmail).toBe("");
    expect(result.current.hasUnsavedChanges).toBe(true);

    act(() => {
      mocks.remoteSettings = {
        ...BASE_SETTINGS,
        recipientEmail: "",
      };
      rerender();
    });

    expect(result.current.settings.recipientEmail).toBe("");
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it("saves draft settings and refreshes rates only after the provider is saved", async () => {
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.handleExchangeRateProviderChange("exchange-api");
    });

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.updateSettingsMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      exchangeRateProvider: "exchange-api",
    }));
    expect(mocks.refreshRates).toHaveBeenCalledWith("exchange-api");
    expect(result.current.settings.exchangeRateProvider).toBe("exchange-api");
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "设置已保存",
      description: "所有更改已同步。",
    });
  });

  it("saves settings appearance changes and clears the dedicated pending draft", async () => {
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.handleThemeModeChange("light");
    });

    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(localStorage.getItem(SETTINGS_APPEARANCE_PENDING_STORAGE_KEY)).toBe("1");
    expect(localStorage.getItem(SETTINGS_THEME_MODE_STORAGE_KEY)).toBe("light");

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.updateSettingsMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      themeMode: "light",
    }));
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(localStorage.getItem(SETTINGS_APPEARANCE_PENDING_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SETTINGS_THEME_MODE_STORAGE_KEY)).toBeNull();
    expect(mocks.clearThemeModeOverride).toHaveBeenCalled();
    expect(mocks.setTheme).toHaveBeenCalledWith("light", { localOverride: false });
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
      result.current.handleExchangeRateProviderChange("exchange-api");
    });

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.refreshRates).not.toHaveBeenCalled();
    expect(result.current.settings.exchangeRateProvider).toBe("exchange-api");
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
    expect(localStorage.getItem(SETTINGS_APPEARANCE_PENDING_STORAGE_KEY)).toBe("1");
    expect(localStorage.getItem(SETTINGS_THEME_MODE_STORAGE_KEY)).toBe("light");

    act(() => {
      result.current.handleDiscardChanges();
    });

    expect(result.current.settings.themeMode).toBe(BASE_SETTINGS.themeMode);
    expect(result.current.settings.locale).toBe(BASE_SETTINGS.locale);
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(mocks.setTheme).toHaveBeenLastCalledWith(BASE_SETTINGS.themeMode, { localOverride: false });
    expect(mocks.setLocale).toHaveBeenLastCalledWith(BASE_SETTINGS.locale, {
      persist: false,
      markAsSaved: true,
    });
    expect(localStorage.getItem(SETTINGS_APPEARANCE_PENDING_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SETTINGS_THEME_MODE_STORAGE_KEY)).toBeNull();
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

  it("shows a localized message when the server rejects disabling every built-in icon source", async () => {
    mocks.updateSettingsMutateAsync.mockRejectedValue({
      code: "BUILT_IN_ICON_SOURCE_REQUIRED",
      message: "BUILT_IN_ICON_SOURCE_REQUIRED",
    });
    const { result } = renderHook(() => useSettingsFormController());

    act(() => {
      result.current.updateSetting("builtInIconSources", {
        thesvg: { enabled: false, variantsEnabled: true },
        selfhst: { enabled: false, variantsEnabled: true },
        dashboardIcons: { enabled: false, variantsEnabled: true },
      });
    });

    await act(async () => {
      await result.current.handleSaveChanges();
    });

    expect(mocks.toast).toHaveBeenCalledWith({
      title: "保存失败",
      description: "请至少启用一个内置图标来源",
      variant: "destructive",
    });
  });

});
