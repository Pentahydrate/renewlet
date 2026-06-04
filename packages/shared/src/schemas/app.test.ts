import { describe, expect, it } from "vitest";
import { systemVersionResponseSchema } from "./app";

const baseVersionResponse = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  hasUpdate: true,
  checkSucceeded: true,
  deployment: "docker",
  updateMode: "in-app-binary",
  updateSupported: true,
  releaseInfo: null,
  cached: false,
  build: {
    version: "1.0.0",
    commit: "abc",
    buildTime: "2026-05-26T00:00:00Z",
    buildType: "release",
  },
};

describe("system app schemas", () => {
  it("accepts the Docker in-app update capability response", () => {
    expect(systemVersionResponseSchema.parse(baseVersionResponse).updateMode).toBe("in-app-binary");
  });

  it("accepts Cloudflare deploy-only version responses", () => {
    const parsed = systemVersionResponseSchema.parse({
      ...baseVersionResponse,
      deployment: "cloudflare",
      updateMode: "cloudflare-deploy",
      updateSupported: false,
      unsupportedReason: "Cloudflare deployments do not support in-app updates.",
      build: {
        ...baseVersionResponse.build,
        buildType: "cloudflare",
      },
    });

    expect(parsed.deployment).toBe("cloudflare");
    expect(parsed.updateSupported).toBe(false);
  });

  it("accepts release info with an empty assets array", () => {
    const parsed = systemVersionResponseSchema.parse({
      ...baseVersionResponse,
      releaseInfo: {
        tagName: "v1.1.0",
        version: "1.1.0",
        name: "Renewlet 1.1.0",
        body: "",
        publishedAt: "2026-05-26T00:00:00Z",
        htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0",
        assets: [],
      },
    });

    expect(parsed.releaseInfo?.assets).toEqual([]);
  });

  it("rejects release info with null assets", () => {
    const result = systemVersionResponseSchema.safeParse({
      ...baseVersionResponse,
      releaseInfo: {
        tagName: "v1.1.0",
        version: "1.1.0",
        name: "Renewlet 1.1.0",
        body: "",
        publishedAt: "2026-05-26T00:00:00Z",
        htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0",
        assets: null,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects the old runtime field after the deployment contract switch", () => {
    const result = systemVersionResponseSchema.safeParse({
      ...baseVersionResponse,
      runtime: "docker",
    });

    expect(result.success).toBe(false);
  });
});
