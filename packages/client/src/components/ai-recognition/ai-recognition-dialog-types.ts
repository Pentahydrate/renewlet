import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";

export type AIRecognitionInputMode = "text" | "image";

export interface AIRecognitionImageItem {
  id: string;
  file: File;
  // thumbnailUrl 是浏览器 object URL；弹层关闭和图片移除时必须显式 revoke，不能交给 GC 碰运气。
  thumbnailUrl: string | null;
  originalSizeBytes?: number;
  targetSizeBytes?: number;
  optimized?: boolean;
  optimizationWarning?: "large-after-optimization" | "passthrough" | null;
}

export interface AIDraftListItem {
  id: string;
  draft: AiRecognizedSubscriptionDraft;
}

export type AIDraftFilter = "all" | "warning" | "low-confidence" | "missing-core";
