// 内置图标索引状态测试单独成文件，避免设置页主装配测试被 provider fixture 撑过行数守卫。
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BuiltInIconProvider } from "@renewlet/shared/built-in-icons";
import {
  createControllerState,
  mocks,
  renderSettingsScreen,
} from "./settings-screen.test-utils";

describe("SettingsScreen built-in icon index controls", () => {
  it("lets admins inspect and refresh an icon provider from a compact status badge", async () => {
    const user = userEvent.setup();
    const controller = createControllerState({
      builtInIconIndex: {
        status: {
          source: "runtime",
          hash: "runtime-hash",
          iconCount: 321,
          providerCounts: { thesvg: 120, selfhst: 100, dashboardIcons: 101 },
          checkedAt: "2026-06-11T00:00:00.000Z",
          updatedAt: "2026-06-11T00:00:00.000Z",
          refreshing: false,
          providers: [
            {
              provider: "thesvg",
              current: {
                sourceRef: "oldsha1234567890abcdef",
                displayVersion: "oldsha1",
                commitSha: "oldsha1234567890abcdef",
                commitShortSha: "oldsha1",
                commitDate: "2026-06-10T00:00:00.000Z",
                releaseTag: null,
                releasePublishedAt: null,
              },
              latest: {
                sourceRef: "newsha1234567890abcdef",
                displayVersion: "newsha1",
                commitSha: "newsha1234567890abcdef",
                commitShortSha: "newsha1",
                commitDate: "2026-06-11T00:00:00.000Z",
                releaseTag: null,
                releasePublishedAt: null,
              },
              iconCount: 120,
              checkedAt: "2026-06-11T00:00:00.000Z",
              refreshedAt: "2026-06-10T00:00:00.000Z",
              lastError: null,
              refreshing: false,
              updateAvailable: true,
            },
            {
              provider: "selfhst",
              current: null,
              latest: null,
              iconCount: 100,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
            {
              provider: "dashboardIcons",
              current: null,
              latest: null,
              iconCount: 101,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
          ],
        },
      },
    });
    const check = vi.fn<(provider: BuiltInIconProvider) => Promise<void>>().mockResolvedValue(undefined);
    const openProviderStatus = vi.fn<(provider: BuiltInIconProvider) => Promise<void>>()
      .mockImplementation((provider) => check(provider));
    const refresh = vi.fn<(provider: BuiltInIconProvider) => Promise<void>>().mockResolvedValue(undefined);
    controller.builtInIconIndex.openProviderStatus = openProviderStatus;
    controller.builtInIconIndex.checkProvider = check;
    controller.builtInIconIndex.refreshProvider = refresh;
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();
    await user.click(screen.getByRole("button", { name: "配置" }));

    const dialog = await screen.findByRole("dialog", { name: "配置内置图标来源" });
    expect(dialog).toHaveClass("gap-0");
    expect(within(dialog).queryByText("120 个图标")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/当前：/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/最新：/)).not.toBeInTheDocument();
    const statusBadge = within(dialog).getByRole("button", { name: "查看 TheSVG 图标索引状态：有更新" });
    expect(statusBadge).toHaveTextContent("有更新");
    expect(controller.builtInIconIndex.checkAllProviders).not.toHaveBeenCalled();

    const updateSettingCallsBeforeRefresh = controller.updateSetting.mock.calls.length;
    await user.click(statusBadge);

    expect(openProviderStatus).toHaveBeenCalledWith("thesvg");
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith("thesvg");
    expect(await screen.findByText("图标数量")).toBeInTheDocument();
    const portalHost = screen.getByText("图标数量").closest("[data-mobile-overlay-portal]");
    expect(portalHost).toHaveClass("contents");
    expect(screen.getByText("120 个图标")).toBeInTheDocument();
    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.getByText("最新版本")).toBeInTheDocument();
    expect(screen.getByText(/oldsha1/)).toBeInTheDocument();
    expect(screen.queryByText("手动更新")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "检查 TheSVG 最新版本" }));
    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledWith("thesvg");

    await user.click(screen.getByRole("button", { name: "更新" }));

    expect(refresh).toHaveBeenCalledWith("thesvg");
    expect(controller.updateSetting).toHaveBeenCalledTimes(updateSettingCallsBeforeRefresh);
    expect(screen.queryByText("有未保存更改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存更改" })).not.toBeInTheDocument();
  });

  it("automatically checks a provider when admins open its status popover", async () => {
    const user = userEvent.setup();
    const check = vi.fn<(provider: BuiltInIconProvider) => Promise<void>>().mockResolvedValue(undefined);
    const openProviderStatus = vi.fn<(provider: BuiltInIconProvider) => Promise<void>>()
      .mockImplementation((provider) => check(provider));
    const controller = createControllerState({
      builtInIconIndex: {
        openProviderStatus,
        checkProvider: check,
      },
    });
    mocks.useSettingsFormController.mockReturnValue(controller);

    renderSettingsScreen();
    await user.click(screen.getByRole("button", { name: "配置" }));

    const dialog = await screen.findByRole("dialog", { name: "配置内置图标来源" });
    await user.click(within(dialog).getByRole("button", { name: "查看 Dashboard Icons 图标索引状态：未检查" }));

    expect(openProviderStatus).toHaveBeenCalledWith("dashboardIcons");
    expect(check).toHaveBeenCalledWith("dashboardIcons");
    expect(controller.updateSetting).not.toHaveBeenCalled();
  });

  it("hides the icon index refresh panel from non-admin controllers", async () => {
    const user = userEvent.setup();
    const openProviderStatus = vi.fn<(provider: BuiltInIconProvider) => Promise<void>>().mockResolvedValue(undefined);
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      builtInIconIndex: {
        canManage: false,
        openProviderStatus,
      },
    }));

    renderSettingsScreen();
    await user.click(screen.getByRole("button", { name: "配置" }));

    const dialog = await screen.findByRole("dialog", { name: "配置内置图标来源" });
    expect(within(dialog).queryByRole("button", { name: /图标索引状态/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
    expect(openProviderStatus).not.toHaveBeenCalled();
  });

  it("shows unknown instead of source labels when current provider version has no commit metadata", async () => {
    const user = userEvent.setup();
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      builtInIconIndex: {
        status: {
          source: "runtime",
          hash: "runtime-hash",
          iconCount: 1,
          providerCounts: { thesvg: 1, selfhst: 0, dashboardIcons: 0 },
          checkedAt: null,
          updatedAt: null,
          refreshing: false,
          providers: [
            {
              provider: "thesvg",
              current: {
                sourceRef: "runtime",
                displayVersion: "runtime",
                commitSha: null,
                commitShortSha: null,
                commitDate: null,
                releaseTag: null,
                releasePublishedAt: null,
              },
              latest: null,
              iconCount: 1,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
            {
              provider: "selfhst",
              current: null,
              latest: null,
              iconCount: 0,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
            {
              provider: "dashboardIcons",
              current: null,
              latest: null,
              iconCount: 0,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
          ],
        },
      },
    }));

    renderSettingsScreen();
    await user.click(screen.getByRole("button", { name: "配置" }));
    await user.click(await screen.findByRole("button", { name: "查看 TheSVG 图标索引状态：未检查" }));

    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.getAllByText("未知版本").length).toBeGreaterThan(0);
    expect(screen.queryByText("手动更新")).not.toBeInTheDocument();
  });

  it("disables provider index actions while refreshing", async () => {
    const user = userEvent.setup();
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      builtInIconIndex: {
        refreshingProvider: "thesvg",
      },
    }));

    renderSettingsScreen();
    await user.click(screen.getByRole("button", { name: "配置" }));

    const dialog = await screen.findByRole("dialog", { name: "配置内置图标来源" });
    const statusBadge = within(dialog).getByRole("button", { name: "查看 TheSVG 图标索引状态：更新中" });
    expect(statusBadge).toHaveTextContent("更新中");

    await user.click(statusBadge);

    expect(screen.getByRole("button", { name: "检查 TheSVG 最新版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "更新中..." })).toBeDisabled();
  });

  it("shows provider index errors inside the compact status popover", async () => {
    const user = userEvent.setup();
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      builtInIconIndex: {
        status: {
          source: "runtime",
          hash: "runtime-hash",
          iconCount: 321,
          providerCounts: { thesvg: 120, selfhst: 100, dashboardIcons: 101 },
          checkedAt: "2026-06-11T00:00:00.000Z",
          updatedAt: "2026-06-11T00:00:00.000Z",
          refreshing: false,
          providers: [
            {
              provider: "thesvg",
              current: null,
              latest: null,
              iconCount: 120,
              checkedAt: "2026-06-11T00:00:00.000Z",
              refreshedAt: null,
              lastError: "Registry offline",
              refreshing: false,
              updateAvailable: false,
            },
            {
              provider: "selfhst",
              current: null,
              latest: null,
              iconCount: 100,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
            {
              provider: "dashboardIcons",
              current: null,
              latest: null,
              iconCount: 101,
              checkedAt: null,
              refreshedAt: null,
              lastError: null,
              refreshing: false,
              updateAvailable: false,
            },
          ],
        },
      },
    }));

    renderSettingsScreen();
    await user.click(screen.getByRole("button", { name: "配置" }));

    const dialog = await screen.findByRole("dialog", { name: "配置内置图标来源" });
    const statusBadge = within(dialog).getByRole("button", { name: "查看 TheSVG 图标索引状态：检查失败" });
    expect(statusBadge).toHaveTextContent("检查失败");

    await user.click(statusBadge);

    expect(await screen.findByRole("alert")).toHaveTextContent("上次更新失败：Registry offline");
    expect(screen.getByRole("button", { name: "更新" })).toBeEnabled();
  });
});
