import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthSession, withPocketBaseAuthGuard } from "./auth-session";

const mocks = vi.hoisted(() => ({
  authStoreClear: vi.fn(),
  pb: {
    authStore: {
      token: "token-1",
      clear: vi.fn(),
    },
  },
}));

vi.mock("@/services/runtime", () => ({
  renewletRuntime: "pocketbase",
  isCloudflareRuntime: false,
}));

vi.mock("@/lib/pocketbase", () => ({
  pb: mocks.pb,
}));

describe("auth-session helpers", () => {
  beforeEach(() => {
    mocks.authStoreClear.mockReset();
    mocks.pb.authStore.clear = mocks.authStoreClear;
    mocks.pb.authStore.token = "token-1";
  });

  it("does not clear a newer token when an older validation fails", () => {
    clearAuthSession("old-token");

    expect(mocks.authStoreClear).not.toHaveBeenCalled();
  });

  it("clears PocketBase authStore on guarded 401 errors and rethrows the original error", async () => {
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });

    await expect(withPocketBaseAuthGuard(Promise.reject(error))).rejects.toBe(error);

    expect(mocks.authStoreClear).toHaveBeenCalledTimes(1);
  });

  it("does not clear PocketBase authStore on non-auth errors", async () => {
    const error = Object.assign(new Error("Bad request"), { status: 400 });

    await expect(withPocketBaseAuthGuard(Promise.reject(error))).rejects.toBe(error);

    expect(mocks.authStoreClear).not.toHaveBeenCalled();
  });
});
