/**
 * Cloudflare 系统版本 handler 只提供只读部署状态。
 *
 * Worker 不能执行 Docker 式下载、替换二进制或重启；这里仍检查 GitHub Release，让前端能提示用户同步部署。
 */
import { systemVersionResponseSchema } from "@renewlet/shared/schemas/app";
import { z } from "zod";
import rootPackageJson from "../../../package.json";
import { requireAdmin } from "./auth";
import { HttpError, json, requestLocale } from "./http";
import { serverText } from "./server-i18n";
import type { Env } from "./types";
import {
  UpstreamOperationError,
  createUpstreamErrorDetails,
  createUpstreamHTTPError,
  createUpstreamNetworkError,
  providerMessageFromResponse,
  readUpstreamResponseBody,
  upstreamErrorDetailsFromError,
  upstreamProviderResponseFromBody,
} from "./upstream-response";

const DEV_VERSION = "0.0.0-dev";
const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/zhiyingzzhou/renewlet/releases/latest";
const GITHUB_API_VERSION = "2026-03-10";
const STABLE_BUILD_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const BRANCH_BUILD_VERSION_PATTERN = /^\d+\.\d+\.\d+-dev\+[0-9a-f]{7,40}$/i;
const PLACEHOLDER_DEV_VERSION_PATTERN = /^0\.0\.0-dev(?:\+.*)?$/;
const STABLE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const COMPARABLE_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

const githubReleaseAssetSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
}).passthrough();

const githubReleaseSchema = z.object({
  tag_name: z.string().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  html_url: z.string().min(1),
  prerelease: z.boolean().optional().default(false),
  draft: z.boolean().optional().default(false),
  assets: z.array(githubReleaseAssetSchema).optional().default([]),
}).passthrough();

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
};

type GitHubRelease = z.infer<typeof githubReleaseSchema>;

/**
 * systemVersion 返回 Cloudflare 运行面的版本状态。
 *
 * Worker 部署没有可替换的本地二进制，但仍应只读检查 GitHub Release，避免把“不能页面内执行更新”误当成“不能判断版本”。
 */
export async function systemVersion(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  const commit = cloudflareBuildValue(env.RENEWLET_COMMIT, "");
  const buildTime = cloudflareBuildValue(env.RENEWLET_BUILD_TIME, "");
  const version = resolveCloudflareVersion(env.RENEWLET_VERSION);
  const releaseCheck = await checkLatestStableRelease(version, locale, env);
  return json(systemVersionResponseSchema.parse({
    currentVersion: version,
    latestVersion: releaseCheck.latestVersion,
    hasUpdate: releaseCheck.hasUpdate,
    checkSucceeded: releaseCheck.checkSucceeded,
    deployment: "cloudflare",
    updateMode: "cloudflare-deploy",
    updateSupported: false,
    unsupportedReason: serverText(locale, "system.cloudflareVersionUnsupportedReason"),
    releaseInfo: releaseCheck.releaseInfo,
    cached: false,
    ...(releaseCheck.warning ? { warning: releaseCheck.warning } : {}),
    ...(releaseCheck.errorDetails ? { errorDetails: releaseCheck.errorDetails } : {}),
    build: {
      version,
      commit,
      buildTime,
      buildType: "cloudflare",
    },
  }));
}

/**
 * systemUpdate 明确拒绝 Cloudflare 页面内更新。
 *
 * Cloudflare 的发布入口是 Wrangler/Workers Builds，管理员按钮不能触发容器式下载、校验和重启状态机。
 */
export async function systemUpdate(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  throw new HttpError(400, serverText(locale, "system.cloudflareUpdateUnsupported"), "SYSTEM_UPDATE_UNSUPPORTED");
}

/**
 * systemRestart 明确拒绝 Cloudflare 页面内重启。
 *
 * Worker 发布由 Cloudflare 平台接管，没有 Docker restart pending 状态；错误码必须和 update 拆开，前端才能区分动作。
 */
export async function systemRestart(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  throw new HttpError(400, serverText(locale, "system.cloudflareRestartUnsupported"), "SYSTEM_RESTART_UNSUPPORTED");
}

function cloudflareBuildValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

