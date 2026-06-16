// Worker 图标索引测试保护 D1 metadata、R2 gzip blob、provider 刷新锁和失败不切 active 的运行面契约。
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMediaCandidateItem } from "@renewlet/shared/media-resolver";
import type { BuiltInIconIndexProviderRefreshResponse, BuiltInIconIndexStatus } from "@renewlet/shared/schemas/media";
import {
  builtInIconIndexStatus,
  checkBuiltInIconIndexProvider,
  getActiveBuiltInMediaResolver,
  refreshBuiltInIconIndexProvider,
} from "./media-icon-index";
import type { Env, MediaIconIndexRow } from "./types";

vi.mock("./auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    user: { id: "usr_admin", role: "admin" },
  }),
}));

describe("Cloudflare media icon index", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns embedded provider statuses when no runtime index is active", async () => {
    const env = createEnv();
    const response = await builtInIconIndexStatus(requestFixture("GET"), env);

    expect(response.status).toBe(200);
    const body = await response.json() as BuiltInIconIndexStatus;
    expect(body).toMatchObject({ source: "embedded", refreshing: false });
    expectSeedProviderVersions(body);
  });

  it("checks one provider latest version with Atom ETag without switching active", async () => {
    const env = createEnv(mediaIconIndexRow({
      provider_status_json: JSON.stringify({
        thesvg: {
          latest: providerVersion("abc1234567890abcdef"),
          etag: "\"cached\"",
        },
      }),
    }));
    env.RENEWLET_VERSION = "1.2.3";
    const fetchMock = vi.fn(async () => new Response(null, { status: 304, headers: { etag: "\"cached\"" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await checkBuiltInIconIndexProvider(requestFixture("POST"), env, "thesvg");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        refreshing: false,
      },
      provider: {
        provider: "thesvg",
        refreshing: false,
        latest: { commitSha: "abc1234567890abcdef" },
      },
    });
    expect(env.testState.row?.hash).toBeNull();
    expect(env.testState.objects.size).toBe(0);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(String(calls[0]?.[0])).toBe("https://github.com/glincker/thesvg/commits/main.atom");
    const init = calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      accept: "application/atom+xml",
      "if-none-match": "\"cached\"",
      "user-agent": "Renewlet/1.2.3",
    });
  });

  it("records GitHub Atom failures as provider status without breaking check responses", async () => {
    const env = createEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("atom feed unavailable", { status: 429 })));

    const response = await checkBuiltInIconIndexProvider(requestFixture("POST"), env, "selfhst");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        source: "embedded",
        refreshing: false,
      },
      provider: {
        provider: "selfhst",
        refreshing: false,
        lastError: expect.stringContaining("GitHub commit feed HTTP 429"),
      },
      errorDetails: {
        rawResponseText: "atom feed unavailable",
      },
    });
    expect(env.testState.row?.hash).toBeNull();
    expect(env.testState.objects.size).toBe(0);
    expect(env.testState.row?.provider_status_json).not.toContain("atom feed unavailable");
  });

  it("refreshes one provider metadata and serves the runtime resolver from R2", async () => {
    const env = createEnv();
    stubRegistryFetch(registryFixtures());

    const response = await refreshBuiltInIconIndexProvider(requestFixture("POST"), env, "thesvg");

    expect(response.status).toBe(200);
    const body = await response.json() as BuiltInIconIndexProviderRefreshResponse;
    expect(body).toMatchObject({
      status: {
        source: "runtime",
        providerCounts: { thesvg: 1 },
        refreshing: false,
      },
      provider: {
        provider: "thesvg",
        iconCount: 1,
        refreshing: false,
        current: { commitSha: "abc1234567890abcdef" },
      },
    });
    expectSeedProviderVersions(body.status as BuiltInIconIndexStatus, ["thesvg"]);
    expect(env.testState.row?.search_r2_key).toMatch(/^system\/media-icon-index\/[a-f0-9]{64}\.search\.json\.gz$/);
    expect(env.testState.row?.detail_r2_key).toMatch(/^system\/media-icon-index\/[a-f0-9]{64}\.detail\.json\.gz$/);
    expect(env.testState.objects.size).toBe(2);

    const resolver = await getActiveBuiltInMediaResolver(env);
    const item = resolveMediaCandidateItem(
      resolver,
      "logo",
      "search",
      { id: "cf", name: "CF Registry" },
      4,
      {},
    );
    expect(item.candidates.builtIn[0]?.label).toBe("CF Registry");
  });

  it("rejects non-empty refresh bodies before acquiring the lock", async () => {
    const env = createEnv();

    await expect(refreshBuiltInIconIndexProvider(requestFixture("POST", "{}"), env, "thesvg")).rejects.toMatchObject({
      status: 400,
      code: "NON_EMPTY_BODY",
    });
    expect(env.testState.row).toBeNull();
  });

  it("keeps the previous active index when a provider refresh fails", async () => {
    const env = createEnv();
    stubRegistryFetch(registryFixtures());
    const success = await refreshBuiltInIconIndexProvider(requestFixture("POST"), env, "thesvg");
    expect(success.status).toBe(200);
    const activeHash = env.testState.row?.hash;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("failed", { status: 500 })));
    const failure = await refreshBuiltInIconIndexProvider(requestFixture("POST"), env, "thesvg");

    expect(failure.status).toBe(502);
    await expect(failure.json()).resolves.toMatchObject({
      status: {
        source: "runtime",
        hash: activeHash,
        refreshing: false,
      },
      provider: {
        provider: "thesvg",
        refreshing: false,
        lastError: expect.stringContaining("HTTP 500"),
      },
      errorDetails: {
        rawResponseText: "failed",
      },
    });
    expect(env.testState.row?.hash).toBe(activeHash);
    expect(env.testState.row?.provider_status_json).toContain("HTTP 500");
  });

  it("reports a locked provider refresh without changing active metadata", async () => {
    const env = createEnv(mediaIconIndexRow({
      locked_until: "2026-06-11T00:01:00.000Z",
    }));

    const response = await refreshBuiltInIconIndexProvider(requestFixture("POST"), env, "thesvg");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        refreshing: true,
      },
      provider: {
        provider: "thesvg",
        refreshing: true,
      },
    });
    expect(env.testState.objects.size).toBe(0);
  });
});

