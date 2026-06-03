// SettingsScreen 测试保护设置页分区装配和 Cloudflare/Docker 差异入口，不验证普通控件样式。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import {
  DEFAULT_SETTINGS,
  WEBHOOK_HEADERS_PLACEHOLDER,
  WEBHOOK_PAYLOAD_PLACEHOLDER,
  type AppSettings,
  type NotificationChannel,
} from "@/types/subscription";
import type { ThemeMode } from "@/types/theme";
import { SettingsScreen } from "./settings-screen";

const mocks = vi.hoisted(() => ({
  useSettingsFormController: vi.fn(),
}));

const SETTINGS_SECTION_IDS = [
  "settings-account",
  "settings-appearance",
  "settings-display",
  "settings-icon-sources",
  "settings-budget",
  "settings-data-config",
  "settings-exchange",
  "settings-calendar-feed",
  "settings-timezone",
  "settings-notifications",
] as const;
const TEST_MOBILE_ANCHOR_LINE_PX = 208;
const TEST_ACTIVE_SECTION_TOP_PX = TEST_MOBILE_ANCHOR_LINE_PX - 24;
const TEST_NEXT_SECTION_TOP_PX = TEST_MOBILE_ANCHOR_LINE_PX + 160;

type TestSettingsSectionId = typeof SETTINGS_SECTION_IDS[number];
type IntersectionObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];
type IntersectionObserverOptions = ConstructorParameters<typeof IntersectionObserver>[1];

class SettingsIntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  readonly observedElements: Element[] = [];

  static instances: SettingsIntersectionObserverMock[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverOptions = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.scrollMargin = "0px";
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    SettingsIntersectionObserverMock.instances.push(this);
  }

  disconnect = vi.fn(() => {
    this.observedElements.length = 0;
  });

  observe = vi.fn((target: Element) => {
    this.observedElements.push(target);
  });

  takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

  unobserve = vi.fn((target: Element) => {
    const index = this.observedElements.indexOf(target);
    if (index >= 0) this.observedElements.splice(index, 1);
  });

  trigger(targetIds: string[]) {
    const visibleTargetIds = new Set(targetIds);
    this.callback(this.observedElements.map((target) => ({
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: visibleTargetIds.has(target.id) ? 1 : 0,
      intersectionRect: target.getBoundingClientRect(),
      isIntersecting: visibleTargetIds.has(target.id),
      rootBounds: null,
      target,
      time: performance.now(),
    } satisfies IntersectionObserverEntry)), this);
  }
}

function setElementRect(element: Element | null, top: number, height = 160) {
  if (!element) throw new Error("Expected element to exist");
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: top + height,
      height,
      left: 0,
      right: 960,
      top,
      width: 960,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } satisfies DOMRect),
  });
}

function setRootMetrics({
  top = 0,
  scrollTop = 0,
  clientHeight = 800,
  scrollHeight = 2400,
}: {
  top?: number;
  scrollTop?: number;
  clientHeight?: number;
  scrollHeight?: number;
} = {}) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Expected #root test scroll container");
  setElementRect(root, top, clientHeight);
  Object.defineProperty(root, "scrollTop", { configurable: true, value: scrollTop, writable: true });
  Object.defineProperty(root, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(root, "scrollHeight", { configurable: true, value: scrollHeight });
  return root;
}

function setSettingsSectionTops(tops: Partial<Record<string, number>>) {
  for (const [id, top] of Object.entries(tops)) {
    if (top !== undefined) setElementRect(document.getElementById(id), top);
  }
}

