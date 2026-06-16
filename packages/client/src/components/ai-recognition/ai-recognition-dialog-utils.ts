import type { RefObject } from "react";
import type { AiThinkingControl } from "@/lib/api/schemas/ai-recognition";
import { IMPORT_MESSAGE_CODES } from "@/modules/import-export/domain/import-export-model";
import { thinkingOptionId } from "@/modules/ai-recognition/domain/model-capabilities";
import type { AIRecognitionImageItem } from "./ai-recognition-dialog-types";

const AI_BLOCKING_IMPORT_WARNING_CODES = new Set<string>([
  IMPORT_MESSAGE_CODES.aiBillingCycleDefaulted,
  IMPORT_MESSAGE_CODES.aiCurrencyDefaulted,
  IMPORT_MESSAGE_CODES.aiCustomCycleDefaulted,
  IMPORT_MESSAGE_CODES.aiDateDefaulted,
  IMPORT_MESSAGE_CODES.aiPriceDefaulted,
]);

// thinking 控件的选项 id 由领域层生成，避免 UI 组件把 provider/model 差异硬编码到表单状态里。
export function thinkingOptionIdOrNull(control: AiThinkingControl | null): string | null {
  return control ? thinkingOptionId(control) : null;
}

export function nextImageId(ref: RefObject<number>): string {
  ref.current += 1;
  return `ai-image-${ref.current}`;
}

export function nextDraftId(ref: RefObject<number>): string {
  ref.current += 1;
  return `ai-draft-${ref.current}`;
}

export function createObjectUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

export function revokeImageItem(image: AIRecognitionImageItem) {
  if (image.thumbnailUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(image.thumbnailUrl);
  }
}

export function revokeImageItems(images: readonly AIRecognitionImageItem[]) {
  for (const image of images) revokeImageItem(image);
}

export function appendLimitedText(current: string, delta: string, maxChars: number): string {
  const next = `${current}${delta}`;
  const chars = [...next];
  // SSE 文本预览保留尾部窗口即可排障，不能把 provider 的完整输出长期堆在 React 状态里。
  if (chars.length <= maxChars) return next;
  return `...${chars.slice(chars.length - maxChars).join("")}`;
}

export function recognitionElapsedSeconds(startedAt: number): number {
  return Math.max(1, Math.ceil((performance.now() - startedAt) / 1000));
}

export function isAbortedApiError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "aborted",
  );
}

export function hasBlockingAIImportWarnings(warnings: readonly string[]): boolean {
  // 导入 preview 的 warning 可能按 “多 code 合并” 返回；AI 入口只拦截会改变核心账单字段的默认值。
  return warnings.some((warning) => (
    warning.split("|").some((part) => AI_BLOCKING_IMPORT_WARNING_CODES.has(part))
  ));
}
