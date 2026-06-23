import { describe, expect, it, vi } from "vitest";
import {
  AI_RECOGNITION_IMAGE_SOFT_BYTES,
  AI_RECOGNITION_IMAGE_TOTAL_SOFT_BYTES,
  AIRecognitionImagePreprocessError,
  aiRecognitionImageTargetBytes,
  prepareAIRecognitionImage,
  type AIRecognitionImagePreprocessPlatform,
} from "./ai-image-preprocess";

const HARD_BYTES = 5 * 1024 * 1024;

function fileOfSize(size: number, name = "subscriptions.png", type = "image/png"): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1 });
}

function platformFixture(options: {
  width?: number;
  height?: number;
  encodedSizes?: number[];
  encodedType?: string;
  decodeError?: Error;
} = {}): AIRecognitionImagePreprocessPlatform & {
  decode: ReturnType<typeof vi.fn<AIRecognitionImagePreprocessPlatform["decode"]>>;
  encode: ReturnType<typeof vi.fn<AIRecognitionImagePreprocessPlatform["encode"]>>;
  close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const encodedSizes = [...(options.encodedSizes ?? [512 * 1024])];
  const fallbackSize: number = encodedSizes[encodedSizes.length - 1] ?? 512 * 1024;
  return {
    close,
    decode: vi.fn(async () => {
      if (options.decodeError) throw options.decodeError;
      return {
        width: options.width ?? 1200,
        height: options.height ?? 900,
        source: {} as CanvasImageSource,
        close,
      };
    }),
    encode: vi.fn(async ({ mimeType }) => {
      const nextSize = encodedSizes.shift();
      const size = typeof nextSize === "number" ? nextSize : fallbackSize;
      return new Blob([new Uint8Array(size)], {
        type: options.encodedType ?? mimeType,
      });
    }),
  };
}

describe("ai image preprocess", () => {
  it("uses a 2MB per-image target while the total soft budget stays at 10MB", () => {
    expect(aiRecognitionImageTargetBytes(1)).toBe(AI_RECOGNITION_IMAGE_SOFT_BYTES);
    expect(aiRecognitionImageTargetBytes(5)).toBe(AI_RECOGNITION_IMAGE_SOFT_BYTES);
    expect(aiRecognitionImageTargetBytes(6)).toBe(Math.floor(AI_RECOGNITION_IMAGE_TOTAL_SOFT_BYTES / 6));
  });

  it("keeps already small and reasonably sized images unchanged", async () => {
    const platform = platformFixture({ width: 1280, height: 720 });
    const file = fileOfSize(300 * 1024);

    const result = await prepareAIRecognitionImage(file, {
      targetBytes: AI_RECOGNITION_IMAGE_SOFT_BYTES,
      platform,
    });

    expect(result).toMatchObject({
      file,
      optimized: false,
      warning: null,
      originalSizeBytes: file.size,
    });
    expect(platform.encode).not.toHaveBeenCalled();
    expect(platform.close).toHaveBeenCalledTimes(1);
  });

  it("resizes and encodes images that exceed the soft budget", async () => {
    const platform = platformFixture({
      width: 3600,
      height: 1800,
      encodedSizes: [1800 * 1024],
      encodedType: "image/webp",
    });
    const file = fileOfSize(3 * 1024 * 1024, "bill.png", "image/png");

    const result = await prepareAIRecognitionImage(file, {
      targetBytes: AI_RECOGNITION_IMAGE_SOFT_BYTES,
      platform,
    });

    expect(result.optimized).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.file.type).toBe("image/webp");
    expect(result.file.name).toBe("bill.webp");
    expect(result.file.size).toBe(1800 * 1024);
    expect(platform.encode).toHaveBeenCalledWith(expect.objectContaining({
      width: 2048,
      height: 1024,
      mimeType: "image/webp",
      quality: 0.92,
    }));
  });

  it("keeps the best under-hard-limit output with a warning when the soft target cannot be reached", async () => {
    const platform = platformFixture({
      encodedSizes: [3 * 1024 * 1024, 2600 * 1024, 2400 * 1024],
    });
    const file = fileOfSize(4 * 1024 * 1024, "large.jpg", "image/jpeg");

    const result = await prepareAIRecognitionImage(file, {
      targetBytes: AI_RECOGNITION_IMAGE_SOFT_BYTES,
      platform,
    });

    expect(result.optimized).toBe(true);
    expect(result.warning).toBe("large-after-optimization");
    expect(result.file.size).toBe(2400 * 1024);
    expect(result.file.size).toBeLessThan(HARD_BYTES);
  });

  it("falls back to the original image when browser decoding is unavailable", async () => {
    const platform = platformFixture({ decodeError: new Error("decode unavailable") });
    const file = fileOfSize(3 * 1024 * 1024);

    const result = await prepareAIRecognitionImage(file, {
      targetBytes: AI_RECOGNITION_IMAGE_SOFT_BYTES,
      platform,
    });

    expect(result.file).toBe(file);
    expect(result.optimized).toBe(false);
    expect(result.warning).toBe("passthrough");
  });

  it("rejects files over the hard model input limit before decoding", async () => {
    const platform = platformFixture();
    const file = fileOfSize(HARD_BYTES + 1);

    await expect(prepareAIRecognitionImage(file, {
      targetBytes: AI_RECOGNITION_IMAGE_SOFT_BYTES,
      platform,
    })).rejects.toMatchObject({
      name: "AIRecognitionImagePreprocessError",
      code: "too-large",
    } satisfies Partial<AIRecognitionImagePreprocessError>);
    expect(platform.decode).not.toHaveBeenCalled();
  });

  it("propagates aborts so callers can ignore stale image selections", async () => {
    const platform = platformFixture();
    const controller = new AbortController();
    controller.abort();

    await expect(prepareAIRecognitionImage(fileOfSize(512 * 1024), {
      targetBytes: AI_RECOGNITION_IMAGE_SOFT_BYTES,
      platform,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(platform.decode).not.toHaveBeenCalled();
  });
});