function setSectionAnchorGeometry(
  activeId: TestSettingsSectionId,
  options: {
    activeTop?: number;
    nextTop?: number;
    rootMetrics?: Parameters<typeof setRootMetrics>[0];
  } = {},
) {
  const root = setRootMetrics(options.rootMetrics);
  const activeIndex = SETTINGS_SECTION_IDS.indexOf(activeId);
  const activeTop = options.activeTop ?? TEST_ACTIVE_SECTION_TOP_PX;
  const nextTop = options.nextTop ?? TEST_NEXT_SECTION_TOP_PX;

  SETTINGS_SECTION_IDS.forEach((id, index) => {
    const top = index < activeIndex
      ? activeTop - (activeIndex - index) * 240
      : activeTop + Math.max(index - activeIndex, 0) * (nextTop - activeTop);
    setElementRect(document.getElementById(id), top);
  });

  return root;
}

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/modules/custom-config/presentation/config-manager-dialog", () => ({
  ConfigManagerDialog: () => null,
}));

vi.mock("@/components/theme-selector", () => ({
  ThemeSelector: ({ mode }: { mode: ThemeMode }) => <div data-testid="theme-selector-mode">{mode}</div>,
}));

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ value }: { value: string }) => <div data-testid="searchable-select">{value}</div>,
}));

vi.mock("@/components/ui/time-picker", () => ({
  TimePicker: () => null,
}));

vi.mock("../application/use-settings-form-controller", () => ({
  useSettingsFormController: mocks.useSettingsFormController,
}));

function createControllerState(overrides: {
  settings?: Partial<AppSettings>;
  effectiveThemeMode?: ThemeMode;
  canAccessPocketBaseAdmin?: boolean;
  testingChannel?: NotificationChannel | null;
  isSavingSettings?: boolean;
  hasUnsavedChanges?: boolean;
  calendarFeed?: {
    enabled?: boolean;
    feedUrl?: string | null;
  };
} = {}) {
  const fn = vi.fn();
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      enabledChannels: ["email"],
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpSecure: false,
      smtpUser: "smtp-user",
      smtpPassword: "smtp-password",
      smtpFrom: "Renewlet <noreply@example.com>",
      smtpReplyTo: "support@example.com",
      recipientEmail: "alice@example.com",
      ...overrides.settings,
    },
    effectiveThemeMode: overrides.effectiveThemeMode ?? overrides.settings?.themeMode ?? DEFAULT_SETTINGS.themeMode,
    accountEmail: "alice@example.com",
    canAccessPocketBaseAdmin: overrides.canAccessPocketBaseAdmin ?? true,
    customConfig: DEFAULT_CUSTOM_CONFIG,
    subscriptionsQuery: { data: [] },
    categoryUsageCount: new Map(),
    rates: {},
    activeRateProvider: "floatrates",
    ratesLoading: false,
    lastUpdated: null,
    ratesError: null,
    getCurrencySymbol: () => "¥",
    updateCategories: fn,
    updateStatuses: fn,
    updatePaymentMethods: fn,
    updateSetting: fn,
    monthlyBudgetError: null,
    handleMonthlyBudgetInputChange: fn,
    toggleChannel: fn,
    handleRefreshRates: fn,
    handleUpdateCurrencies: fn,
    hasUnsavedChanges: overrides.hasUnsavedChanges ?? false,
    handleSaveChanges: fn,
    handleDiscardChanges: fn,
    handleDefaultCurrencyChange: fn,
    handleExchangeRateProviderChange: fn,
    handleThemeModeChange: fn,
    handleThemeVariantChange: fn,
    handleThemeCustomColorChange: fn,
    testingChannel: overrides.testingChannel ?? null,
    handleTestConnection: fn,
    isSavingSettings: overrides.isSavingSettings ?? false,
    notificationHistory: {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      historyStatus: "all",
      setStatus: fn,
      loadMore: fn,
      refetch: fn,
    },
    calendarFeed: {
      data: { enabled: overrides.calendarFeed?.enabled ?? false },
      feedUrl: overrides.calendarFeed?.feedUrl ?? null,
      isLoading: false,
      isCreating: false,
      isDeleting: false,
      createOrRotate: fn,
      copyUrl: fn,
      openSystem: fn,
      regenerate: fn,
      revoke: fn,
    },
    password: {
      passwordDialogOpen: false,
      setPasswordDialogOpen: fn,
      handlePasswordDialogOpenChange: fn,
      currentPassword: "",
      setCurrentPassword: fn,
      newPassword: "",
      setNewPassword: fn,
      confirmPassword: "",
      setConfirmPassword: fn,
      isUpdatingPassword: false,
      updatePassword: fn,
    },
    passwordResetEnabled: true,
  };
}

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-path">{location.pathname}</div>;
}