function expectSeedProviderVersions(status: BuiltInIconIndexStatus, skipProviders: string[] = []): void {
  for (const provider of status.providers) {
    if (skipProviders.includes(provider.provider)) continue;
    expect(provider.current?.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(provider.current?.commitShortSha).toMatch(/^[a-f0-9]{7}$/);
    expect(provider.current?.commitDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(provider.current?.sourceRef).not.toBe("embedded");
    expect(provider.current?.sourceRef).not.toBe("runtime");
  }
}

interface TestState {
  row: MediaIconIndexRow | null;
  objects: Map<string, Uint8Array>;
}

type TestEnv = Env & { testState: TestState };

function createEnv(row: MediaIconIndexRow | null = null): TestEnv {
  const state: TestState = {
    row,
    objects: new Map(),
  };

  return {
    DB: createD1(state),
    ASSETS: createStaticAssets(),
    ASSETS_BUCKET: createR2(state),
    testState: state,
  };
}

function createStaticAssets(): Fetcher {
  const assets = new Map<string, Uint8Array | string>([
    ["/built-in-icons/metadata.json", readFileSync(new URL("../../client/public/built-in-icons/metadata.json", import.meta.url), "utf8")],
    ["/built-in-icons/search-index.json.gz", readFileSync(new URL("../../client/public/built-in-icons/search-index.json.gz", import.meta.url))],
    ["/built-in-icons/detail-index.json.gz", readFileSync(new URL("../../client/public/built-in-icons/detail-index.json.gz", import.meta.url))],
  ]);
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const asset = assets.get(url.pathname);
      if (!asset) return new Response("not found", { status: 404 });
      if (typeof asset === "string") return new Response(asset, { status: 200 });
      const body = new ArrayBuffer(asset.byteLength);
      new Uint8Array(body).set(asset);
      return new Response(body, { status: 200 });
    },
  } as Fetcher;
}

function createD1(state: TestState): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes("SELECT * FROM media_icon_indexes")) return state.row;
          return null;
        },
        run: async () => {
          if (sql.includes("INSERT OR IGNORE INTO media_icon_indexes")) {
            if (!state.row) {
              state.row = mediaIconIndexRow({
                provider_counts_json: "{}",
                provider_status_json: "{}",
                created_at: stringArg(args, 1),
                updated_at: stringArg(args, 2),
              });
              return d1Result(1);
            }
            return d1Result(0);
          }
          if (sql.includes("SET locked_until = ?")) {
            const now = stringArg(args, 3);
            if (!state.row?.locked_until || state.row.locked_until <= now) {
              state.row = { ...mediaIconIndexRow(state.row ?? {}), locked_until: stringArg(args, 0), updated_at: stringArg(args, 1) };
              return d1Result(1);
            }
            return d1Result(0);
          }
          if (sql.includes("SET locked_until = NULL")) {
            if (state.row) state.row = { ...state.row, locked_until: null, updated_at: stringArg(args, 0) };
            return d1Result(1);
          }
          if (sql.includes("SET hash = ?")) {
            state.row = {
              ...mediaIconIndexRow(state.row ?? {}),
              hash: stringArg(args, 0),
              search_r2_key: stringArg(args, 1),
              detail_r2_key: stringArg(args, 2),
              icon_count: numberArg(args, 3),
              provider_counts_json: stringArg(args, 4),
              provider_status_json: stringArg(args, 5),
              checked_at: stringArg(args, 6),
              index_updated_at: stringArg(args, 7),
              updated_at: stringArg(args, 8),
            };
            return d1Result(1);
          }
          if (sql.includes("SET checked_at = ?, provider_status_json = ?")) {
            state.row = {
              ...mediaIconIndexRow(state.row ?? {}),
              checked_at: stringArg(args, 0),
              provider_status_json: stringArg(args, 1),
              updated_at: stringArg(args, 2),
            };
            return d1Result(1);
          }
          return d1Result(0);
        },
      }),
    }),
  } as unknown as D1Database;
}

