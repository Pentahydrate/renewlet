import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/upload-constraints";
import { LogoPicker } from "./logo-picker";

type ApiFetchMock = (
  url: string,
  responseSchema: unknown,
  init?: { signal?: AbortSignal },
) => Promise<unknown>;

type UploadedLogoAssetFixture = {
  id: string;
  url: string;
  kind: "logo";
  originalName?: string;
};

type UploadedLogosStateFixture = {
  assets: UploadedLogoAssetFixture[];
  error: Error | null;
  hasLoaded: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
};

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<ApiFetchMock>(),
  loadUploadedLogosInitial: vi.fn<() => Promise<void>>(),
  loadUploadedLogosMore: vi.fn<() => Promise<void>>(),
  resetUploadedLogos: vi.fn<() => void>(),
  uploadedLogosState: {
    current: {
      assets: [],
      error: null,
      hasLoaded: false,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
    } as UploadedLogosStateFixture,
  },
}));

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError,
    apiFetch: mocks.apiFetch,
  };
});

vi.mock("@/hooks/use-cropped-image-upload", () => ({
  useCroppedImageUpload: (options: { onChange: (value: string | undefined) => void }) => ({
    fileInputRef: { current: null },
    cropDialogOpen: false,
    setCropDialogOpen: vi.fn(),
    uploadedImage: "",
    uploadStatus: "idle",
    previewUrl: undefined,
    handleFileUpload: vi.fn(),
    handleCropComplete: vi.fn(),
    applyValue: (value: string | undefined) => options.onChange(value),
  }),
}));

vi.mock("@/hooks/use-uploaded-logo-assets", () => ({
  useUploadedLogoAssets: () => ({
    ...mocks.uploadedLogosState.current,
    loadInitial: mocks.loadUploadedLogosInitial,
    loadMore: mocks.loadUploadedLogosMore,
    reset: mocks.resetUploadedLogos,
  }),
}));

vi.mock("@/components/image-crop-dialog", () => ({
  ImageCropDialog: () => null,
}));

function expectApiFetchCallWithSignal(urlPart: string) {
  const call = mocks.apiFetch.mock.calls.find(([url]) => url.includes(urlPart));
  expect(call?.[0]).toContain(urlPart);
  expect(call?.[2]?.signal).toBeInstanceOf(AbortSignal);
}

