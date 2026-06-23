import { AI_RECOGNITION_MAX_IMAGE_BYTES } from "@/lib/api/schemas/ai-recognition";

export const AI_RECOGNITION_IMAGE_SOFT_BYTES = 2 * 1024 * 1024;
export const AI_RECOGNITION_IMAGE_TOTAL_SOFT_BYTES = 10 * 1024 * 1024;
export const AI_RECOGNITION_IMAGE_MAX_EDGE = 2048;
const AI_RECOGNITION_IMAGE_QUALITY_STEPS = [0.92, 0.9, 0.88, 0.86] as const;
const AI_RECOGNITION_OUTPUT_MIME_FALLBACKS = ["image/webp", "image/jpeg", "image/png"] as const;

export type AIRecognitionImagePreprocessWarning = "large-after-optimization" | "passthrough";
export type AIRecognitionImagePreprocessErrorCode = "too-large" | "unsupported";

export class AIRecognitionImagePreprocessError extends Error {
  constructor(readonly code: AIRecognitionImagePreprocessErrorCode) {
    super(code);
    this.name = "AIRecognitionImagePreprocessError";
  }
}

interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close: () => void;
}

export interface AIRecognitionImagePreprocessPlatform {
  decode: (file: File, signal?: AbortSignal) => Promise<DecodedImage>;
  encode: (input: {
    source: CanvasImageSource;
    width: number;
    height: number;
    mimeType: string;
    quality: number;
    signal?: AbortSignal;
  }) => Promise<Blob>;
}

export interface PreparedAIRecognitionImage {
  file: File;
  originalSizeBytes: number;
  targetSizeBytes: number;
  optimized: boolean;
  warning: AIRecognitionImagePreprocessWarning | null;
}

interface PrepareAIRecognitionImageOptions {
  targetBytes: number;
  maxBytes?: number;
  maxEdge?: number;
  signal?: AbortSignal;
  platform?: AIRecognitionImagePreprocessPlatform;
}

interface EncodedCandidate {
  blob: Blob;
  mimeType: string;
  quality: number;
}

export function aiRecognitionImageTargetBytes(finalImageCount: number): number {
  const count = Math.max(1, finalImageCount);
  return Math.min(AI_RECOGNITION_IMAGE_SOFT_BYTES, Math.floor(AI_RECOGNITION_IMAGE_TOTAL_SOFT_BYTES / count));
}

