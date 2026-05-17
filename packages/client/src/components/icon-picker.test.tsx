import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/upload-constraints";
import { IconPicker } from "./icon-picker";

type ApiFetchMock = (
  url: string,
  responseSchema: unknown,
  init?: { signal?: AbortSignal },
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<ApiFetchMock>(),
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

vi.mock("@/components/image-crop-dialog", () => ({
  ImageCropDialog: () => null,
}));

function expectApiFetchCallWithSignal(urlPart: string) {
  const call = mocks.apiFetch.mock.calls.find(([url]) => url.includes(urlPart));
  expect(call?.[0]).toContain(urlPart);
  expect(call?.[2]?.signal).toBeInstanceOf(AbortSignal);
}

describe("IconPicker", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/app/thesvg-icons")) {
        return Promise.resolve({
          icons: [
            {
              slug: "binance",
              title: "Binance",
              iconUrl: "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/binance/default.svg",
              aliases: [],
              categories: ["Payment", "Finance"],
            },
          ],
        });
      }

      return Promise.resolve({ imageUrls: [], kind: "icon" });
    });
  });

  it("searches built-in theSVG icons when opening the payment icon search", async () => {
    const user = userEvent.setup();

    render(<IconPicker value={undefined} onChange={vi.fn()} searchHint="Binance" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => {
      expectApiFetchCallWithSignal("/api/app/thesvg-icons?search=Binance");
    });
    expect(await screen.findByRole("button", { name: "Binance" })).toHaveClass("media-thumbnail-canvas");
    expect(await screen.findByAltText("Binance")).toHaveClass("media-thumbnail-image");
  });

  it("allows SVG files in the custom icon file picker", () => {
    const { container } = render(<IconPicker value={undefined} onChange={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    expect(input).toHaveAttribute("accept", IMAGE_UPLOAD_ACCEPT);
  });

  it("uses the shared low-noise canvas for the current icon preview", () => {
    render(<IconPicker value="https://example.com/icon.svg" onChange={vi.fn()} />);

    const icon = screen.getByAltText("Icon");
    const iconPreview = icon.closest(".media-thumbnail-canvas");
    expect(icon).toHaveClass("media-thumbnail-image");
    expect(iconPreview).not.toBeNull();
    expect(iconPreview).toHaveClass("media-thumbnail-canvas");
  });

  it("selects a built-in theSVG icon from the unified icon search", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<IconPicker value={undefined} onChange={onChange} searchHint="Binance" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));
    const binanceButton = await screen.findByTitle("Binance");
    expect(binanceButton).toHaveAttribute("aria-pressed", "false");
    await user.click(binanceButton);

    expect(onChange).toHaveBeenCalledWith(
      "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/binance/default.svg",
    );
  });

  it("marks a selected built-in icon thumbnail with the shared canvas and pressed state", async () => {
    const user = userEvent.setup();
    const selectedIcon =
      "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons/binance/default.svg";

    render(<IconPicker value={selectedIcon} onChange={vi.fn()} searchHint="Binance" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));
    const selectedButton = await screen.findByRole("button", { name: "Binance" });

    expect(selectedButton).toHaveClass("media-thumbnail-canvas", "border-primary");
    expect(selectedButton).toHaveAttribute("aria-pressed", "true");
    expect(selectedButton.querySelector("span[aria-hidden='true'] svg")).not.toBeNull();
  });

  it("keeps the search box empty after clearing the auto-filled payment name", async () => {
    const user = userEvent.setup();

    render(<IconPicker value={undefined} onChange={vi.fn()} searchHint="Binance" />);

    await user.click(screen.getByRole("button", { name: "搜索" }));
    const searchInput = screen.getByPlaceholderText("输入名称...");

    await waitFor(() => {
      expect(searchInput).toHaveValue("Binance");
    });
    expectApiFetchCallWithSignal("/api/app/thesvg-icons?search=Binance");

    await user.clear(searchInput);

    expect(searchInput).toHaveValue("");
  });
});
