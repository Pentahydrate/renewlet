// Worker 系统更新测试保护 Cloudflare 只读升级契约，避免前端误暴露 Docker 页面内更新入口。
import rootPackageJson from "../../../package.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemRestart, systemUpdate, systemVersion } from "./system";
import type { Env } from "./types";

vi.mock("./auth", () => ({
  requireAdmin: vi.fn(async () => ({
    token: "session-token",
    user: { id: "usr_admin", email: "admin@example.com", name: "Admin", role: "admin", banned: 0 },
  })),
}));

describe("Cloudflare system update contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns deploy-only version capability", async () => {
    mockLatestRelease("1.2.3");

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), envFixture());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      deployment: "cloudflare",
      updateMode: "cloudflare-deploy",
      updateSupported: false,
      checkSucceeded: true,
      hasUpdate: false,
      build: {
        version: "1.2.3",
        commit: "504c1681822ac60f0caafdb0b1ba731853c9169d",
        buildType: "cloudflare",
      },
    });
    expect(body["releaseInfo"]).toMatchObject({
      tagName: "v1.2.3",
      version: "1.2.3",
      htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.2.3",
      assets: [],
    });
    expect(body).not.toHaveProperty("runtime");
  });

  it("treats deploy button builds without metadata as the package stable version", async () => {
    mockLatestRelease(rootPackageJson.version);

    const env = envFixture();
    delete env.RENEWLET_VERSION;
    delete env.RENEWLET_COMMIT;

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: rootPackageJson.version,
      latestVersion: rootPackageJson.version,
      checkSucceeded: true,
      hasUpdate: false,
      deployment: "cloudflare",
      build: {
        version: rootPackageJson.version,
        commit: "",
        buildType: "cloudflare",
      },
    });
    expect(body["releaseInfo"]).toMatchObject({
      tagName: `v${rootPackageJson.version}`,
      version: rootPackageJson.version,
    });
  });

  it("does not expose placeholder dev versions to deploy button users", async () => {
    mockLatestRelease(rootPackageJson.version);

    const env = envFixture({
      RENEWLET_VERSION: "0.0.0-dev",
      RENEWLET_COMMIT: "504c1681822ac60f0caafdb0b1ba731853c9169d",
    });

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: rootPackageJson.version,
      latestVersion: rootPackageJson.version,
      checkSucceeded: true,
      hasUpdate: false,
      deployment: "cloudflare",
      build: {
        version: rootPackageJson.version,
        commit: "504c1681822ac60f0caafdb0b1ba731853c9169d",
        buildType: "cloudflare",
      },
    });
    expect(String(body["currentVersion"])).not.toContain("-dev");
  });

  it("falls back to the stable package version when dev suffixes lack commit metadata", async () => {
    mockLatestRelease(rootPackageJson.version);

    const env = envFixture({
      RENEWLET_VERSION: `${rootPackageJson.version}-dev`,
      RENEWLET_COMMIT: "",
    });

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: rootPackageJson.version,
      latestVersion: rootPackageJson.version,
      checkSucceeded: true,
      hasUpdate: false,
      deployment: "cloudflare",
      build: {
        version: rootPackageJson.version,
        commit: "",
        buildType: "cloudflare",
      },
    });
  });

  it("keeps explicit branch deploy versions with commit metadata", async () => {
    mockLatestRelease(rootPackageJson.version);

    const env = envFixture({
      RENEWLET_VERSION: `${rootPackageJson.version}-dev+504c168`,
      RENEWLET_COMMIT: "504c1681822ac60f0caafdb0b1ba731853c9169d",
    });

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const expectedVersion = `${rootPackageJson.version}-dev+504c168`;
    expect(body).toMatchObject({
      currentVersion: expectedVersion,
      latestVersion: rootPackageJson.version,
      checkSucceeded: true,
      hasUpdate: false,
      deployment: "cloudflare",
      releaseInfo: null,
      build: {
        version: expectedVersion,
        commit: "504c1681822ac60f0caafdb0b1ba731853c9169d",
        buildType: "cloudflare",
      },
    });
  });

  it("reports a newer stable release without enabling executable updates", async () => {
    mockLatestRelease("0.1.1");
    const env = envFixture({
      RENEWLET_VERSION: "0.1.0-dev+d0059b5",
      RENEWLET_COMMIT: "d0059b51822ac60f0caafdb0b1ba731853c9169d",
    });

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: "0.1.0-dev+d0059b5",
      latestVersion: "0.1.1",
      checkSucceeded: true,
      hasUpdate: true,
      updateMode: "cloudflare-deploy",
      updateSupported: false,
      releaseInfo: {
        tagName: "v0.1.1",
        version: "0.1.1",
        htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v0.1.1",
      },
    });
  });

  it("keeps the dialog usable when GitHub release checks fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited github-secret", { status: 403 })));

    const env = envFixture();
    env.RENEWLET_GITHUB_TOKEN = "github-secret";
    delete env.RENEWLET_VERSION;
    delete env.RENEWLET_COMMIT;

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: rootPackageJson.version,
      latestVersion: rootPackageJson.version,
      checkSucceeded: false,
      hasUpdate: false,
      deployment: "cloudflare",
      releaseInfo: null,
      warning: "GitHub Releases cannot be fetched right now. Try again later.",
      build: {
        version: rootPackageJson.version,
        commit: "",
        buildType: "cloudflare",
      },
      errorDetails: {
        rawResponseText: "rate limited [redacted]",
      },
    });
    expect(JSON.stringify(body)).not.toContain("github-secret");
  });

  it("rejects executable updates in the Worker runtime", async () => {
    await expect(systemUpdate(new Request("https://renewlet.example/api/app/admin/system/update", {
      headers: { "accept-language": "en-US" },
      method: "POST",
    }), envFixture())).rejects.toMatchObject({
      status: 400,
      code: "SYSTEM_UPDATE_UNSUPPORTED",
    });
  });

  it("rejects executable restarts in the Worker runtime with a restart-specific code", async () => {
    await expect(systemRestart(new Request("https://renewlet.example/api/app/admin/system/restart", {
      headers: { "accept-language": "en-US" },
      method: "POST",
    }), envFixture())).rejects.toMatchObject({
      status: 400,
      code: "SYSTEM_RESTART_UNSUPPORTED",
    });
  });
});

function envFixture(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ASSETS_BUCKET: {} as R2Bucket,
    RENEWLET_VERSION: "1.2.3",
    RENEWLET_COMMIT: "504c1681822ac60f0caafdb0b1ba731853c9169d",
    RENEWLET_BUILD_TIME: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

function mockLatestRelease(version: string) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    tag_name: `v${version}`,
    name: `Renewlet ${version}`,
    body: "",
    published_at: "2026-06-02T00:00:00Z",
    html_url: `https://github.com/zhiyingzzhou/renewlet/releases/tag/v${version}`,
    prerelease: false,
    draft: false,
    assets: [],
  })));
}
