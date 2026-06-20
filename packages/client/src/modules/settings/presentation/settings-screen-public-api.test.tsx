// Public API 与 Telegram 命令入口测试单独成文件，避免设置页主装配测试超过文件行数门禁。
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createControllerState,
  createUploadedAssetsManagerState,
  mocks,
  renderSettingsScreen,
} from "./settings-screen.test-utils";

describe("SettingsScreen Public API and Telegram commands", () => {
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
    mocks.useUploadedAssetsManager.mockReturnValue(createUploadedAssetsManagerState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Public API token management with one-time token and delete flow", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      publicApi: {
        createdPlainToken: "rlt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
        tokens: [{
          id: "tok_1",
          name: "Telegram Bot",
          tokenPrefix: "rlt_abc123",
          scopes: ["read"],
          createdAt: "2026-06-20T00:00:00Z",
          lastUsedAt: null,
        }],
      },
    });
    controller.publicApi.createToken = vi.fn().mockResolvedValue(true);
    controller.publicApi.copyPlainToken = vi.fn().mockResolvedValue(undefined);
    controller.publicApi.dismissPlainToken = vi.fn();
    controller.publicApi.deleteToken = vi.fn().mockResolvedValue(undefined);
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    expect(screen.getByRole("heading", { name: "Public API" })).toBeInTheDocument();
    expect(screen.getByText("当前 1 个 token。")).toBeInTheDocument();
    expect(screen.getByText("有一个一次性 token 等待复制。")).toBeInTheDocument();
    expect(screen.queryByLabelText("一次性 API Token")).not.toBeInTheDocument();
    expect(screen.queryByText("rlt_abc123")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "管理 token" }));
    const managementDialog = await screen.findByRole("dialog", { name: "管理 Public API token" });
    expect(within(managementDialog).getByLabelText("一次性 API Token")).toHaveValue("rlt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12");
    expect(within(managementDialog).getByText("rlt_abc123")).toBeInTheDocument();
    expect(within(managementDialog).getByText("权限：read")).toBeInTheDocument();

    await user.type(within(managementDialog).getByLabelText("Token 名称"), "Shortcuts");
    await user.click(within(managementDialog).getByRole("button", { name: "创建 token" }));
    expect(controller.publicApi.createToken).toHaveBeenCalledWith("Shortcuts");

    await user.click(within(managementDialog).getByRole("button", { name: "复制 token" }));
    expect(controller.publicApi.copyPlainToken).toHaveBeenCalled();

    await user.click(within(managementDialog).getByRole("button", { name: "完成" }));
    expect(controller.publicApi.dismissPlainToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "管理 token" }));
    const reopenedManagementDialog = await screen.findByRole("dialog", { name: "管理 Public API token" });
    await user.click(within(reopenedManagementDialog).getByRole("button", { name: "关闭一次性 API Token" }));
    expect(controller.publicApi.dismissPlainToken).toHaveBeenCalled();

    await user.click(within(reopenedManagementDialog).getByRole("button", { name: "删除" }));
    const deleteDialog = await screen.findByRole("alertdialog", { name: "删除 API Token？" });
    expect(within(deleteDialog).getByText("「Telegram Bot」会被永久删除，外部集成后续请求将返回未授权。")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "删除" }));
    expect(controller.publicApi.deleteToken).toHaveBeenCalledWith("tok_1");
  });

  it("keeps Public API token rows inside the management dialog", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      publicApi: {
        tokens: [
          {
            id: "tok_1",
            name: "Telegram Bot",
            tokenPrefix: "rlt_telegram",
            scopes: ["read"],
            createdAt: "2026-06-20T00:00:00Z",
            lastUsedAt: null,
          },
          {
            id: "tok_2",
            name: "Shortcuts",
            tokenPrefix: "rlt_short",
            scopes: ["read"],
            createdAt: "2026-06-20T01:00:00Z",
            lastUsedAt: "2026-06-20T02:00:00Z",
          },
          {
            id: "tok_3",
            name: "CLI",
            tokenPrefix: "rlt_old",
            scopes: ["read"],
            createdAt: "2026-06-19T00:00:00Z",
            lastUsedAt: null,
          },
        ],
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    expect(screen.getByText("当前 3 个 token。")).toBeInTheDocument();
    expect(screen.queryByText("Telegram Bot")).not.toBeInTheDocument();
    expect(screen.queryByText("rlt_telegram")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "管理 token" }));
    const managementDialog = await screen.findByRole("dialog", { name: "管理 Public API token" });
    expect(within(managementDialog).getByText("Telegram Bot")).toBeInTheDocument();
    expect(within(managementDialog).getByText("Shortcuts")).toBeInTheDocument();
    expect(within(managementDialog).getByText("CLI")).toBeInTheDocument();
    expect(within(managementDialog).getByText("rlt_telegram")).toBeInTheDocument();
    expect(within(managementDialog).queryByText("已撤销")).not.toBeInTheDocument();
  });

  it("renders Telegram Bot query command controls inside the Telegram notification panel", async () => {
    const user = userEvent.setup();
    const install = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const deleteCommands = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = createControllerState({
      settings: {
        enabledChannels: ["telegram"],
        telegramBotToken: "123456:bot-token",
        telegramChatId: "123456",
      },
      telegramBotCommands: {
        data: {
          configComplete: true,
          installed: true,
          status: "installed",
          chatId: "123456",
          installedAt: "2026-06-20T00:00:00Z",
          lastUsedAt: null,
        },
        installDisabledReason: null,
        deleteDisabledReason: null,
        install,
        deleteCommands,
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();

    const notificationsSection = document.getElementById("settings-notifications");
    expect(notificationsSection).not.toBeNull();
    const telegramPanel = within(notificationsSection as HTMLElement);
    expect(telegramPanel.getByText("Bot 查询命令")).toBeInTheDocument();
    expect(telegramPanel.getByText("Telegram 消息样式")).toBeInTheDocument();
    expect(telegramPanel.getByRole("radiogroup", { name: "Telegram 消息样式" })).toBeInTheDocument();
    expect(telegramPanel.getByRole("radio", { name: /纯文本/ })).toBeChecked();
    expect(telegramPanel.getByRole("radio", { name: /富文本/ })).not.toBeChecked();
    expect(telegramPanel.getByText("已安装")).toBeInTheDocument();
    expect(telegramPanel.getByText("绑定 Chat ID：123456")).toBeInTheDocument();
    expect(telegramPanel.getByText("最后使用：从未")).toBeInTheDocument();

    await user.click(telegramPanel.getByRole("radio", { name: /富文本/ }));
    expect(controller.updateSetting).toHaveBeenCalledWith("telegramMessageFormat", "html");

    await user.click(telegramPanel.getByRole("button", { name: "重新安装" }));
    expect(install).toHaveBeenCalledTimes(1);

    await user.click(telegramPanel.getByRole("button", { name: "删除命令" }));
    const deleteDialog = await screen.findByRole("alertdialog", { name: "删除 Telegram Bot 查询命令？" });
    expect(within(deleteDialog).getByText("删除后 Telegram 菜单命令会失效，需要时可以重新安装。")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "删除命令" }));
    expect(deleteCommands).toHaveBeenCalledTimes(1);
  });

  it("disables Telegram command installation when saved Telegram credentials are missing", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["telegram"],
        telegramBotToken: "",
        telegramChatId: "",
      },
      telegramBotCommands: {
        installDisabledReason: "请先填写并保存 Bot Token 和 Chat ID。",
      },
    }));

    renderSettingsScreen();

    const notificationsSection = document.getElementById("settings-notifications");
    expect(notificationsSection).not.toBeNull();
    const telegramPanel = within(notificationsSection as HTMLElement);
    expect(telegramPanel.getByText("请先填写并保存 Bot Token 和 Chat ID。")).toBeInTheDocument();
    expect(telegramPanel.getByRole("button", { name: "安装命令" })).toBeDisabled();
  });

  it("shows Telegram command install loading label", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["telegram"],
        telegramBotToken: "123456:bot-token",
        telegramChatId: "123456",
      },
      telegramBotCommands: {
        data: {
          configComplete: true,
          installed: false,
          status: "installing",
          chatId: "123456",
          installedAt: null,
          lastUsedAt: null,
        },
        installDisabledReason: null,
        deleteDisabledReason: null,
        isInstalling: true,
      },
    }));

    renderSettingsScreen();

    const notificationsSection = document.getElementById("settings-notifications");
    expect(notificationsSection).not.toBeNull();
    const telegramPanel = within(notificationsSection as HTMLElement);
    expect(telegramPanel.getByRole("button", { name: "安装中..." })).toHaveAttribute("aria-busy", "true");
    expect(telegramPanel.queryAllByText("安装中...")).toHaveLength(1);
  });

  it("shows Telegram command delete loading label", () => {
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      settings: {
        enabledChannels: ["telegram"],
        telegramBotToken: "123456:bot-token",
        telegramChatId: "123456",
      },
      telegramBotCommands: {
        data: {
          configComplete: true,
          installed: true,
          status: "installed",
          chatId: "123456",
          installedAt: "2026-06-20T00:00:00Z",
          lastUsedAt: null,
        },
        installDisabledReason: null,
        deleteDisabledReason: null,
        isDeleting: true,
      },
    }));

    renderSettingsScreen();

    const notificationsSection = document.getElementById("settings-notifications");
    expect(notificationsSection).not.toBeNull();
    expect(within(notificationsSection as HTMLElement).getByRole("button", { name: "删除中..." })).toHaveAttribute("aria-busy", "true");
  });
});