export async function prepareAIRecognitionImage(
  file: File,
  options: PrepareAIRecognitionImageOptions,
): Promise<PreparedAIRecognitionImage> {
  const maxBytes = options.maxBytes ?? AI_RECOGNITION_MAX_IMAGE_BYTES;
  const targetBytes = Math.min(Math.max(1, options.targetBytes), maxBytes);
  const maxEdge = options.maxEdge ?? AI_RECOGNITION_IMAGE_MAX_EDGE;
  const platform = options.platform ?? browserAIRecognitionImagePreprocessPlatform;
  assertNotAborted(options.signal);

  if (file.size > maxBytes) {
    throw new AIRecognitionImagePreprocessError("too-large");
  }

  let decoded: DecodedImage;
  try {
    decoded = await platform.decode(file, options.signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    // 解码能力是浏览器差异最大的环节；后端 5MB 硬线仍兜底，前端失败时只降级为原图上传。
    return originalImageResult(file, targetBytes, file.size > targetBytes ? "passthrough" : null);
  }

  try {
    const size = fitImageSize(decoded.width, decoded.height, maxEdge);
    if (!size.resized && file.size <= targetBytes) {
      return originalImageResult(file, targetBytes, null);
    }

    const candidates = await encodeCandidates(file, decoded.source, size.width, size.height, platform, options.signal);
    const underTarget = candidates.find((candidate) => candidate.blob.size <= targetBytes && candidate.blob.size < file.size);
    if (underTarget) {
      return encodedImageResult(file, underTarget, targetBytes, false);
    }

    const underHardLimit = candidates
      .filter((candidate) => candidate.blob.size <= maxBytes && candidate.blob.size < file.size)
      .sort((left, right) => left.blob.size - right.blob.size)[0];
    if (underHardLimit) {
      return encodedImageResult(file, underHardLimit, targetBytes, true);
    }

    return originalImageResult(file, targetBytes, file.size > targetBytes ? "large-after-optimization" : null);
  } finally {
    decoded.close();
  }
}

function originalImageResult(
  file: File,
  targetSizeBytes: number,
  warning: AIRecognitionImagePreprocessWarning | null,
): PreparedAIRecognitionImage {
  return {
    file,
    originalSizeBytes: file.size,
    targetSizeBytes,
    optimized: false,
    warning,
  };
}

function encodedImageResult(
  sourceFile: File,
  candidate: EncodedCandidate,
  targetSizeBytes: number,
  largeAfterOptimization: boolean,
): PreparedAIRecognitionImage {
  const outputFile = new File([candidate.blob], imageFilenameForMime(sourceFile.name, candidate.mimeType), {
    type: candidate.mimeType,
    lastModified: sourceFile.lastModified,
  });
  return {
    file: outputFile,
    originalSizeBytes: sourceFile.size,
    targetSizeBytes,
    optimized: true,
    warning: largeAfterOptimization ? "large-after-optimization" : null,
  };
}

async function encodeCandidates(
  file: File,
  source: CanvasImageSource,
  width: number,
  height: number,
  platform: AIRecognitionImagePreprocessPlatform,
  signal?: AbortSignal,
): Promise<EncodedCandidate[]> {
  const mimeTypes = preferredOutputMimeTypes(file.type);
  const candidates: EncodedCandidate[] = [];
  for (const mimeType of mimeTypes) {
    for (const quality of AI_RECOGNITION_IMAGE_QUALITY_STEPS) {
      assertNotAborted(signal);
      const blob = await platform.encode({
        source,
        width,
        height,
        mimeType,
        quality,
        ...(signal ? { signal } : {}),
      });
      const actualMimeType = normalizedOutputMime(blob.type) ?? mimeType;
      candidates.push({ blob, mimeType: actualMimeType, quality });
    }
  }
  return candidates.sort((left, right) => right.quality - left.quality || left.blob.size - right.blob.size);
}

function preferredOutputMimeTypes(inputMimeType: string): string[] {
  const normalized = normalizedOutputMime(inputMimeType);
  const preferred = normalized === "image/jpeg"
    ? ["image/jpeg"]
    : normalized === "image/webp"
      ? ["image/webp", "image/jpeg"]
      : ["image/webp", "image/jpeg", "image/png"];
  return [...new Set([...preferred, ...AI_RECOGNITION_OUTPUT_MIME_FALLBACKS])];
}

function normalizedOutputMime(value: string): string | null {
  const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp" ? normalized : null;
}

function imageFilenameForMime(filename: string, mimeType: string): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const stem = filename.trim().replace(/\.[^.]*$/, "") || "image";
  return `${stem}.${extension}`;
}

function fitImageSize(width: number, height: number, maxEdge: number): { width: number; height: number; resized: boolean } {
  const sourceWidth = Math.max(1, Math.round(width));
  const sourceHeight = Math.max(1, Math.round(height));
  const edge = Math.max(sourceWidth, sourceHeight);
  if (edge <= maxEdge) return { width: sourceWidth, height: sourceHeight, resized: false };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    resized: true,
  };
}

const browserAIRecognitionImagePreprocessPlatform: AIRecognitionImagePreprocessPlatform = {
  async decode(file, signal) {
    assertNotAborted(signal);
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      assertNotAborted(signal);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      throw new AIRecognitionImagePreprocessError("unsupported");
    }
    return await decodeWithImageElement(file, signal);
  },

  async encode({ source, width, height, mimeType, quality, signal }) {
    assertNotAborted(signal);
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new AIRecognitionImagePreprocessError("unsupported");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: mimeType, quality });
      assertNotAborted(signal);
      return blob;
    }
    if (typeof document === "undefined") {
      throw new AIRecognitionImagePreprocessError("unsupported");
    }
    return await encodeWithCanvasElement(source, width, height, mimeType, quality, signal);
  },
};

async function decodeWithImageElement(file: File, signal?: AbortSignal): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  const cleanup = () => URL.revokeObjectURL(objectUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(createAbortError());
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      image.onerror = () => {
        signal?.removeEventListener("abort", abort);
        reject(new AIRecognitionImagePreprocessError("unsupported"));
      };
      image.src = objectUrl;
    });
    assertNotAborted(signal);
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      source: image,
      close: cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function encodeWithCanvasElement(
  source: CanvasImageSource,
  width: number,
  height: number,
  mimeType: string,
  quality: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new AIRecognitionImagePreprocessError("unsupported");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal?.addEventListener("abort", abort, { once: true });
    canvas.toBlob((blob) => {
      signal?.removeEventListener("abort", abort);
      if (!blob) {
        reject(new AIRecognitionImagePreprocessError("unsupported"));
        return;
      }
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

export function isAIRecognitionImageAbort(error: unknown): boolean {
  return isAbortError(error);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError");
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Image preprocessing cancelled", "AbortError");
  const error = new Error("Image preprocessing cancelled");
  error.name = "AbortError";
  return error;
}
