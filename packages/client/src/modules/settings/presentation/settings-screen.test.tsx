// SettingsScreen 测试保护设置页分区装配和 Cloudflare/Docker 差异入口，不验证普通控件样式。
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  WEBHOOK_HEADERS_PLACEHOLDER,
  WEBHOOK_PAYLOAD_PLACEHOLDER,
} from "@/types/subscription";
import {
  createControllerState,
  mocks,
  renderSettingsScreen,
} from "./settings-screen.test-utils";

describe("SettingsScreen SMTP email settings", () => {
  beforeEach(() => {
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

  it("shows common currency quotes in the reporting currency direction", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        defaultCurrency: "CNY",
      },
      rates: {
        USD: 1,
        CNY: 6.78,
      },
    }));

    renderSettingsScreen();

    expect(screen.getByRole("heading", { name: "常用货币折算为 CNY" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "汇率预览 (1 CNY = )" })).not.toBeInTheDocument();
    expect(screen.getByText("1 USD")).toBeInTheDocument();
    expect(screen.getAllByText("≈ ¥6.78 CNY").length).toBeGreaterThan(0);
  });

  it("uses CNY as the first preview reference when another reporting currency is selected", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        defaultCurrency: "USD",
      },
      rates: {
        USD: 1,
        CNY: 6.78,
      },
    }));

    renderSettingsScreen();

    expect(screen.getByRole("heading", { name: "常用货币折算为 USD" })).toBeInTheDocument();
    const previewCards = screen.getByText("1 CNY").closest("div")?.parentElement?.children;
    expect(previewCards?.[0]).toHaveTextContent("1 CNY");
    expect(screen.getByText("≈ $0.1475 USD")).toBeInTheDocument();
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

  it("renders ServerChan config with SendKey input and help link", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      settings: {
        enabledChannels: ["telegram", "serverchan"],
        serverchanSendKey: "SCT123456",
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    expect(screen.getByText("SendKey 已填写")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "配置 Server酱" }));

    expect(screen.getByRole("heading", { name: "Server酱 配置" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Server酱 文档" })).toHaveAttribute("href", "https://sct.ftqq.com/");
    const input = screen.getByLabelText("SendKey");
    expect(input).toHaveValue("SCT123456");
    await user.type(input, "x");
    expect(controller.updateSetting).toHaveBeenLastCalledWith("serverchanSendKey", "SCT123456x");
    expect(screen.getByRole("button", { name: "测试 Server酱 通知" })).toBeEnabled();
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
