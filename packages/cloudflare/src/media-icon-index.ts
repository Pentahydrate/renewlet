import {
  buildBuiltInIconProviderIndex,
  canonicalBuiltInIconIndexJson,
  countBuiltInIconProviders,
  replaceBuiltInIconProviderIndex,
  type BuiltInIconRegistryFetcher,
} from "@renewlet/shared/built-in-icon-index-builder";
import { BUILT_IN_ICON_PROVIDERS, type BuiltInIconProvider } from "@renewlet/shared/built-in-icons";
import {
  createMediaResolver,
  type BuiltInIcon,
  type MediaResolver,
} from "@renewlet/shared/media-resolver";
import { mediaResolverConfig } from "@renewlet/shared/media-resolver-config";
import {
  builtInIconIndexProviderCheckResponseSchema,
  builtInIconIndexProviderCountsSchema,
  builtInIconIndexProviderRefreshResponseSchema,
  builtInIconSeedMetadataSchema,
  builtInIconIndexStatusSchema,
  type BuiltInIconIndexProviderStatus,
  type BuiltInIconIndexStatus,
  type BuiltInIconProviderVersion,
} from "@renewlet/shared/schemas/media";
import builtInIconsIndex from "../../client/src/lib/built-in-icons-index.json";
import builtInIconsIndexMetadata from "../../client/src/lib/built-in-icons-index-metadata.json";
import { requireAdmin } from "./auth";
import { nowIso } from "./db";
import { HttpError, json, requireEmptyBody, requestLocale } from "./http";
import type { Env, MediaIconIndexRow } from "./types";
import {
  UpstreamOperationError,
  createUpstreamErrorDetails,
  createUpstreamHTTPError,
  createUpstreamNetworkError,
  providerMessageFromResponse,
  upstreamErrorDetailsFromError,
  upstreamProviderResponseFromFetchResponse,
} from "./upstream-response";

const MEDIA_ICON_INDEX_KEY = "active";
const MEDIA_ICON_INDEX_R2_PREFIX = "system/media-icon-index";
const REFRESH_LOCK_MS = 120_000;
const REGISTRY_FETCH_TIMEOUT_MS = 15_000;
const REGISTRY_JSON_LIMIT_BYTES = 16 * 1024 * 1024;
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

type StoredProviderState = {
  current?: BuiltInIconProviderVersion | null;
  latest?: BuiltInIconProviderVersion | null;
  checkedAt?: string;
  refreshedAt?: string;
  lastError?: string;
  etag?: string;
};
type StoredProviderStates = Partial<Record<BuiltInIconProvider, StoredProviderState>>;

const embeddedIcons = builtInIconsIndex as BuiltInIcon[];
const embeddedResolver = createMediaResolver(embeddedIcons, mediaResolverConfig);
const embeddedJson = canonicalBuiltInIconIndexJson(embeddedIcons);
const embeddedProviderCounts = countBuiltInIconProviders(embeddedIcons);
const embeddedSeedMetadataResult = builtInIconSeedMetadataSchema.safeParse(builtInIconsIndexMetadata);
const embeddedSeedMetadata = embeddedSeedMetadataResult.success ? embeddedSeedMetadataResult.data : null;
let embeddedHashPromise: Promise<string> | null = null;

let resolverCache: { hash: string; resolver: MediaResolver } = {
  hash: "embedded",
  resolver: embeddedResolver,
};
let refreshingProviderInCurrentIsolate: BuiltInIconProvider | null = null;

/**
 * 读取当前 active resolver。
 *
 * Worker isolate 可复用模块级缓存，但缓存键只允许是索引 hash，不能混入 request/auth/settings，
 * 否则同一 isolate 内不同用户的来源偏好会被串用。
 */
export async function getActiveBuiltInMediaResolver(env: Env): Promise<MediaResolver> {
  const row = await readMediaIconIndexRow(env);
  if (!row?.hash || !row.r2_key) return embeddedResolver;
  if (resolverCache.hash === row.hash) return resolverCache.resolver;

  const object = await env.ASSETS_BUCKET.get(row.r2_key);
  if (!object) return embeddedResolver;
  const icons = JSON.parse(await gunzipToText(new Uint8Array(await object.arrayBuffer()))) as BuiltInIcon[];
  const resolver = createMediaResolver(icons, mediaResolverConfig, providerCdnBaseOverrides(parseProviderStates(row.provider_status_json)));
  resolverCache = { hash: row.hash, resolver };
  return resolver;
}

