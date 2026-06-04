// PocketBase 认证测试保护本地 authStore 只作为待验证凭据，避免数据重置后旧 token 继续放行私有页面。
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authRefresh: vi.fn(),
  authStoreClear: vi.fn(),
  authStoreOnChange: vi.fn(),
  authStoreSave: vi.fn(),
  authWithPassword: vi.fn(),
  pb: {
    authStore: {
      isValid: true,
      record: {
        id: "user-1",
        email: "alice@example.com",
        name: "Alice",
        role: "admin",
        banned: false,
      } as Record<string, unknown> | null,
      token: "token-1",
      onChange: vi.fn(),
      clear: vi.fn(),
      save: vi.fn(),
    },
    collection: vi.fn(),
  },
}));

vi.mock("@/services/runtime", () => ({
  renewletRuntime: "pocketbase",
  isCloudflareRuntime: false,
}));

vi.mock("@/lib/pocketbase", () => ({
  pb: mocks.pb,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

function useTwoSessions(authClient: typeof import("./auth-client").authClient) {
  const first = authClient.useSession();
  const second = authClient.useSession();
  return { first, second };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("authClient.useSession for PocketBase", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.authRefresh.mockReset();
    mocks.authStoreClear.mockReset();
    mocks.authStoreOnChange.mockReset();
    mocks.authStoreSave.mockReset();
    mocks.authWithPassword.mockReset();
    mocks.pb.authStore.isValid = true;
    mocks.pb.authStore.record = {
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
      role: "admin",
      banned: false,
    };
    mocks.pb.authStore.token = "token-1";
    mocks.pb.authStore.onChange = mocks.authStoreOnChange;
    mocks.pb.authStore.clear = mocks.authStoreClear;
    mocks.pb.authStore.save = mocks.authStoreSave.mockImplementation((token: string, record: Record<string, unknown> | null) => {
      mocks.pb.authStore.token = token;
      mocks.pb.authStore.record = record;
    });
    mocks.pb.collection.mockImplementation((name: string) => {
      if (name !== "users") throw new Error(`Unexpected collection ${name}`);
      return {
        authRefresh: mocks.authRefresh,
        authWithPassword: mocks.authWithPassword,
      };
    });
  });

  it("keeps restored authStore pending until authRefresh confirms the token", async () => {
    const deferred = createDeferred();
    mocks.authRefresh.mockReturnValue(deferred.promise);
    mocks.authStoreOnChange.mockImplementation((listener: () => void) => {
      listener();
      return vi.fn();
    });
    const { authClient } = await import("./auth-client");

    const { result } = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    expect(result.current.data).toBeNull();
    expect(result.current.isPending).toBe(true);
    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
      expect(result.current.data?.session.id).toBe("token-1");
    });
  });

  it("deduplicates simultaneous PocketBase authRefresh consumers", async () => {
    const deferred = createDeferred();
    mocks.authRefresh.mockReturnValue(deferred.promise);
    mocks.authStoreOnChange.mockImplementation((listener: () => void) => {
      listener();
      return vi.fn();
    });
    const { authClient } = await import("./auth-client");

    const { result } = renderHook(() => useTwoSessions(authClient), { wrapper: createWrapper() });

    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);
    deferred.resolve();

    await waitFor(() => {
      expect(result.current.first.isPending).toBe(false);
      expect(result.current.second.isPending).toBe(false);
    });
    expect(result.current.first.data?.user.email).toBe("alice@example.com");
    expect(result.current.second.data?.user.email).toBe("alice@example.com");
  });

  it("treats the token returned by authRefresh as the verified session token", async () => {
    mocks.authRefresh.mockImplementation(() => {
      mocks.pb.authStore.token = "token-2";
      return Promise.resolve();
    });
    mocks.authStoreOnChange.mockImplementation((listener: () => void) => {
      listener();
      listener();
      return vi.fn();
    });
    const { authClient } = await import("./auth-client");

    const { result } = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
      expect(result.current.data?.session.id).toBe("token-2");
    });
    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);
  });

  it("clears stale PocketBase authStore when authRefresh fails", async () => {
    mocks.authRefresh.mockRejectedValue(new Error("missing user"));
    mocks.authStoreOnChange.mockImplementation((listener: () => void) => {
      listener();
      return vi.fn();
    });
    const { authClient } = await import("./auth-client");

    const { result } = renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.data).toBeNull();
    expect(mocks.authStoreClear).toHaveBeenCalledTimes(1);
  });

  it("does not let an older authRefresh overwrite a newer password login", async () => {
    const deferred = createDeferred();
    mocks.authRefresh.mockImplementation(() => deferred.promise.then(() => {
      mocks.pb.authStore.token = "token-1-refreshed";
    }));
    mocks.authWithPassword.mockImplementation(() => {
      mocks.pb.authStore.token = "token-login";
      return Promise.resolve();
    });
    mocks.authStoreOnChange.mockImplementation((listener: () => void) => {
      listener();
      return vi.fn();
    });
    const { authClient } = await import("./auth-client");
    renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    await authClient.signIn.email({ email: "alice@example.com", password: "password123" });
    deferred.resolve();

    await waitFor(() => {
      expect(mocks.authStoreSave).toHaveBeenCalledWith("token-login", expect.objectContaining({ id: "user-1" }));
    });
    expect(mocks.pb.authStore.token).toBe("token-login");
    expect(mocks.authStoreClear).not.toHaveBeenCalled();
  });

  it("does not restore an older authRefresh after sign out", async () => {
    const deferred = createDeferred();
    mocks.authRefresh.mockImplementation(() => deferred.promise.then(() => {
      mocks.pb.authStore.token = "token-1-refreshed";
    }));
    mocks.authStoreOnChange.mockImplementation((listener: () => void) => {
      listener();
      return vi.fn();
    });
    const { authClient } = await import("./auth-client");
    renderHook(() => authClient.useSession(), { wrapper: createWrapper() });

    await authClient.signOut();
    deferred.resolve();

    await waitFor(() => {
      expect(mocks.authStoreClear).toHaveBeenCalledTimes(2);
    });
    expect(mocks.authStoreSave).not.toHaveBeenCalled();
  });

  it("marks password login as verified immediately", async () => {
    mocks.authStoreOnChange.mockImplementation((_listener: () => void) => vi.fn());
    mocks.authWithPassword.mockResolvedValue(undefined);
    const { authClient } = await import("./auth-client");

    await expect(authClient.signIn.email({ email: "alice@example.com", password: "password123" })).resolves.toMatchObject({
      data: {
        session: { id: "token-1" },
      },
      error: null,
    });
    expect(mocks.authWithPassword).toHaveBeenCalledWith("alice@example.com", "password123");
  });
});
