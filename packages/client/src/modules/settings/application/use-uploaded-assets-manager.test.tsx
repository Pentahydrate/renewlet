// 上传资产管理 hook 测试保护删除状态机：引用阻止时不能乐观移除，也不能替用户级联清空订阅 Logo。
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { UploadedAsset, UploadedAssetsPage, UploadKind } from "@/lib/api/schemas/media";
import { useUploadedAssetsManager } from "./use-uploaded-assets-manager";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/services/asset-service", () => ({
  assetService: {
    list: mocks.list,
    delete: mocks.delete,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "settings.uploadedIconsDeleteBlockedDescription") {
        return `仍被 ${String(params?.["count"])} 个订阅使用，请先替换或清空相关订阅 Logo。`;
      }
      if (key === "settings.uploadedIconsDeleteSuccessDescription") {
        return `已删除 ${String(params?.["name"])}。`;
      }
      const messages: Record<string, string> = {
        "settings.uploadedIconsDeleteFailed": "删除失败",
        "settings.uploadedIconsDeleteFailedDescription": "无法删除上传资产。",
        "settings.uploadedIconsDeleteSuccess": "已删除上传资产",
        "settings.uploadedIconsUnnamedAsset": "未命名资产",
      };
      return messages[key] ?? key;
    },
  }),
}));

function asset(overrides: Partial<UploadedAsset> = {}): UploadedAsset {
  return {
    id: "asset_logo",
    url: "/api/app/assets/asset_logo",
    kind: "logo",
    originalName: "logo.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    created: "2026-06-01T00:00:00.000Z",
    updated: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(items: UploadedAsset[], overrides: Partial<UploadedAssetsPage> = {}): UploadedAssetsPage {
  return {
    items,
    page: 1,
    totalPages: 1,
    ...overrides,
  };
}

function mockListOnce(logoPage: UploadedAssetsPage, iconPage: UploadedAssetsPage) {
  mocks.list.mockImplementation(async (kind: UploadKind) => (kind === "logo" ? logoPage : iconPage));
}

describe("useUploadedAssetsManager", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.delete.mockReset();
    mocks.toast.mockReset();
    mockListOnce(page([]), page([]));
  });

  it("loads logo and icon assets when settings opens", async () => {
    const logoAsset = asset({ id: "asset_logo", kind: "logo" });
    const iconAsset = asset({ id: "asset_icon", kind: "icon", originalName: "icon.svg" });
    mockListOnce(page([logoAsset]), page([iconAsset]));

    const { result } = renderHook(() => useUploadedAssetsManager());

    await waitFor(() => {
      expect(result.current.logo.assets.map((item) => item.id)).toEqual(["asset_logo"]);
      expect(result.current.icon.assets.map((item) => item.id)).toEqual(["asset_icon"]);
    });
    expect(mocks.list).toHaveBeenCalledWith("logo", 1);
    expect(mocks.list).toHaveBeenCalledWith("icon", 1);
  });

  it("removes a deleted asset from the matching kind list", async () => {
    const logoAsset = asset();
    mockListOnce(page([logoAsset]), page([]));
    mocks.delete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUploadedAssetsManager());

    await waitFor(() => expect(result.current.logo.assets).toHaveLength(1));
    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteAsset(logoAsset);
    });

    expect(deleted).toBe(true);
    expect(mocks.delete).toHaveBeenCalledWith("asset_logo");
    expect(result.current.logo.assets).toEqual([]);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "已删除上传资产",
    }));
  });

  it("keeps referenced assets in place and exposes the usage count", async () => {
    const logoAsset = asset();
    mockListOnce(page([logoAsset]), page([]));
    mocks.delete.mockRejectedValue(new ApiError(
      "in use",
      409,
      { message: "in use", code: "ASSET_IN_USE", details: { usageCount: 2 } },
      "ASSET_IN_USE",
    ));
    const { result } = renderHook(() => useUploadedAssetsManager());

    await waitFor(() => expect(result.current.logo.assets).toHaveLength(1));
    let deleted = true;
    await act(async () => {
      deleted = await result.current.deleteAsset(logoAsset);
    });

    expect(deleted).toBe(false);
    expect(result.current.logo.assets.map((item) => item.id)).toEqual(["asset_logo"]);
    expect(result.current.deleteError).toEqual({
      assetId: "asset_logo",
      message: "仍被 2 个订阅使用，请先替换或清空相关订阅 Logo。",
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "删除失败",
      variant: "destructive",
    }));
  });
});