export async function builtInIconIndexStatus(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  return json(builtInIconIndexStatusSchema.parse(await readBuiltInIconIndexStatus(env)));
}

export async function checkBuiltInIconIndexProvider(request: Request, env: Env, provider: string): Promise<Response> {
  const locale = requestLocale(request);
  await requireAdmin(request, env);
  await requireEmptyBody(request, locale);
  const parsedProvider = parseBuiltInIconProvider(provider);
  if (!parsedProvider) throw new HttpError(400, "Invalid built-in icon provider", "INVALID_PROVIDER");
  if (refreshingProviderInCurrentIsolate || !(await acquireRefreshLock(env))) {
    const status = markProviderRefreshing(await readBuiltInIconIndexStatus(env), parsedProvider);
    return json(builtInIconIndexProviderCheckResponseSchema.parse({ status, provider: providerStatus(status, parsedProvider) }), { status: 409 });
  }

  refreshingProviderInCurrentIsolate = parsedProvider;
  let operationActive = true;
  try {
    const checkedAt = nowIso();
    const { version, etag } = await checkLatestProviderVersion(env, parsedProvider);
    await saveProviderLatest(env, parsedProvider, checkedAt, version, etag);
    await finishRefreshOperation(env);
    operationActive = false;
    const status = await readBuiltInIconIndexStatus(env);
    return json(builtInIconIndexProviderCheckResponseSchema.parse({ status, provider: providerStatus(status, parsedProvider) }));
  } catch (error) {
    const message = truncateText(error instanceof Error ? error.message : String(error), 2000);
    const errorDetails = upstreamErrorDetailsFromError(error);
    await saveProviderFailure(env, parsedProvider, nowIso(), message);
    await finishRefreshOperation(env);
    operationActive = false;
    const status = await readBuiltInIconIndexStatus(env);
    // check 只是更新 provider 可见状态；GitHub 限流/断网时仍返回同形状 body，让前端展示失败 badge 而不是把弹层流程打断。
    return json(builtInIconIndexProviderCheckResponseSchema.parse({
      status,
      provider: providerStatus(status, parsedProvider),
      ...(errorDetails ? { errorDetails } : {}),
    }));
  } finally {
    if (operationActive) await finishRefreshOperation(env);
  }
}

export async function refreshBuiltInIconIndexProvider(request: Request, env: Env, provider: string): Promise<Response> {
  const locale = requestLocale(request);
  await requireAdmin(request, env);
  await requireEmptyBody(request, locale);
  const parsedProvider = parseBuiltInIconProvider(provider);
  if (!parsedProvider) throw new HttpError(400, "Invalid built-in icon provider", "INVALID_PROVIDER");
  if (refreshingProviderInCurrentIsolate || !(await acquireRefreshLock(env))) {
    const status = markProviderRefreshing(await readBuiltInIconIndexStatus(env), parsedProvider);
    return json(builtInIconIndexProviderRefreshResponseSchema.parse({ status, provider: providerStatus(status, parsedProvider) }), { status: 409 });
  }

  refreshingProviderInCurrentIsolate = parsedProvider;
  let operationActive = true;
  try {
    const checkedAt = nowIso();
    const { version, etag } = await checkLatestProviderVersion(env, parsedProvider);
    if (!version.commitSha) throw new Error("latest provider commit is unavailable");
    const providerIcons = await buildBuiltInIconProviderIndex(mediaResolverConfig, parsedProvider, registryFetcher, {
      provider: parsedProvider,
      cdnBase: providerPinnedCdnBase(parsedProvider, version.commitSha),
    });
    const activeIcons = await readActiveIcons(env);
    const icons = replaceBuiltInIconProviderIndex(activeIcons, parsedProvider, providerIcons);
    const indexJson = canonicalBuiltInIconIndexJson(icons);
    const hash = await sha256Hex(indexJson);
    const r2Key = `${MEDIA_ICON_INDEX_R2_PREFIX}/${hash}.json.gz`;
    await env.ASSETS_BUCKET.put(r2Key, await gzipText(indexJson), {
      httpMetadata: { contentType: "application/gzip" },
    });
    await saveProviderRefreshSuccess(env, parsedProvider, {
      hash,
      r2Key,
      icons,
      checkedAt,
      version,
      etag,
    });
    resolverCache = {
      hash,
      resolver: createMediaResolver(icons, mediaResolverConfig, providerCdnBaseOverrides((await readProviderStates(env)))),
    };
    await finishRefreshOperation(env);
    operationActive = false;
    const status = await readBuiltInIconIndexStatus(env);
    return json(builtInIconIndexProviderRefreshResponseSchema.parse({ status, provider: providerStatus(status, parsedProvider) }));
  } catch (error) {
    const message = truncateText(error instanceof Error ? error.message : String(error), 2000);
    const errorDetails = upstreamErrorDetailsFromError(error);
    await saveProviderFailure(env, parsedProvider, nowIso(), message);
    await finishRefreshOperation(env);
    operationActive = false;
    const status = await readBuiltInIconIndexStatus(env);
    return json(builtInIconIndexProviderRefreshResponseSchema.parse({
      status,
      provider: providerStatus(status, parsedProvider),
      ...(errorDetails ? { errorDetails } : {}),
    }), { status: 502 });
  } finally {
    if (operationActive) await finishRefreshOperation(env);
  }
}

