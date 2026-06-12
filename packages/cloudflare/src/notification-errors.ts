import type { UpstreamErrorDetails } from "@renewlet/shared/schemas/upstream";

export class NotificationChannelError extends Error {
  constructor(message: string, readonly details?: UpstreamErrorDetails) {
    super(message);
    this.name = "NotificationChannelError";
  }
}

export function notificationChannelErrorDetails(error: unknown): UpstreamErrorDetails | undefined {
  return error instanceof NotificationChannelError ? error.details : undefined;
}