function createR2(state: TestState): R2Bucket {
  return {
    get: async (key: string) => {
      const bytes = state.objects.get(key);
      if (!bytes) return null;
      return {
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
    put: async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob) => {
      state.objects.set(key, await bodyToBytes(value));
      return null;
    },
  } as unknown as R2Bucket;
}

async function bodyToBytes(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    const buffer = new ArrayBuffer(value.byteLength);
    new Uint8Array(buffer).set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return new Uint8Array(buffer);
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function d1Result(changes: number): D1Result {
  return { meta: { changes } } as D1Result;
}

function mediaIconIndexRow(overrides: Partial<MediaIconIndexRow>): MediaIconIndexRow {
  return {
    key: "active",
    hash: null,
    search_r2_key: null,
    detail_r2_key: null,
    icon_count: 0,
    provider_counts_json: "{}",
    provider_status_json: "{}",
    checked_at: null,
    index_updated_at: null,
    locked_until: null,
    created_at: "2026-06-11T00:00:00.000Z",
    updated_at: "2026-06-11T00:00:00.000Z",
    ...overrides,
  };
}

function requestFixture(method: string, body?: string): Request {
  const headers: HeadersInit = {
    "accept-language": "en-US",
    authorization: "Bearer session-token",
  };
  const init: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = body;
  }
  return new Request("https://renewlet.example/api/app/admin/media/icon-index/providers/thesvg/refresh", init);
}

function stubRegistryFetch(registries: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/glincker/thesvg/commits/main.atom")) {
      return atomResponse(gitHubCommitAtomFixture("abc1234567890abcdef", "2026-06-11T00:00:00Z"), { etag: "\"commit-etag\"" });
    }
    if (url.includes("/glincker/thesvg/releases.atom")) {
      return atomResponse(gitHubReleaseAtomFixture("thesvg@9.9.9", "2026-06-11T00:00:00Z"));
    }
    if (url.includes("/selfhst/icons/commits/main.atom")) {
      return atomResponse(gitHubCommitAtomFixture("def1234567890abcdef", "2026-06-11T00:00:00Z"), { etag: "\"commit-etag\"" });
    }
    if (url.includes("/homarr-labs/dashboard-icons/commits/main.atom")) {
      return atomResponse(gitHubCommitAtomFixture("fed1234567890abcdef", "2026-06-11T00:00:00Z"), { etag: "\"commit-etag\"" });
    }
    if (url.endsWith("/src/data/icons.json")) return jsonResponse(registries["thesvg"]);
    if (url.endsWith("/index.json")) return jsonResponse(registries["selfhst"]);
    if (url.endsWith("/metadata.json")) return jsonResponse(registries["dashboardMetadata"]);
    if (url.endsWith("/tree.json")) return jsonResponse(registries["dashboardTree"]);
    return new Response("not found", { status: 404 });
  }));
}

function registryFixtures(): Record<string, unknown> {
  return {
    thesvg: [
      {
        slug: "cf-registry",
        title: "CF Registry",
        variants: { default: "/icons/cf-registry/default.svg" },
      },
    ],
    selfhst: [
      {
        Reference: "cf-selfhst",
        Name: "CF selfh.st",
        SVG: "Yes",
      },
    ],
    dashboardMetadata: {
      "cf-dashboard": {},
    },
    dashboardTree: {
      svg: ["cf-dashboard.svg"],
    },
  };
}

function providerVersion(commitSha: string) {
  return {
    sourceRef: commitSha,
    displayVersion: commitSha.slice(0, 7),
    commitSha,
    commitShortSha: commitSha.slice(0, 7),
    commitDate: "2026-06-11T00:00:00Z",
    releaseTag: null,
    releasePublishedAt: null,
  };
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", ...headers },
  });
}

function atomResponse(value: string, headers: Record<string, string> = {}): Response {
  return new Response(value, {
    headers: { "content-type": "application/atom+xml", ...headers },
  });
}

function gitHubCommitAtomFixture(sha: string, updated: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Grit::Commit/${sha}</id>
    <updated>${updated}</updated>
  </entry>
</feed>`;
}

function gitHubReleaseAtomFixture(tag: string, updated: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link type="text/html" rel="alternate" href="https://github.com/glincker/thesvg/releases/tag/${tag.replace("@", "%40")}"/>
    <updated>${updated}</updated>
  </entry>
</feed>`;
}

function stringArg(args: readonly unknown[], index: number): string {
  const value = args[index];
  return typeof value === "string" ? value : "";
}

function numberArg(args: readonly unknown[], index: number): number {
  const value = args[index];
  return typeof value === "number" ? value : 0;
}