async function readBuiltInIconIndexStatus(env: Env): Promise<BuiltInIconIndexStatus> {
  const row = await readMediaIconIndexRow(env);
  const states = parseProviderStates(row?.provider_status_json);
  const embeddedHashValue = await embeddedHash();
  const seedMetadataTrusted = embeddedSeedMetadata?.hash === embeddedHashValue;
  if (!row?.hash || !row.r2_key) {
    return {
      source: "embedded",
      hash: embeddedHashValue,
      iconCount: embeddedIcons.length,
      providerCounts: embeddedProviderCounts,
      checkedAt: row?.checked_at ?? null,
      updatedAt: null,
      refreshing: Boolean(refreshingProviderInCurrentIsolate || lockActive(row)),
      providers: providerStatuses(embeddedProviderCounts, states, seedMetadataTrusted),
    };
  }
  const providerCounts = parseProviderCounts(row.provider_counts_json);
  return {
    source: "runtime",
    hash: row.hash,
    iconCount: row.icon_count,
    providerCounts,
    checkedAt: row.checked_at,
    updatedAt: row.index_updated_at,
    refreshing: Boolean(refreshingProviderInCurrentIsolate || lockActive(row)),
    providers: providerStatuses(providerCounts, states, seedMetadataTrusted),
  };
}

async function readMediaIconIndexRow(env: Env): Promise<MediaIconIndexRow | null> {
  return await env.DB.prepare("SELECT * FROM media_icon_indexes WHERE key = ? LIMIT 1")
    .bind(MEDIA_ICON_INDEX_KEY)
    .first<MediaIconIndexRow>();
}