function resolveCloudflareVersion(rawVersion: string | undefined): string {
  const version = cloudflareBuildValue(rawVersion, "");
  if (!version || version === DEV_VERSION || PLACEHOLDER_DEV_VERSION_PATTERN.test(version)) {
    // Deploy Button/Workers Builds 不一定注入 CI 元信息；缺省值代表官方稳定包版本，只有显式分支构建才允许展示 dev 后缀。
    return rootPackageJson.version;
  }
  if (STABLE_BUILD_VERSION_PATTERN.test(version) || BRANCH_BUILD_VERSION_PATTERN.test(version)) return version;
  return rootPackageJson.version;
}

async function checkLatestStableRelease(currentVersion: string, locale: ReturnType<typeof requestLocale>, env: Env) {
  try {
    const release = await fetchLatestStableRelease(env);
    if (!release || release.draft || release.prerelease) return releaseCheckDeferred(currentVersion, locale);
    const latest = parseStableVersion(release.tag_name);
    const current = parseComparableVersion(currentVersion);
    if (!latest || !current) return releaseCheckDeferred(currentVersion, locale);
    const latestVersion = versionToString(latest);
    const hasUpdate = compareVersion(latest, current) > 0;
    const currentIsStableRelease = parseStableVersion(currentVersion) !== null;
    return {
      latestVersion,
      hasUpdate,
      checkSucceeded: true,
      releaseInfo: hasUpdate || currentIsStableRelease ? releaseInfoFromGitHub(release, latestVersion) : null,
      warning: undefined,
      errorDetails: undefined,
    };
  } catch (error) {
    return releaseCheckDeferred(currentVersion, locale, upstreamErrorDetailsFromError(error));
  }
}

function releaseCheckDeferred(currentVersion: string, locale: ReturnType<typeof requestLocale>, errorDetails?: ReturnType<typeof upstreamErrorDetailsFromError>) {
  return {
    latestVersion: currentVersion,
    hasUpdate: false,
    checkSucceeded: false,
    releaseInfo: null,
    warning: serverText(locale, "system.versionCheckUnavailableWarning"),
    errorDetails,
  };
}

async function fetchLatestStableRelease(env: Env): Promise<GitHubRelease> {
  const headers: HeadersInit = {
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": `Renewlet/${rootPackageJson.version}`,
  };
  const token = env.RENEWLET_GITHUB_TOKEN?.trim();
  if (token) headers["authorization"] = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(GITHUB_LATEST_RELEASE_URL, { headers });
  } catch (error) {
    throw createUpstreamNetworkError({
      provider: "GitHub",
      error,
      secrets: token ? [token] : [],
    });
  }
  const body = await readUpstreamResponseBody(response);
  const providerResponse = upstreamProviderResponseFromBody(response, body.text, body.truncated, token ? [token] : []);
  if (!response.ok) {
    const providerMessage = providerMessageFromResponse(providerResponse);
    throw createUpstreamHTTPError({
      provider: "GitHub",
      response,
      providerResponse,
      providerMessage,
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body.text) as unknown;
  } catch {
    throw new UpstreamOperationError("GitHub Release response is not valid JSON", createUpstreamErrorDetails({
      providerResponse,
    }));
  }
  const parsed = githubReleaseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamOperationError("GitHub Release response shape is invalid", createUpstreamErrorDetails({
      providerResponse,
    }));
  }
  return parsed.data;
}

function releaseInfoFromGitHub(release: GitHubRelease, version: string) {
  return {
    tagName: release.tag_name,
    version,
    name: release.name ?? "",
    body: release.body ?? "",
    publishedAt: release.published_at ?? "",
    htmlUrl: release.html_url,
    assets: release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
    })),
  };
}

function parseStableVersion(rawVersion: string): ParsedVersion | null {
  return parseVersion(rawVersion, STABLE_VERSION_PATTERN);
}

function parseComparableVersion(rawVersion: string): ParsedVersion | null {
  return parseVersion(rawVersion, COMPARABLE_VERSION_PATTERN);
}

function parseVersion(rawVersion: string, pattern: RegExp): ParsedVersion | null {
  const match = pattern.exec(rawVersion.trim());
  if (!match) return null;
  const major = Number.parseInt(match[1] ?? "", 10);
  const minor = Number.parseInt(match[2] ?? "", 10);
  const patch = Number.parseInt(match[3] ?? "", 10);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

function compareVersion(left: ParsedVersion, right: ParsedVersion): number {
  return compareNumber(left.major, right.major) || compareNumber(left.minor, right.minor) || compareNumber(left.patch, right.patch);
}

function compareNumber(left: number, right: number): number {
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}

function versionToString(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
