import {
  createRawErrorResponseDetails,
  type RawErrorResponseDetails,
} from "@/lib/raw-error-response";

export type CloudBackupErrorDetailsView = RawErrorResponseDetails;

export function extractCloudBackupErrorDetails(error: unknown): CloudBackupErrorDetailsView | null {
  return createRawErrorResponseDetails(error);
}

export function createCloudBackupErrorDetails(error: unknown, fallbackMessage: string): CloudBackupErrorDetailsView {
  return createRawErrorResponseDetails(error, fallbackMessage);
}

export function cloudBackupErrorRawResponseText(details: CloudBackupErrorDetailsView | null): string {
  return details?.responseText || "";
}