describe("LogoPicker", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.loadUploadedLogosInitial.mockReset();
    mocks.loadUploadedLogosMore.mockReset();
    mocks.resetUploadedLogos.mockReset();
    mocks.loadUploadedLogosInitial.mockResolvedValue(undefined);
    mocks.loadUploadedLogosMore.mockResolvedValue(undefined);
    mocks.uploadedLogosState.current = {
      assets: [],
      error: null,
      hasLoaded: false,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
    };
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/app/thesvg-icons")) {
        return Promise.resolve({
          icons: [
            {
              slug: "netflix",
              title: "Netflix",
              iconUrl: "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/netflix/default.svg",
              aliases: [],
              categories: ["Entertainment"],
            },
          ],
        });
      }

      return Promise.resolve({ imageUrls: [], kind: "logo" });
    });
  });

  it("searches and selects a built-in theSVG logo from the unified Logo search", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<LogoPicker value={undefined} onChange={onChange} serviceName="Netflix" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      expectApiFetchCallWithSignal("/api/app/thesvg-icons?search=Netflix");
    });

    expect(await screen.findByText("内置图标：")).toBeInTheDocument();
    const netflixButton = await screen.findByTitle("Netflix");
    expect(netflixButton).toHaveClass("media-thumbnail-canvas");
    expect(await screen.findByAltText("Netflix")).toHaveClass("media-thumbnail-image");
    await user.click(netflixButton);

    expect(onChange).toHaveBeenCalledWith(
      "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/netflix/default.svg",
    );
  });

  it("uses the shared low-noise canvas for the current Logo preview", () => {
    render(<LogoPicker value="https://example.com/logo.svg" onChange={vi.fn()} />);

    const logo = screen.getByAltText("Logo");
    const logoPreview = logo.closest(".media-thumbnail-canvas");
    expect(logo).toHaveClass("media-thumbnail-image");
    expect(logoPreview).not.toBeNull();
    expect(logoPreview).not.toHaveClass("border-dashed");
  });

  it("allows SVG files in the custom Logo file picker", () => {
    const { container } = render(<LogoPicker value={undefined} onChange={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const emptyPreview = input?.parentElement;

    expect(input).toHaveAttribute("accept", IMAGE_UPLOAD_ACCEPT);
    expect(emptyPreview).toHaveClass("border-dashed");
    expect(emptyPreview).not.toHaveClass("media-thumbnail-canvas");
  });

  it("selects an uploaded custom Logo from the uploaded Logo picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mocks.uploadedLogosState.current = {
      assets: [
        {
          id: "asset-1",
          url: "/api/app/assets/asset-1",
          kind: "logo",
          originalName: "netflix.png",
        },
      ],
      error: null,
      hasLoaded: true,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
    };

    render(<LogoPicker value={undefined} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "上传 Logo" })).toHaveClass("w-full");
    expect(screen.getByRole("button", { name: "已上传" })).toHaveClass("h-8");
    expect(screen.getByRole("button", { name: "搜索" })).toHaveClass("h-8");
    await user.click(screen.getByRole("button", { name: "已上传" }));

    expect(mocks.loadUploadedLogosInitial).toHaveBeenCalledTimes(1);
    const uploadedLogoButton = await screen.findByRole("button", { name: "netflix.png" });
    expect(uploadedLogoButton).toHaveClass("media-thumbnail-canvas");
    expect(uploadedLogoButton).toHaveAttribute("aria-pressed", "false");
    await user.click(uploadedLogoButton);

    expect(onChange).toHaveBeenCalledWith("/api/app/assets/asset-1");
  });

  it("shows empty, retry, load-more, and selected states in the uploaded Logo picker", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LogoPicker value={undefined} onChange={vi.fn()} />);

    mocks.uploadedLogosState.current = {
      assets: [],
      error: null,
      hasLoaded: true,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
    };
    rerender(<LogoPicker value={undefined} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "已上传" }));
    expect(await screen.findByText("还没有上传过自定义 Logo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "已上传" }));
    mocks.uploadedLogosState.current = {
      assets: [],
      error: new Error("offline"),
      hasLoaded: true,
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
    };
    rerender(<LogoPicker value={undefined} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "已上传" }));
    expect(await screen.findByText("已上传 Logo 加载失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.loadUploadedLogosInitial).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "已上传" }));
    mocks.uploadedLogosState.current = {
      assets: [
        {
          id: "asset-2",
          url: "/api/app/assets/asset-2",
          kind: "logo",
          originalName: "selected.svg",
        },
      ],
      error: null,
      hasLoaded: true,
      hasMore: true,
      isLoading: false,
      isLoadingMore: false,
    };
    rerender(<LogoPicker value="/api/app/assets/asset-2" onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "已上传" }));

    const selectedLogoButton = await screen.findByRole("button", { name: "selected.svg" });
    expect(selectedLogoButton).toHaveClass("media-thumbnail-canvas", "border-primary");
    expect(selectedLogoButton).toHaveAttribute("aria-pressed", "true");
    expect(selectedLogoButton.querySelector("span[aria-hidden='true'] svg")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(mocks.loadUploadedLogosMore).toHaveBeenCalledTimes(1);
  });

  it("shows a clear built-in icon empty state while keeping favicon fallback results", async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/app/thesvg-icons")) {
        return Promise.resolve({ icons: [] });
      }

      return Promise.resolve({ imageUrls: [], kind: "logo" });
    });

    render(<LogoPicker value={undefined} onChange={vi.fn()} serviceName="DMIT" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(await screen.findByText("内置图标：")).toBeInTheDocument();
    expect(await screen.findByText("内置图标未命中")).toBeInTheDocument();
    expect(screen.getByText("网站/Favicon 备用：")).toBeInTheDocument();
  });

  it("shows a built-in icon failure state when the theSVG endpoint fails", async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/app/thesvg-icons")) {
        return Promise.reject(new Error("theSVG offline"));
      }

      return Promise.resolve({ imageUrls: [], kind: "logo" });
    });

    render(<LogoPicker value={undefined} onChange={vi.fn()} serviceName="DMIT" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(await screen.findByText("内置图标：")).toBeInTheDocument();
    expect(await screen.findByText("内置图标搜索失败")).toBeInTheDocument();
    expect(screen.getByText("网站/Favicon 备用：")).toBeInTheDocument();
  });

  it("keeps the search box empty after clearing the auto-filled service name", async () => {
    const user = userEvent.setup();

    render(<LogoPicker value={undefined} onChange={vi.fn()} serviceName="youtube" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));
    const searchInput = screen.getByPlaceholderText("输入服务名称或品牌...");

    await waitFor(() => {
      expect(searchInput).toHaveValue("youtube");
    });
    expectApiFetchCallWithSignal("/api/app/thesvg-icons?search=youtube");

    await user.clear(searchInput);

    expect(searchInput).toHaveValue("");
  });
});