async function ensureMediaIconIndexRow(env: Env): Promise<void> {
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO media_icon_indexes (key, provider_counts_json, provider_status_json, created_at, updated_at)
    VALUES (?, '{}', '{}', ?, ?)
  `).bind(MEDIA_ICON_INDEX_KEY, timestamp, timestamp).run();
}

async function acquireRefreshLock(env: Env): Promise<boolean> {
  await ensureMediaIconIndexRow(env);
  const now = nowIso();
  const lockedUntil = new Date(Date.now() + REFRESH_LOCK_MS).toISOString();
  const result = await env.DB.prepare(`
    UPDATE media_icon_indexes
    SET locked_until = ?, updated_at = ?
    WHERE key = ? AND (locked_until IS NULL OR locked_until <= ?)
  `).bind(lockedUntil, now, MEDIA_ICON_INDEX_KEY, now).run();
  return typeof result.meta.changes === "number" && result.meta.changes > 0;
}

async function releaseRefreshLock(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE media_icon_indexes SET locked_until = NULL, updated_at = ? WHERE key = ?")
    .bind(nowIso(), MEDIA_ICON_INDEX_KEY)
    .run();
}

async function finishRefreshOperation(env: Env): Promise<void> {
  refreshingProviderInCurrentIsolate = null;
  await releaseRefreshLock(env).catch(() => undefined);
}

async function readProviderStates(env: Env): Promise<StoredProviderStates> {
  return parseProviderStates((await readMediaIconIndexRow(env))?.provider_status_json);
}

async function saveProviderLatest(
  env: Env,
  provider: BuiltInIconProvider,
  checkedAt: string,
  version: BuiltInIconProviderVersion,
  etag: string,
): Promise<void> {
  await ensureMediaIconIndexRow(env);
  const states = await readProviderStates(env);
  const current = states[provider] ?? {};
  const next: StoredProviderState = { ...current, latest: version, checkedAt, lastError: "" };
  const nextEtag = etag || current.etag;
  if (nextEtag) next.etag = nextEtag;
  states[provider] = next;
  await env.DB.prepare(`
    UPDATE media_icon_indexes
    SET checked_at = ?, provider_status_json = ?, updated_at = ?
    WHERE key = ?
  `).bind(checkedAt, JSON.stringify(states), checkedAt, MEDIA_ICON_INDEX_KEY).run();
}

async function saveProviderRefreshSuccess(
  env: Env,
  provider: BuiltInIconProvider,
  input: {
    hash: string;
    r2Key: string;
    icons: readonly BuiltInIcon[];
    checkedAt: string;
    version: BuiltInIconProviderVersion;
    etag: string;
  },
): Promise<void> {
  await ensureMediaIconIndexRow(env);
  const states = await readProviderStates(env);
  const current = states[provider] ?? {};
  const next: StoredProviderState = {
    ...current,
    current: input.version,
    latest: input.version,
    checkedAt: input.checkedAt,
    refreshedAt: input.checkedAt,
    lastError: "",
  };
  const nextEtag = input.etag || current.etag;
  if (nextEtag) next.etag = nextEtag;
  states[provider] = next;
  await env.DB.prepare(`
    UPDATE media_icon_indexes
    SET hash = ?, r2_key = ?, icon_count = ?, provider_counts_json = ?, provider_status_json = ?,
        checked_at = ?, index_updated_at = ?, updated_at = ?
    WHERE key = ?
  `).bind(
    input.hash,
    input.r2Key,
    input.icons.length,
    JSON.stringify(countBuiltInIconProviders(input.icons)),
    JSON.stringify(states),
    input.checkedAt,
    input.checkedAt,
    input.checkedAt,
    MEDIA_ICON_INDEX_KEY,
  ).run();
}

async function saveProviderFailure(env: Env, provider: BuiltInIconProvider, checkedAt: string, message: string): Promise<void> {
  await ensureMediaIconIndexRow(env);
  const states = await readProviderStates(env);
  states[provider] = { ...(states[provider] ?? {}), checkedAt, lastError: message };
  await env.DB.prepare(`
    UPDATE media_icon_indexes
    SET checked_at = ?, provider_status_json = ?, updated_at = ?
    WHERE key = ?
  `).bind(checkedAt, JSON.stringify(states), checkedAt, MEDIA_ICON_INDEX_KEY).run();
}

async function readActiveIcons(env: Env): Promise<BuiltInIcon[]> {
  const row = await readMediaIconIndexRow(env);
  if (!row?.hash || !row.r2_key) return embeddedIcons;
  const object = await env.ASSETS_BUCKET.get(row.r2_key);
  if (!object) return embeddedIcons;
  return JSON.parse(await gunzipToText(new Uint8Array(await object.arrayBuffer()))) as BuiltInIcon[];
}

async function checkLatestProviderVersion(
  env: Env,
  provider: BuiltInIconProvider,
): Promise<{ version: BuiltInIconProviderVersion; etag: string }> {
  const states = await readProviderStates(env);
  const current = states[provider] ?? {};
  const result = await fetchLatestProviderVersion(env, provider, current.etag ?? "");
  if (result.notModified && current.latest) return { version: current.latest, etag: result.etag || current.etag || "" };
  if (!result.version) throw new Error("latest provider version is unavailable");
  return { version: result.version, etag: result.etag || current.etag || "" };
}

async function fetchLatestProviderVersion(
  env: Env,
  provider: BuiltInIconProvider,
  etag: string,
): Promise<{ version: BuiltInIconProviderVersion | null; etag: string; notModified: boolean }> {
  const config = mediaResolverConfig.builtInProviders.find((item) => item.provider === provider);
  if (!config) throw new Error(`unknown built-in icon provider: ${provider}`);
  const commitUrl = `${GITHUB_API_BASE}/repos/${config.github.owner}/${config.github.repo}/commits/${config.github.branch}`;
  const commit = await fetchGitHubJson<{
    sha?: string;
    commit?: { committer?: { date?: string } };
  }>(env, commitUrl, etag);
  if (commit.notModified) return { version: null, etag: commit.etag, notModified: true };
  if (!commit.data?.sha) throw new Error("GitHub commit response missing sha");
  const shortSha = commit.data.sha.slice(0, 7);
  const version: BuiltInIconProviderVersion = {
    sourceRef: commit.data.sha,
    displayVersion: shortSha,
    commitSha: commit.data.sha,
    commitShortSha: shortSha,
    commitDate: commit.data.commit?.committer?.date ?? null,
    releaseTag: null,
    releasePublishedAt: null,
  };
  if (config.github.latestRelease) {
    const release = await fetchLatestProviderRelease(env, config.github.owner, config.github.repo);
    if (release.tagName) {
      version.releaseTag = release.tagName;
    }
    version.releasePublishedAt = release.publishedAt;
  }
  return { version, etag: commit.etag, notModified: false };
}

async function fetchLatestProviderRelease(env: Env, owner: string, repo: string): Promise<{ tagName: string | null; publishedAt: string | null }> {
  try {
    const release = await fetchGitHubJson<{ tag_name?: string; published_at?: string }>(env, `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`, "");
    return {
      tagName: release.data?.tag_name?.trim() || null,
      publishedAt: release.data?.published_at?.trim() || null,
    };
  } catch {
    return { tagName: null, publishedAt: null };
  }
}

async function fetchGitHubJson<T>(
  env: Env,
  url: string,
  etag: string,
): Promise<{ data: T | null; etag: string; notModified: boolean }> {
  const headers: HeadersInit = {
    accept: "application/vnd.github+json",
    "user-agent": `Renewlet/${env.RENEWLET_VERSION?.trim() || "cloudflare"}`,
    "x-github-api-version": GITHUB_API_VERSION,
  };
  if (etag) headers["if-none-match"] = etag;
  const token = env.RENEWLET_GITHUB_TOKEN?.trim();
  if (token) headers["authorization"] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (error) {
      throw createUpstreamNetworkError({
        provider: "GitHub",
        error,
        secrets: token ? [token] : [],
      });
    }
    const nextEtag = response.headers.get("etag") ?? "";
    if (response.status === 304) return { data: null, etag: nextEtag, notModified: true };
    if (!response.ok) throw await githubVersionCheckError(response, token ? [token] : []);
    return {
      data: JSON.parse(await readResponseTextUpToLimit(response, "GitHub version check")) as T,
      etag: nextEtag,
      notModified: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function githubVersionCheckError(response: Response, secrets: readonly string[]): Promise<UpstreamOperationError> {
  const status = response.status;
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = response.headers.get("retry-after");
  const resetAt = githubRateLimitResetTime(response.headers.get("x-ratelimit-reset"));
  const providerResponse = await upstreamProviderResponseFromFetchResponse(response, { secrets });
  const providerMessage = providerMessageFromResponse(providerResponse);
  if (status === 429 || (status === 403 && remaining === "0")) {
    const retryHint = retryAfter
      ? ` Retry after ${retryAfter}s.`
      : resetAt
        ? ` Retry after ${resetAt}.`
        : "";
    const message = `GitHub API rate limited (HTTP ${status}).${retryHint} Configure RENEWLET_GITHUB_TOKEN for a higher limit.`;
    return new UpstreamOperationError(message, createUpstreamErrorDetails({
      responseText: providerMessage || message,
      providerResponse,
    }));
  }
  if (status === 403) {
    const message = "GitHub API access denied (HTTP 403). Configure RENEWLET_GITHUB_TOKEN or retry later.";
    return new UpstreamOperationError(message, createUpstreamErrorDetails({
      responseText: providerMessage || message,
      providerResponse,
    }));
  }
  return createUpstreamHTTPError({
    provider: "GitHub",
    response,
    providerResponse,
    providerMessage: providerMessage || `GitHub version check HTTP ${status}`,
  });
}

function githubRateLimitResetTime(value: string | null): string {
  if (!value) return "";
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString();
}

const registryFetcher: BuiltInIconRegistryFetcher = async (url, label) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      throw createUpstreamNetworkError({
        provider: label,
        error,
      });
    }
    if (!response.ok) {
      const providerResponse = await upstreamProviderResponseFromFetchResponse(response);
      throw createUpstreamHTTPError({
        provider: label,
        response,
        providerResponse,
        providerMessage: providerMessageFromResponse(providerResponse) || `${label} HTTP ${response.status}`,
      });
    }
    return JSON.parse(await readResponseTextUpToLimit(response, label));
  } finally {
    clearTimeout(timeout);
  }
};

async function readResponseTextUpToLimit(response: Response, label: string): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > REGISTRY_JSON_LIMIT_BYTES) {
    throw new Error(`${label} response too large`);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > REGISTRY_JSON_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${label} response too large`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function providerStatuses(
  counts: BuiltInIconIndexStatus["providerCounts"],
  states: StoredProviderStates,
  seedMetadataTrusted: boolean,
): BuiltInIconIndexProviderStatus[] {
  return BUILT_IN_ICON_PROVIDERS.map((provider) => {
    const state = states[provider] ?? {};
    const current = state.current ?? embeddedProviderVersion(provider, seedMetadataTrusted);
    const latest = state.latest ?? null;
    return {
      provider,
      current,
      latest,
      iconCount: counts[provider],
      checkedAt: nonEmpty(state.checkedAt),
      refreshedAt: nonEmpty(state.refreshedAt),
      lastError: nonEmpty(state.lastError),
      refreshing: refreshingProviderInCurrentIsolate === provider,
      updateAvailable: providerUpdateAvailable(current, latest),
    };
  });
}

function embeddedProviderVersion(provider: BuiltInIconProvider, seedMetadataTrusted: boolean): BuiltInIconProviderVersion | null {
  if (!seedMetadataTrusted) return null;
  const version = embeddedSeedMetadata?.providers[provider];
  if (!version?.commitSha || !version.commitShortSha) return null;
  // seed metadata 是生成期记录的真实 GitHub HEAD；runtime 缺 provider current 时只能回退到它，不能编造 embedded/runtime 版本。
  return { ...version };
}

function parseProviderStates(value: string | null | undefined): StoredProviderStates {
  try {
    const parsed = JSON.parse(value || "{}") as StoredProviderStates;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function providerCdnBaseOverrides(states: StoredProviderStates): Partial<Record<BuiltInIconProvider, string>> {
  return Object.fromEntries(BUILT_IN_ICON_PROVIDERS.flatMap((provider) => {
    const commitSha = states[provider]?.current?.commitSha;
    return commitSha ? [[provider, providerPinnedCdnBase(provider, commitSha)] as const] : [];
  }));
}

function providerPinnedCdnBase(provider: BuiltInIconProvider, ref: string): string {
  const config = mediaResolverConfig.builtInProviders.find((item) => item.provider === provider);
  return config ? `https://testingcf.jsdelivr.net/gh/${config.github.owner}/${config.github.repo}@${ref}` : "";
}

function providerUpdateAvailable(current: BuiltInIconProviderVersion | null, latest: BuiltInIconProviderVersion | null): boolean {
  if (!latest) return false;
  if (!current) return true;
  if (current.commitSha && latest.commitSha) return current.commitSha !== latest.commitSha;
  return current.sourceRef !== latest.sourceRef;
}

function providerStatus(status: BuiltInIconIndexStatus, provider: BuiltInIconProvider): BuiltInIconIndexProviderStatus {
  return status.providers.find((item) => item.provider === provider) ?? {
    provider,
    current: null,
    latest: null,
    iconCount: 0,
    checkedAt: null,
    refreshedAt: null,
    lastError: null,
    refreshing: false,
    updateAvailable: false,
  };
}

function markProviderRefreshing(status: BuiltInIconIndexStatus, provider: BuiltInIconProvider): BuiltInIconIndexStatus {
  return {
    ...status,
    refreshing: true,
    providers: status.providers.map((item) => item.provider === provider ? { ...item, refreshing: true } : item),
  };
}

async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([copyToArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function embeddedHash(): Promise<string> {
  embeddedHashPromise ??= sha256Hex(embeddedJson);
  return embeddedHashPromise;
}

function parseProviderCounts(value: string): BuiltInIconIndexStatus["providerCounts"] {
  try {
    const result = builtInIconIndexProviderCountsSchema.safeParse(JSON.parse(value || "{}"));
    return result.success ? result.data : { thesvg: 0, selfhst: 0, dashboardIcons: 0 };
  } catch {
    return { thesvg: 0, selfhst: 0, dashboardIcons: 0 };
  }
}

function parseBuiltInIconProvider(value: string): BuiltInIconProvider | null {
  return BUILT_IN_ICON_PROVIDERS.includes(value as BuiltInIconProvider) ? value as BuiltInIconProvider : null;
}

function lockActive(row: MediaIconIndexRow | null): boolean {
  return Boolean(row?.locked_until && Date.parse(row.locked_until) > Date.now());
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function truncateText(value: string, maxLength: number): string {
  return [...value].slice(0, maxLength).join("");
}
