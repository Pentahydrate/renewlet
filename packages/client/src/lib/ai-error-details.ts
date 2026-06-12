import {
  createRawErrorResponseDetails,
  type RawErrorResponseDetails,
} from "@/lib/raw-error-response";

export type AIErrorDetails = RawErrorResponseDetails;

export function extractAIErrorDetails(error: unknown): AIErrorDetails | null {
  return createRawErrorResponseDetails(error);
}

export function createAIErrorDetails(error: unknown, fallbackMessage: string): AIErrorDetails {
  return createRawErrorResponseDetails(error, fallbackMessage);
}

export function aiErrorRawResponseText(details: AIErrorDetails | null): string {
  return details?.responseText || "";
}