function renderSettingsScreen(initialEntries = ["/settings"]) {
  return render(
    <div id="root">
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider delayDuration={0}>
          <SettingsScreen />
        </TooltipProvider>
        <RouteProbe />
      </MemoryRouter>
    </div>,
  );
}

describe("SettingsScreen SMTP email settings", () => {
  beforeEach(() => {
    SettingsIntersectionObserverMock.instances = [];
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    vi.stubGlobal("IntersectionObserver", SettingsIntersectionObserverMock);
    mocks.useSettingsFormController.mockReturnValue(createControllerState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("renders SMTP fields instead of Resend fields for email notifications", () => {
    renderSettingsScreen();

    expect(screen.queryByText(/Resend/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByLabelText("SMTP 服务器")).toHaveValue("smtp.example.com");
    expect(screen.getByLabelText("SMTP 端口")).toHaveValue("587");
    expect(screen.getByLabelText("SMTP 用户名")).toHaveValue("smtp-user");
    expect(screen.getByLabelText("SMTP 密码")).toHaveValue("smtp-password");
    expect(screen.getByLabelText("发件人")).toHaveValue("Renewlet <noreply@example.com>");
    expect(screen.getByLabelText("回复地址")).toHaveValue("support@example.com");
    expect(screen.getByRole("button", { name: "测试邮件通知" })).toBeInTheDocument();
  });

  it("shows the PocketBase admin link for admins", () => {
    renderSettingsScreen();

    const link = screen.getByRole("link", { name: "PocketBase 后台" });
    expect(link).toHaveAttribute("href", "/_/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("uses client routing for account page links", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    expect(screen.getByTestId("route-path")).toHaveTextContent("/settings");

    await user.click(screen.getByRole("link", { name: "管理用户" }));
    expect(screen.getByTestId("route-path")).toHaveTextContent("/admin/users");

    await user.click(screen.getByRole("link", { name: "忘记密码？" }));
    expect(screen.getByTestId("route-path")).toHaveTextContent("/forgot-password");
  });

  it("hides the PocketBase admin link for non-admin users", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      canAccessPocketBaseAdmin: false,
    }));

    renderSettingsScreen();

    expect(screen.queryByRole("link", { name: "PocketBase 后台" })).not.toBeInTheDocument();
  });

  it("passes the effective theme mode to the appearance selector", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: { themeMode: "light" },
      effectiveThemeMode: "dark",
    }));

    renderSettingsScreen();

    expect(screen.getByTestId("theme-selector-mode")).toHaveTextContent("dark");
  });

  it("lets users choose FloatRates as the exchange-rate source", async () => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    const user = userEvent.setup();
    const controller = createControllerState({
      settings: {
        exchangeRateProvider: "exchange-api",
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    await user.click(screen.getByRole("combobox", { name: "汇率来源" }));
    await user.click(screen.getByRole("option", { name: "FloatRates JSON Feeds" }));

    expect(controller.handleExchangeRateProviderChange).toHaveBeenCalledWith("floatrates");
  });

  it("shows the selected draft exchange-rate source without forcing an immediate save", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        exchangeRateProvider: "floatrates",
      },
    }));

    renderSettingsScreen();

    const select = screen.getByRole("combobox", { name: "汇率来源" });
    expect(select).toHaveTextContent("FloatRates JSON Feeds");
    expect(select).toBeEnabled();
  });

  it("renders the monthly budget as a formatted text input instead of a spinbutton", () => {
    renderSettingsScreen();

    const budgetInput = screen.getByLabelText("月度预算金额");
    expect(budgetInput).toHaveAttribute("type", "text");
    expect(budgetInput).toHaveAttribute("name", "monthlyBudget");
    expect(budgetInput).toHaveAttribute("inputmode", "decimal");
    expect(budgetInput).toHaveAttribute("enterkeyhint", "done");
    expect(screen.queryByRole("spinbutton", { name: "月度预算金额" })).not.toBeInTheDocument();
  });

  it("lets users edit the global notification reminder lead time", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      settings: { notificationReminderDays: 5 },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    const input = screen.getByLabelText("默认提前提醒天数");
    expect(input).toHaveValue("5");
    expect(input).toHaveAttribute("inputmode", "numeric");

    await user.clear(input);
    await user.type(input, "14");

    expect(controller.updateSetting).toHaveBeenLastCalledWith("notificationReminderDays", 14);
  });

  it("renders calendar subscription controls and exposes the permanent URL actions", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      calendarFeed: {
        enabled: true,
        feedUrl: "https://example.com/calendar/renewals.ics?token=secret",
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    expect(screen.getByRole("heading", { name: "日历订阅" })).toBeInTheDocument();
    expect(screen.getAllByText("已启用").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("日历订阅 URL")).toHaveValue("https://example.com/calendar/renewals.ics?token=secret");
    expect(screen.getByText("这是你的私有订阅链接；如果误分享，可以重新生成让旧链接失效。")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "复制 URL" });
    const systemCalendarButton = screen.getByRole("button", { name: "在系统日历中订阅" });
    expect(copyButton).toHaveClass("bg-primary");
    expect(systemCalendarButton).not.toHaveClass("bg-primary");

    await user.click(copyButton);
    expect(controller.calendarFeed.copyUrl).toHaveBeenCalled();

    await user.click(systemCalendarButton);
    expect(controller.calendarFeed.openSystem).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "重新生成" }));
    const regenerateDialog = await screen.findByRole("alertdialog", { name: "重新生成日历订阅 URL？" });
    expect(within(regenerateDialog).getByText("旧 URL 会立即失效，已经添加到日历 App 的订阅需要重新添加。")).toBeInTheDocument();
    await user.click(within(regenerateDialog).getByRole("button", { name: "重新生成" }));
    expect(controller.calendarFeed.regenerate).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "撤销订阅" }));
    expect(controller.calendarFeed.revoke).toHaveBeenCalled();
  });

  it("shows the disabled calendar feed state before URL generation", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      calendarFeed: { enabled: false, feedUrl: null },
    }));

    renderSettingsScreen();

    expect(screen.getByRole("heading", { name: "日历订阅" })).toBeInTheDocument();
    expect(screen.getByText("生成后可在 iOS、macOS、Android、Outlook、Thunderbird 等日历应用中通过 URL 订阅。")).toBeInTheDocument();
    expect(screen.queryByLabelText("日历订阅 URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制 URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在系统日历中订阅" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成订阅 URL" })).toBeInTheDocument();
  });

  it("uses H5 layout classes and native phone metadata for settings", () => {
    const { container } = renderSettingsScreen();

    expect(container.querySelector(".app-page")).toBeInTheDocument();
    expect(container.querySelector("main")).not.toHaveClass("h5-bottom-bar-space");
    const phoneInput = screen.getByLabelText("第三方 API 测试号码");
    expect(phoneInput).toHaveAttribute("name", "testPhone");
    expect(phoneInput).toHaveAttribute("type", "tel");
    expect(phoneInput).toHaveAttribute("inputmode", "tel");
    expect(phoneInput).toHaveAttribute("autocomplete", "tel");
    expect(phoneInput).toHaveAttribute("enterkeyhint", "done");
  });

  it("renders section navigation links that target every settings section", () => {
    const { container } = renderSettingsScreen();
    const sections = [
      ["settings-account", "账户"],
      ["settings-appearance", "外观"],
      ["settings-display", "显示"],
      ["settings-icon-sources", "图标来源"],
      ["settings-budget", "预算"],
      ["settings-data-config", "数据配置"],
      ["settings-exchange", "汇率"],
      ["settings-calendar-feed", "日历订阅"],
      ["settings-timezone", "时区"],
      ["settings-notifications", "通知"],
    ] as const;

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    expect(desktopNav).toHaveClass("sticky", "top-28", "bg-card/70", "backdrop-blur", "overflow-y-auto");
    expect(within(desktopNav).getByRole("link", { name: "账户" })).toHaveAttribute("aria-current", "location");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    expect(scrollSpy).toBeDefined();
    expect(scrollSpy?.root).toBe(document.getElementById("root"));
    expect(scrollSpy?.rootMargin).toBe("-20% 0px -65% 0px");
    expect(screen.queryByTestId("settings-section-content-scroll")).not.toBeInTheDocument();
    const content = screen.getByTestId("settings-section-content");
    expect(content).not.toHaveClass("lg:overflow-y-auto");
    const headings = within(content).getAllByRole("heading", { name: "系统配置" });
    expect(headings).toHaveLength(2);
    const [mobileHeading, desktopHeading] = headings;
    expect(mobileHeading).toBeDefined();
    expect(desktopHeading).toBeDefined();
    expect(mobileHeading?.closest("[data-testid='settings-mobile-page-header']")).not.toBeNull();
    expect(desktopHeading?.closest(".hidden.lg\\:block")).not.toBeNull();
    const subtitles = within(content).getAllByText("管理您的账户、显示和通知设置");
    expect(subtitles).toHaveLength(2);
    const [mobileSubtitle, desktopSubtitle] = subtitles;
    expect(mobileSubtitle).toBeDefined();
    expect(desktopSubtitle).toBeDefined();
    expect(mobileSubtitle).toHaveAttribute("data-testid", "settings-mobile-page-subtitle");
    expect(mobileSubtitle?.closest("[data-testid='settings-mobile-page-header']")).toBeNull();
    expect(mobileSubtitle?.compareDocumentPosition(mobileHeading as Element)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(desktopSubtitle?.closest(".hidden.lg\\:block")).not.toBeNull();
    expect(within(content).getByRole("heading", { name: "管理员账户" })).toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-nav-floating-trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-nav-toolbar")).not.toBeInTheDocument();
    const mobileHeader = within(content).getByTestId("settings-mobile-page-header");
    expect(mobileHeader).toHaveClass(
      "sticky",
      "top-[calc(8.25rem+env(safe-area-inset-top))]",
      "bg-background/90",
      "border-b",
      "lg:hidden",
    );
    const accountSection = container.querySelector("#settings-account");
    expect(accountSection).not.toBeNull();
    expect(mobileHeader.compareDocumentPosition(accountSection as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const mobileTrigger = within(mobileHeader).getByRole("button", { name: /打开设置目录/ });
    expect(mobileTrigger).toHaveClass("h-9", "w-9", "rounded-lg", "bg-card/80");
    expect(mobileTrigger).not.toHaveTextContent("目录");
    expect(mobileTrigger).not.toHaveTextContent("时区");
    expect(within(mobileHeader).queryByText("管理您的账户、显示和通知设置")).not.toBeInTheDocument();
    const sectionNav = within(desktopNav);

    sections.forEach(([id, label]) => {
      expect(container.querySelector(`section#${id}`)).toHaveClass(
        "scroll-mt-[calc(13rem+env(safe-area-inset-top))]",
        "lg:scroll-mt-24",
      );
      const links = sectionNav.getAllByRole("link", { name: label });
      expect(links).toHaveLength(1);
      links.forEach((link) => expect(link).toHaveAttribute("href", `#${id}`));
      expect(scrollSpy?.observedElements).toContain(container.querySelector(`section#${id}`));
    });
  });

  it("opens mobile section navigation as a left drawer", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));

    const drawer = await screen.findByTestId("settings-section-nav-drawer");
    expect(drawer).toHaveClass(
      "fixed",
      "left-0",
      "top-[var(--app-visual-viewport-offset-top)]",
      "h-[var(--app-viewport-height)]",
      "max-h-[var(--app-viewport-height)]",
      "z-[80]",
      "rounded-r-xl",
      "bg-card/95",
    );
    const notificationLink = within(drawer).getByRole("link", { name: "通知" });
    expect(notificationLink).toHaveClass("rounded-lg", "px-3", "py-2", "text-sm");
    expect(notificationLink).not.toHaveClass("h5-mobile-option-item");
    expect(notificationLink).not.toHaveClass("border", "bg-secondary/30");
    expect(drawer.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("marks the active section navigation item with aria-current", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const nav = screen.getByTestId("settings-section-nav-desktop");
    const notificationLink = within(nav).getByRole("link", { name: "通知" });
    await user.click(notificationLink);

    expect(notificationLink).toHaveAttribute("aria-current", "location");
  });

  it("updates the active section from the app scroll container observer without changing the hash", async () => {
    renderSettingsScreen();

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    expect(scrollSpy).toBeDefined();
    expect(window.location.hash).toBe("");

    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });
    expect(window.location.hash).toBe("");

    setSectionAnchorGeometry("settings-notifications");
    scrollSpy?.trigger(["settings-notifications"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");
    });
    expect(window.location.hash).toBe("");
  });

  it("keeps clicked target active while smooth scrolling passes intermediate sections", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "通知" }));

    setSectionAnchorGeometry("settings-appearance");
    scrollSpy?.trigger(["settings-appearance"]);
    setSectionAnchorGeometry("settings-display");
    scrollSpy?.trigger(["settings-display"]);
    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);

    expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");

    setSectionAnchorGeometry("settings-notifications");
    scrollSpy?.trigger(["settings-notifications"]);
    scrollSpy?.trigger(["settings-timezone"]);

    expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");
  });

  it("keeps icon sources active when the adjacent budget section is also visible", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const root = setSectionAnchorGeometry("settings-icon-sources");
    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "图标来源" }));

    setSettingsSectionTops({
      "settings-icon-sources": TEST_ACTIVE_SECTION_TOP_PX,
      "settings-budget": TEST_NEXT_SECTION_TOP_PX,
    });
    scrollSpy?.trigger(["settings-icon-sources", "settings-budget"]);
    root.dispatchEvent(new Event("scrollend"));

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "图标来源" })).toHaveAttribute("aria-current", "location");
    });
    expect(within(desktopNav).getByRole("link", { name: "预算" })).not.toHaveAttribute("aria-current");
  });

  it("hands active state back to scrollspy when the user interrupts a menu scroll", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const root = setSectionAnchorGeometry("settings-account");
    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "通知" }));

    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    scrollSpy?.trigger(["settings-timezone"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });
  });

  it("releases menu scroll intent on scrollend", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const root = setSectionAnchorGeometry("settings-account");
    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "通知" }));

    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);
    root.dispatchEvent(new Event("scrollend"));
    scrollSpy?.trigger(["settings-timezone"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });
  });

  it("keeps mobile section navigation active state in sync with scrollspy", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    setSectionAnchorGeometry("settings-notifications", {
      rootMetrics: { scrollTop: 1600, clientHeight: 800, scrollHeight: 2400 },
    });
    scrollSpy?.trigger(["settings-notifications"]);

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));

    const drawer = await screen.findByTestId("settings-section-nav-drawer");
    const activeNotificationLink = within(drawer).getByRole("link", { name: "通知" });
    expect(activeNotificationLink).toHaveAttribute("aria-current", "location");
    expect(activeNotificationLink).toHaveClass("bg-primary/10", "text-primary");
  });

  it("activates the last section only near the bottom edge", async () => {
    renderSettingsScreen();

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    setSectionAnchorGeometry("settings-timezone", {
      rootMetrics: { scrollTop: 1200, clientHeight: 800, scrollHeight: 2400 },
    });
    scrollSpy?.trigger(["settings-timezone", "settings-notifications"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });

    setRootMetrics({ scrollTop: 1600, clientHeight: 800, scrollHeight: 2400 });
    scrollSpy?.trigger(["settings-notifications"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");
    });
  });

  it("closes the mobile drawer after selecting a settings section", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));
    const drawer = await screen.findByTestId("settings-section-nav-drawer");
    await user.click(within(drawer).getByRole("link", { name: "通知" }));

    await waitFor(() => expect(screen.queryByTestId("settings-section-nav-drawer")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("#settings-notifications");

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));
    const reopenedDrawer = await screen.findByTestId("settings-section-nav-drawer");
    const activeNotificationLink = within(reopenedDrawer).getByRole("link", { name: "通知" });
    expect(activeNotificationLink).toHaveAttribute("aria-current", "location");
    expect(activeNotificationLink).toHaveClass("bg-primary/10", "text-primary");
    expect(activeNotificationLink.querySelector(".absolute.left-0")).not.toBeNull();
    expect(activeNotificationLink.querySelector("svg")).toBeNull();
  });

  it("does not ask for leave confirmation when unsaved changes navigate within settings hash", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      hasUnsavedChanges: true,
    }));

    renderSettingsScreen();

    const nav = screen.getByTestId("settings-section-nav-desktop");
    await user.click(within(nav).getByRole("link", { name: "通知" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#settings-notifications");
    confirmSpy.mockRestore();
  });

  it("updates built-in icon source and variant settings without allowing all sources off", async () => {
    const user = userEvent.setup();
    const controller = createControllerState();
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    expect(screen.getByText("已启用 3 个来源 · 变体 3/3")).toBeInTheDocument();
    expect(screen.getByText("TheSVG / selfh.st / Dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "切换 selfh.st icons 来源" })).not.toBeInTheDocument();

    const configureButton = screen.getByRole("button", { name: "配置" });
    await user.click(configureButton);

    const dialog = await screen.findByRole("dialog", { name: "配置内置图标来源" });
    expect(within(dialog).getByText("选择 Logo 和自定义图标搜索可使用的内置 SVG 图标库，并控制是否展示上游变体。")).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "切换 TheSVG 来源" })).toBeEnabled();
    expect(within(dialog).getByRole("switch", { name: "切换 selfh.st icons 来源" })).toBeEnabled();
    expect(within(dialog).getByRole("switch", { name: "切换 Dashboard Icons 来源" })).toBeEnabled();

    await user.click(within(dialog).getByRole("switch", { name: "切换 selfh.st icons 来源" }));
    expect(controller.updateSetting).toHaveBeenLastCalledWith("builtInIconSources", {
      ...DEFAULT_SETTINGS.builtInIconSources,
      selfhst: { enabled: false, variantsEnabled: true },
    });

    await user.click(within(dialog).getByRole("switch", { name: "切换 Dashboard Icons 变体" }));
    expect(controller.updateSetting).toHaveBeenLastCalledWith("builtInIconSources", {
      ...DEFAULT_SETTINGS.builtInIconSources,
      dashboardIcons: { enabled: true, variantsEnabled: false },
    });

    await user.click(within(dialog).getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog", { name: "配置内置图标来源" })).not.toBeInTheDocument();
    expect(configureButton).toHaveFocus();

    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        builtInIconSources: {
          thesvg: { enabled: true, variantsEnabled: true },
          selfhst: { enabled: false, variantsEnabled: true },
          dashboardIcons: { enabled: false, variantsEnabled: true },
        },
      },
    }));
    cleanup();
    renderSettingsScreen();

    expect(screen.getByText("已启用 1 个来源 · 变体 1/3")).toBeInTheDocument();
    expect(screen.getByText("TheSVG")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "配置" }));
    expect(await screen.findByRole("switch", { name: "切换 TheSVG 来源" })).toBeDisabled();
  });

  it("uses test wording for the Notifyx channel button", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["notifyx"],
        notifyxApiKey: "notifyx-key",
      },
    }));

    renderSettingsScreen();

    expect(screen.getByRole("button", { name: "测试 Notifyx 通知" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送 Notifyx 通知" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifyx 说明" })).toHaveAttribute(
      "href",
      "https://www.notifyx.cn/help",
    );
  });

  it("shows loading state on the active notification test button and disables other test buttons", async () => {
    const user = userEvent.setup();
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["telegram", "webhook"],
      },
      testingChannel: "telegram",
    }));

    renderSettingsScreen();

    const loadingButton = screen.getByRole("button", { name: "测试中..." });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("aria-busy", "true");

    await user.click(screen.getByRole("button", { name: "配置 Webhook 通知" }));

    expect(screen.getByRole("button", { name: "测试 Webhook 通知" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "测试 Telegram 通知" })).not.toBeInTheDocument();
  });

  it("renders only the active notification channel config panel", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["telegram", "notifyx", "webhook", "wechat", "email", "bark"],
      },
    }));

    renderSettingsScreen();

    expect(screen.getByRole("heading", { name: "Telegram 配置" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notifyx 配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Webhook 通知 配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "企业微信机器人 配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "邮件通知 配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bark 配置" })).not.toBeInTheDocument();
  });

  it("switches to Bark config when the Bark channel is selected", async () => {
    const user = userEvent.setup();
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["telegram", "bark"],
        barkServerUrl: "https://api.day.app",
        barkDeviceKey: "bark-device-key",
      },
    }));

    renderSettingsScreen();

    await user.click(screen.getByRole("button", { name: "配置 Bark" }));

    expect(screen.getByRole("heading", { name: "Bark 配置" })).toBeInTheDocument();
    expect(screen.getByLabelText("服务器地址")).toHaveValue("https://api.day.app");
    expect(screen.getByLabelText("设备 Key")).toHaveValue("bark-device-key");
    expect(screen.getByLabelText("静音推送")).toBeInTheDocument();
  });

  it("selects Bark immediately after checking it and keeps the test button available before enabling it", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      settings: {
        enabledChannels: ["telegram"],
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    await user.click(screen.getByRole("checkbox", { name: "启用 Bark" }));

    expect(controller.toggleChannel).toHaveBeenCalledWith("bark");
    expect(screen.getByRole("heading", { name: "Bark 配置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试 Bark 通知" })).toBeEnabled();
  });

  it("renders Webhook examples as placeholders instead of default textarea values", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["webhook"],
        webhookUrl: "https://example.com/webhook",
        webhookHeaders: "",
        webhookPayload: "",
      },
    }));

    renderSettingsScreen();

    const headers = screen.getByLabelText("自定义请求头 (JSON格式，可选)");
    const payload = screen.getByLabelText("发送负载 (JSON格式，可选)");

    expect(headers).toHaveValue("");
    expect(headers).toHaveAttribute("placeholder", WEBHOOK_HEADERS_PLACEHOLDER);
    expect(payload).toHaveValue("");
    expect(payload).toHaveAttribute("placeholder", WEBHOOK_PAYLOAD_PLACEHOLDER);
  });

  it("does not show the save bar when there are no unsaved changes", () => {
    renderSettingsScreen();

    expect(screen.queryByText("有未保存更改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存更改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃更改" })).not.toBeInTheDocument();
  });

  it("shows discard and save actions only when there are unsaved changes", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      hasUnsavedChanges: true,
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    expect(screen.getByText("有未保存更改")).toBeInTheDocument();
    expect(screen.getByTestId("settings-main")).toHaveClass("h5-bottom-bar-space");
    expect(screen.getByText("有未保存更改").closest(".h5-bottom-bar")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(controller.handleDiscardChanges).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存更改" }));
    expect(controller.handleSaveChanges).toHaveBeenCalled();
  });

  it("shows loading state on the save changes button", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      hasUnsavedChanges: true,
      isSavingSettings: true,
    }));

    renderSettingsScreen();

    const saveButton = screen.getByRole("button", { name: "保存中..." });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "保存所有设置" })).not.toBeInTheDocument();
  });
});
