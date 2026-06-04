import { pb } from "@/lib/pocketbase";
import { readCloudflareSession, writeCloudflareSession } from "@/services/cloudflare-session";
import { isCloudflareRuntime } from "@/services/runtime";

function currentSessionToken(): string {
  return isCloudflareRuntime ? (readCloudflareSession()?.session.id ?? "") : pb.authStore.token;
}

function isUnauthorizedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 401);
}

export function clearAuthSession(token?: string | null) {
  const currentToken = currentSessionToken();
  if (token && currentToken && currentToken !== token) return;

  if (isCloudflareRuntime) {
    writeCloudflareSession(null);
    return;
  }
  pb.authStore.clear();
}

export async function withPocketBaseAuthGuard<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isUnauthorizedError(error)) {
      clearAuthSession();
    }
    throw error;
  }
}
