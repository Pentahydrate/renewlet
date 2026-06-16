// Worker 认证测试保护账号生命周期边界；D1 细节用 mock 固定，测试只关心 route 安全决策。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminPatchUser, appStatus } from "./auth";
import type { Env, UserRow } from "./types";

const mocks = vi.hoisted(() => ({
  enabledAdminCount: vi.fn(),
  findUserById: vi.fn(),
  hashPassword: vi.fn(),
  nowIso: vi.fn(),
  sha256: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    enabledAdminCount: mocks.enabledAdminCount,
    findUserById: mocks.findUserById,
    nowIso: mocks.nowIso,
  };
});

vi.mock("./crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crypto")>();
  return {
    ...actual,
    hashPassword: mocks.hashPassword,
    sha256: mocks.sha256,
  };
});

describe("Cloudflare admin password reset boundary", () => {
  beforeEach(() => {
    mocks.enabledAdminCount.mockReset().mockResolvedValue(2);
    mocks.findUserById.mockReset();
    mocks.hashPassword.mockReset().mockResolvedValue("hashed-new-password");
    mocks.nowIso.mockReset().mockReturnValue("2026-06-03T00:00:00.000Z");
    mocks.sha256.mockReset().mockResolvedValue("token-hash");
  });

  it("rejects resetting the current admin through admin patch", async () => {
    const updateRun = vi.fn();
    mocks.findUserById.mockResolvedValue(userRow({ id: "usr_admin", role: "admin" }));

    await expect(adminPatchUser(requestFixture({ newPassword: "newpassword123" }), envFixture(updateRun), "usr_admin"))
      .rejects.toMatchObject({
        status: 400,
        message: "Use the change password flow to update the current account password",
      });

    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
  });

  it("keeps admin reset available for other users", async () => {
    const updateRun = vi.fn().mockResolvedValue({});
    mocks.findUserById.mockResolvedValue(userRow({ id: "usr_user", role: "user" }));

    const response = await adminPatchUser(requestFixture({ newPassword: "newpassword123" }), envFixture(updateRun), "usr_user");

    expect(response.status).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith("newpassword123");
    expect(updateRun).toHaveBeenCalledTimes(1);
  });
});

describe("Cloudflare app status", () => {
  beforeEach(() => {
    mocks.enabledAdminCount.mockReset().mockResolvedValue(0);
  });

  it("returns setup capability with demo mode fixed off", async () => {
    const response = await appStatus(new Request("https://renewlet.example/api/app/status"), envFixture(vi.fn()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      setupRequired: true,
      setupEnabled: true,
      demoMode: false,
    });
  });
});

function requestFixture(body: unknown): Request {
  return new Request("https://renewlet.example/api/app/admin/users/usr_user", {
    method: "PATCH",
    headers: {
      "accept-language": "en-US",
      "authorization": "Bearer session-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function envFixture(updateRun: ReturnType<typeof vi.fn>): Env {
  const sessionTouchRun = vi.fn().mockResolvedValue({});
  return {
    DB: {
      prepare: vi.fn((sql: string) => ({
        first: vi.fn().mockResolvedValue(sql.includes("SELECT id FROM users") ? null : undefined),
        bind: vi.fn(() => {
          if (sql.includes("FROM sessions JOIN users")) {
            return { first: vi.fn().mockResolvedValue(authRow()) };
          }
          if (sql.includes("UPDATE sessions SET last_seen_at")) {
            return { run: sessionTouchRun };
          }
          return { run: updateRun };
        }),
      })),
    } as unknown as D1Database,
    ASSETS: {} as Fetcher,
    ASSETS_BUCKET: {} as R2Bucket,
  };
}

function authRow(): UserRow & {
  session_id: string;
  session_token_hash: string;
  session_user_id: string;
  session_expires_at: string;
  session_created_at: string;
  session_last_seen_at: string;
} {
  return {
    ...userRow({ id: "usr_admin", email: "admin@example.com", name: "Admin", role: "admin" }),
    session_id: "session-current",
    session_token_hash: "token-hash",
    session_user_id: "usr_admin",
    session_expires_at: "2026-07-03T00:00:00.000Z",
    session_created_at: "2026-06-03T00:00:00.000Z",
    session_last_seen_at: "2026-06-03T00:00:00.000Z",
  };
}

function userRow(overrides: Partial<UserRow>): UserRow {
  return {
    id: "usr_user",
    email: "user@example.com",
    name: "User",
    role: "user",
    banned: 0,
    ban_reason: "",
    password_hash: "old-hash",
    reset_token_hash: null,
    reset_token_expires_at: null,
    created_at: "2026-06-03T00:00:00.000Z",
    updated_at: "2026-06-03T00:00:00.000Z",
    ...overrides,
  };
}
