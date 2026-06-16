import {
  buildBuiltInIconProviderIndex,
  canonicalBuiltInIconIndexJson,
  canonicalBuiltInIconSearchIndexJson,
  countBuiltInIconProviders,
  createBuiltInIconSearchIndex,
  replaceBuiltInIconProviderIndex,
  type BuiltInIconRegistryFetcher,
} from "@renewlet/shared/built-in-icon-index-builder";
import { BUILT_IN_ICON_PROVIDERS, type BuiltInIconProvider } from "@renewlet/shared/built-in-icons";
import {
  createMediaResolverFromSearchIndex,
  type BuiltInIcon,
  type BuiltInIconSearchIndex,
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
  type BuiltInIconSeedMetadata,
  type BuiltInIconIndexStatus,
  type BuiltInIconProviderVersion,
} from "@renewlet/shared/schemas/media";
import { requireAdmin } from "./auth";
import { nowIso } from "./db";
import { HttpError, json, requireEmptyBody, requestLocale } from "./http";
import type { Env, MediaIconIndexRow } from "./types";
import {
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
const GITHUB_ATOM_FEED_LIMIT_BYTES = 512 * 1024;
const GITHUB_WEB_BASE = "https://github.com";
const SEED_METADATA_PATH = "/built-in-icons/metadata.json";
const SEED_SEARCH_INDEX_PATH = "/built-in-icons/search-index.json.gz";
const SEED_DETAIL_INDEX_PATH = "/built-in-icons/detail-index.json.gz";

type StoredProviderState = {
  current?: BuiltInIconProviderVersion | null;
  latest?: BuiltInIconProviderVersion | null;
  checkedAt?: string;
  refreshedAt?: string;
  lastError?: string;
  etag?: string;
};
type StoredProviderStates = Partial<Record<BuiltInIconProvider, StoredProviderState>>;

let seedMetadataCache: BuiltInIconSeedMetadata | null = null;
let seedResolverPromise: Promise<MediaResolver> | null = null;
let resolverCache: { hash: string; resolver: MediaResolver } | null = null;
let refreshingProviderInCurrentIsolate: BuiltInIconProvider | null = null;

/**
 * 读取当前 active resolver。
 *
 * Worker isolate 可复用模块级缓存，但缓存键只允许是索引 hash，不能混入 request/auth/settings，
 * 否则同一 isolate 内不同用户的来源偏好会被串用。
 */
export async function getActiveBuiltInMediaResolver(env: Env): Promise<MediaResolver> {
  const row = await readMediaIconIndexRow(env);
  if (!activeIndexRow(row)) return await getSeedBuiltInMediaResolver(env);
  if (resolverCache?.hash === row.hash) return resolverCache.resolver;

  const object = await env.ASSETS_BUCKET.get(row.search_r2_key);
  if (!object) return await getSeedBuiltInMediaResolver(env);
  const searchIndex = JSON.parse(await gunzipToText(new Uint8Array(await object.arrayBuffer()))) as BuiltInIconSearchIndex;
  const resolver = createMediaResolverFromSearchIndex(searchIndex, mediaResolverConfig, providerCdnBaseOverrides(parseProviderStates(row.provider_status_json)));
  resolverCache = { hash: row.hash, resolver };
  return resolver;
}

async function getSeedBuiltInMediaResolver(env: Env): Promise<MediaResolver> {
  const metadata = await readSeedMetadata(env);
  if (resolverCache?.hash === metadata.hash) return resolverCache.resolver;
  seedResolverPromise ??= (async () => {
    // Static Assets seed 只在无 runtime active 或 fallback 时读取；同一 isolate 并发首搜共享这次 gzip 解析。
    const searchIndex = await readSeedSearchIndex(env);
    const resolver = createMediaResolverFromSearchIndex(searchIndex, mediaResolverConfig);
    resolverCache = { hash: metadata.hash, resolver };
    return resolver;
  })().finally(() => {
    seedResolverPromise = null;
  });
  return await seedResolverPromise;
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
    const message = providerFailureMessage(error);
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
    const detailIndexJson = canonicalBuiltInIconIndexJson(icons);
    const searchIndex = createBuiltInIconSearchIndex(icons);
    const searchIndexJson = canonicalBuiltInIconSearchIndexJson(searchIndex);
    const hash = await sha256Hex(detailIndexJson);
    const searchR2Key = `${MEDIA_ICON_INDEX_R2_PREFIX}/${hash}.search.json.gz`;
    const detailR2Key = `${MEDIA_ICON_INDEX_R2_PREFIX}/${hash}.detail.json.gz`;
    await env.ASSETS_BUCKET.put(searchR2Key, await gzipText(searchIndexJson), {
      httpMetadata: { contentType: "application/gzip" },
    });
    await env.ASSETS_BUCKET.put(detailR2Key, await gzipText(detailIndexJson), {
      httpMetadata: { contentType: "application/gzip" },
    });
    await saveProviderRefreshSuccess(env, parsedProvider, {
      hash,
      searchR2Key,
      detailR2Key,
      icons,
      checkedAt,
      version,
      etag,
    });
    resolverCache = {
      hash,
      resolver: createMediaResolverFromSearchIndex(searchIndex, mediaResolverConfig, providerCdnBaseOverrides((await readProviderStates(env)))),
    };
    await finishRefreshOperation(env);
    operationActive = false;
    const status = await readBuiltInIconIndexStatus(env);
    return json(builtInIconIndexProviderRefreshResponseSchema.parse({ status, provider: providerStatus(status, parsedProvider) }));
  } catch (error) {
    const message = providerFailureMessage(error);
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
  const seedMetadata = await readSeedMetadata(env);
  if (!activeIndexRow(row)) {
    return {
      source: "embedded",
      hash: seedMetadata.hash,
      iconCount: seedMetadata.iconCount,
      providerCounts: seedMetadata.providerCounts,
      checkedAt: row?.checked_at ?? null,
      updatedAt: null,
      refreshing: Boolean(refreshingProviderInCurrentIsolate || lockActive(row)),
      providers: providerStatuses(seedMetadata.providerCounts, states, seedMetadata),
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
    providers: providerStatuses(providerCounts, states, seedMetadata),
  };
}

async function readMediaIconIndexRow(env: Env): Promise<MediaIconIndexRow | null> {
  return await env.DB.prepare("SELECT * FROM media_icon_indexes WHERE key = ? LIMIT 1")
    .bind(MEDIA_ICON_INDEX_KEY)
    .first<MediaIconIndexRow>();
}

type ActiveMediaIconIndexRow = MediaIconIndexRow & {
  hash: string;
  search_r2_key: string;
  detail_r2_key: string;
};

function activeIndexRow(row: MediaIconIndexRow | null): row is ActiveMediaIconIndexRow {
  return Boolean(row?.hash && row.search_r2_key && row.detail_r2_key);
}

async function readSeedMetadata(env: Env): Promise<BuiltInIconSeedMetadata> {
  if (seedMetadataCache) return seedMetadataCache;
  const response = await env.ASSETS.fetch(new Request(new URL(SEED_METADATA_PATH, "https://renewlet-static.local")));
  if (!response.ok) throw new Error(`built-in icon seed metadata asset HTTP ${response.status}`);
  seedMetadataCache = builtInIconSeedMetadataSchema.parse(await response.json());
  return seedMetadataCache;
}

async function readSeedSearchIndex(env: Env): Promise<BuiltInIconSearchIndex> {
  return JSON.parse(await gunzipToText(await staticAssetBytes(env, SEED_SEARCH_INDEX_PATH))) as BuiltInIconSearchIndex;
}

async function readSeedDetailIcons(env: Env): Promise<BuiltInIcon[]> {
  return JSON.parse(await gunzipToText(await staticAssetBytes(env, SEED_DETAIL_INDEX_PATH))) as BuiltInIcon[];
}

async function staticAssetBytes(env: Env, path: string): Promise<Uint8Array> {
  const response = await env.ASSETS.fetch(new Request(new URL(path, "https://renewlet-static.local")));
  if (!response.ok) throw new Error(`built-in icon seed asset ${path} HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
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
    searchR2Key: string;
    detailR2Key: string;
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
    SET hash = ?, search_r2_key = ?, detail_r2_key = ?, icon_count = ?, provider_counts_json = ?, provider_status_json = ?,
        checked_at = ?, index_updated_at = ?, updated_at = ?
    WHERE key = ?
  `).bind(
    input.hash,
    input.searchR2Key,
    input.detailR2Key,
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
  if (!activeIndexRow(row)) return await readSeedDetailIcons(env);
  const object = await env.ASSETS_BUCKET.get(row.detail_r2_key);
  if (!object) return await readSeedDetailIcons(env);
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
  const commit = await fetchGitHubAtomFeed(env, gitHubAtomFeedUrl(config.github.owner, config.github.repo, `commits/${config.github.branch}`), etag, "GitHub commit feed");
  if (commit.notModified) return { version: null, etag: commit.etag, notModified: true };
  const parsedCommit = parseGitHubCommitAtomFeed(commit.text);
  const shortSha = parsedCommit.sha.slice(0, 7);
  const version: BuiltInIconProviderVersion = {
    sourceRef: parsedCommit.sha,
    displayVersion: shortSha,
    commitSha: parsedCommit.sha,
    commitShortSha: shortSha,
    commitDate: parsedCommit.updated || null,
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
    const release = await fetchGitHubAtomFeed(env, gitHubAtomFeedUrl(owner, repo, "releases"), "", "GitHub release feed");
    return parseGitHubReleaseAtomFeed(release.text);
  } catch {
    return { tagName: null, publishedAt: null };
  }
}

async function fetchGitHubAtomFeed(
  env: Env,
  url: string,
  etag: string,
  label: string,
): Promise<{ text: string; etag: string; notModified: boolean }> {
  const headers: HeadersInit = {
    accept: "application/atom+xml",
    "user-agent": `Renewlet/${env.RENEWLET_VERSION?.trim() || "cloudflare"}`,
  };
  if (etag) headers["if-none-match"] = etag;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (error) {
      throw createUpstreamNetworkError({
        provider: label,
        error,
      });
    }
    const nextEtag = response.headers.get("etag") ?? "";
    if (response.status === 304) return { text: "", etag: nextEtag, notModified: true };
    if (!response.ok) throw await githubAtomFeedError(response, label);
    // provider check 故意读 GitHub Atom feed 而不是 REST API；错误 raw 仍只随当前管理员操作返回，不进入持久状态。
    return {
      text: await readResponseTextUpToLimit(response, label, GITHUB_ATOM_FEED_LIMIT_BYTES),
      etag: nextEtag,
      notModified: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function githubAtomFeedError(response: Response, label: string): Promise<Error> {
  const providerResponse = await upstreamProviderResponseFromFetchResponse(response);
  const providerMessage = providerMessageFromResponse(providerResponse);
  return createUpstreamHTTPError({
    provider: label,
    response,
    providerResponse,
    providerMessage: providerMessage || `${label} HTTP ${response.status}`,
  });
}

function parseGitHubCommitAtomFeed(text: string): { sha: string; updated: string | null } {
  const entry = firstGitHubAtomEntry(text);
  const id = atomTagText(entry, "id");
  const sha = id.match(/\/([a-f0-9]{7,40})$/i)?.[1] ?? "";
  if (!sha) throw new Error("GitHub commit feed missing sha");
  return { sha, updated: atomTagText(entry, "updated") || null };
}

function parseGitHubReleaseAtomFeed(text: string): { tagName: string | null; publishedAt: string | null } {
  const entry = firstGitHubAtomEntry(text);
  const href = entry.match(/<link\b[^>]*\bhref="([^"]+)"/i)?.[1] ?? "";
  const rawTag = href.match(/\/releases\/tag\/([^/?#"]+)/i)?.[1] ?? "";
  const tagName = rawTag ? decodePathSegment(xmlText(rawTag)).trim() : "";
  return {
    tagName: tagName || null,
    publishedAt: atomTagText(entry, "updated") || null,
  };
}

function firstGitHubAtomEntry(text: string): string {
  const entry = text.match(/<entry\b[\s\S]*?<\/entry>/i)?.[0] ?? "";
  if (!entry) throw new Error("GitHub Atom feed is empty");
  return entry;
}

function atomTagText(entry: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return xmlText(entry.match(pattern)?.[1] ?? "").trim();
}

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function gitHubAtomFeedUrl(owner: string, repo: string, feedPath: string): string {
  return `${GITHUB_WEB_BASE}/${owner}/${repo}/${feedPath.replace(/^\/+|\/+$/g, "")}.atom`;
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

async function readResponseTextUpToLimit(response: Response, label: string, limitBytes = REGISTRY_JSON_LIMIT_BYTES): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
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
    if (total > limitBytes) {
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
  seedMetadata: BuiltInIconSeedMetadata,
): BuiltInIconIndexProviderStatus[] {
  return BUILT_IN_ICON_PROVIDERS.map((provider) => {
    const state = states[provider] ?? {};
    const current = state.current ?? embeddedProviderVersion(provider, seedMetadata);
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

function embeddedProviderVersion(provider: BuiltInIconProvider, seedMetadata: BuiltInIconSeedMetadata): BuiltInIconProviderVersion | null {
  const version = seedMetadata.providers[provider];
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

function providerFailureMessage(error: unknown): string {
  const details = upstreamErrorDetailsFromError(error);
  let message = error instanceof Error ? error.message : String(error);
  const raw = details?.rawResponseText?.trim();
  if (raw) {
    message = message.split(raw).join("").trim().replace(/:\s*$/, "").trim();
  }
  return truncateText(message, 2000);
}
