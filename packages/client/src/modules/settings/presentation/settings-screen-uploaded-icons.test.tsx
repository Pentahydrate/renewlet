import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createControllerState,
  createUploadedAssetsManagerState,
  mocks,
  renderSettingsScreen,
} from "./settings-screen.test-utils";

describe("SettingsScreen uploaded icon management", () => {
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
    window.history.replaceState(null, "", "/");
  });

  it("keeps uploaded icon management behind a compact settings entry", async () => {
    const user = userEvent.setup();
    const deleteAsset = vi.fn().mockResolvedValue(true);
    const loadMore = vi.fn().mockResolvedValue(undefined);
    mocks.useUploadedAssetsManager.mockReturnValue(createUploadedAssetsManagerState({
      logo: {
        assets: Array.from({ length: 4 }, (_, index) => ({
          id: `asset-logo-${index + 1}`,
          url: `/api/app/assets/asset-logo-${index + 1}`,
          kind: "logo" as const,
          originalName: `logo-${index + 1}.png`,
          mimeType: "image/png",
          sizeBytes: 2048 + index,
          updated: "2026-06-15T08:30:00.000Z",
        })),
        error: null,
        hasLoaded: true,
        hasMore: true,
        isLoading: false,
        isLoadingMore: false,
        refresh: vi.fn().mockResolvedValue(undefined),
        loadMore,
      },
      icon: {
        assets: [{
          id: "asset-icon",
          url: "/api/app/assets/asset-icon",
          kind: "icon",
          originalName: "server.svg",
          mimeType: "image/svg+xml",
          sizeBytes: 1024,
          updated: "2026-06-15T09:30:00.000Z",
        }],
        error: null,
        hasLoaded: true,
        hasMore: false,
        isLoading: false,
        isLoadingMore: false,
        refresh: vi.fn().mockResolvedValue(undefined),
        loadMore: vi.fn().mockResolvedValue(undefined),
      },
      deleteAsset,
    }));

    renderSettingsScreen();

    const section = document.getElementById("settings-uploaded-icons");
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText("上传图标")).toBeInTheDocument();
    expect(within(section as HTMLElement).getByText("已加载 5 个上传资产 · Logo 4 · 图标 1")).toBeInTheDocument();
    expect(within(section as HTMLElement).getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(within(section as HTMLElement).getByRole("button", { name: "管理上传图标" })).toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("logo-1.png")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("logo-2.png")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("logo-3.png")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("logo-4.png")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("server.svg")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("还没有上传过订阅 Logo")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("还没有上传过自定义图标")).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
    expect(within(section as HTMLElement).queryByRole("button", { name: /^删除/ })).not.toBeInTheDocument();

    await user.click(within(section as HTMLElement).getByRole("button", { name: "管理上传图标" }));
    const manager = await screen.findByRole("dialog", { name: "管理上传图标" });
    expect(manager).toHaveClass("overflow-hidden", "bg-card");
    expect(within(manager).getByRole("tab", { name: "订阅 Logo" })).toHaveAttribute("aria-selected", "true");
    expect(within(manager).getByText("logo-1.png")).toBeInTheDocument();
    expect(within(manager).getByText("logo-4.png")).toBeInTheDocument();
    await user.click(within(manager).getByRole("button", { name: "加载更多" }));
    expect(loadMore).toHaveBeenCalled();

    await user.click(within(manager).getByRole("button", { name: "删除 logo-1.png" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除上传资产？" });
    expect(within(dialog).getByText("logo-1.png")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "删除" });
    expect(confirm).toHaveClass("bg-destructive");
    await user.click(confirm);

    expect(deleteAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-logo-1" }));
  });

  it("keeps the uploaded asset delete dialog open when the asset is still referenced", async () => {
    const user = userEvent.setup();
    const deleteAsset = vi.fn().mockResolvedValue(false);
    mocks.useUploadedAssetsManager.mockReturnValue(createUploadedAssetsManagerState({
      logo: {
        assets: [{
          id: "asset-used",
          url: "/api/app/assets/asset-used",
          kind: "logo",
          originalName: "used.png",
        }],
        error: null,
        hasLoaded: true,
        hasMore: false,
        isLoading: false,
        isLoadingMore: false,
        refresh: vi.fn().mockResolvedValue(undefined),
        loadMore: vi.fn().mockResolvedValue(undefined),
      },
      deleteError: {
        assetId: "asset-used",
        message: "仍被 2 个订阅使用，请先替换或清空相关订阅 Logo。",
      },
      deleteAsset,
    }));

    renderSettingsScreen();
    const section = document.getElementById("settings-uploaded-icons") as HTMLElement;
    expect(within(section).queryByText("used.png")).not.toBeInTheDocument();
    expect(within(section).queryByText("仍被 2 个订阅使用，请先替换或清空相关订阅 Logo。")).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "管理上传图标" }));
    const manager = await screen.findByRole("dialog", { name: "管理上传图标" });
    expect(within(manager).getByText("used.png")).toBeInTheDocument();
    expect(within(manager).getByText("仍被 2 个订阅使用，请先替换或清空相关订阅 Logo。")).toBeInTheDocument();
    await user.click(within(manager).getByRole("button", { name: "删除 used.png" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "删除上传资产？" })).getByRole("button", { name: "删除" }));

    expect(deleteAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-used" }));
    expect(screen.getByRole("alertdialog", { name: "删除上传资产？" })).toBeInTheDocument();
  });
});
