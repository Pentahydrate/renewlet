import {
  CLOUD_BACKUP_DEFAULT_RETENTION,
  CLOUD_BACKUP_DEFAULT_SCHEDULE_TIME,
  CLOUD_BACKUP_DEFAULT_SCHEDULE_WEEKDAY,
  CLOUD_BACKUP_MAX_SNAPSHOT_BYTES,
  cloudBackupConfigResponseSchema,
  cloudBackupConfigUpdateSchema,
  cloudBackupCreateSnapshotRequestSchema,
  cloudBackupCreateSnapshotResponseSchema,
  cloudBackupDeleteSnapshotResponseSchema,
  cloudBackupPolicySchema,
  cloudBackupS3ConfigSchema,
  cloudBackupSnapshotManifestSchema,
  cloudBackupSnapshotsResponseSchema,
  cloudBackupTestResponseSchema,
  cloudBackupWebDavConfigSchema,
  type CloudBackupConfig,
  type CloudBackupConfigUpdate,
  type CloudBackupErrorDetails,
  type CloudBackupPolicy,
  type CloudBackupProvider,
  type CloudBackupS3Config,
  type CloudBackupSnapshot,
  type CloudBackupSnapshotManifest,
  type CloudBackupWebDavConfig,
} from "@renewlet/shared/schemas/cloud-backup";
import { renewletExportV1Schema, type RenewletExportAsset } from "@renewlet/shared/schemas/import-export";
// Cloudflare 云备份在 D1 保存策略与锁、R2 保存 ZIP，对外只暴露脱敏后的上游错误详情。
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import {
  boolToInt,
  getAsset,
  getCustomConfig,
  getSettings,
  listSubscriptions,
  nowIso,
  toApiSubscription,
} from "./db";
import { requireAuth } from "./auth";
import { HttpError, json, readJson, requestLocale, type AppLocale } from "./http";
import { DEFAULT_SERVER_I18N_LOCALE, serverText } from "./server-i18n";
import { createStoredZip } from "./zip-store";
import {
  CloudBackupRemoteError,
  S3CloudBackupClient,
  WebDAVCloudBackupClient,
  sanitizeDownloadFilename,
  sha256Hex,
  snapshotId,
  type CloudBackupRemoteClient,
} from "./cloud-backup-remote";
import { cloudBackupProviderFromRequest, cloudBackupProviderParameterError } from "./cloud-backup-provider";
import { cloudBackupTargetDue, createDefaultFallbackSettings } from "./cloud-backup-schedule";
import { deleteCloudBackupFromTargets, downloadCloudBackupFromTargets, type CloudBackupTarget } from "./cloud-backup-snapshot-resolve";
import { bytesForFetchBody, extensionFromMime, parseJsonObject, privateAssetIdFromLogo } from "./cloud-backup-utils";
import type { CloudBackupTargetRow, Env, UserRow } from "./types";

const CLOUD_BACKUP_COLUMNS = [
  "user_id",
  "provider",
  "config_json",
  "credential_json",
  "schedule_enabled",
  "schedule_frequency",
  "schedule_time",
  "schedule_weekday",
  "retention",
  "last_backup_at",
  "last_status",
  "last_error",
  "locked_until",
  "created_at",
  "updated_at",
] as const;

const CLOUD_BACKUP_CONFIG_COLUMNS = CLOUD_BACKUP_COLUMNS.join(", ");
const CLOUD_BACKUP_LOCK_MS = 15 * 60 * 1000;
const CLOUD_BACKUP_PAGE_SIZE = 200;
const textEncoder = new TextEncoder();

type StoredCloudBackupConfig = {
  webdav?: CloudBackupWebDavConfig;
  s3?: CloudBackupS3Config;
};

type StoredCloudBackupCredential = {
  webdavPassword?: string;
  s3SecretAccessKey?: string;
};

type CloudBackupCredentialState = {
  webdav: boolean;
  s3: boolean;
};

type ResolvedCloudBackupConfig = {
  userId: string;
  provider: CloudBackupProvider;
  targets: Partial<Record<CloudBackupProvider, ResolvedCloudBackupTarget>>;
  updatedAt: string | null;
};

type ResolvedCloudBackupTarget = {
  row: CloudBackupTargetRow | null;
  userId: string;
  provider: CloudBackupProvider;
  webdav?: CloudBackupWebDavConfig;
  s3?: CloudBackupS3Config;
  credential: StoredCloudBackupCredential;
  policy: CloudBackupPolicy;
  lastBackupAt: string | null;
  lastStatus: "idle" | "success" | "failed";
  lastError: string | null;
  lockedUntil: string | null;
  updatedAt: string | null;
};

type ConfiguredCloudBackupTarget = CloudBackupTarget & {
  retention: number;
};

type CloudBackupSnapshotPayload = {
  content: Uint8Array;
  id: string;
  filename: string;
  manifest: CloudBackupSnapshotManifest;
};

type ExportAsset = RenewletExportAsset & {
  content: Uint8Array;
};

type ServerTextKey = Parameters<typeof serverText>[1];

const SECRET_SETTING_KEYS: Array<keyof ApiAppSettings> = [
  "testPhone",
  "telegramBotToken",
  "telegramChatId",
  "notifyxApiKey",
  "webhookUrl",
  "webhookHeaders",
  "webhookPayload",
  "wechatWebhookUrl",
  "wechatAtPhones",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUser",
  "smtpPassword",
  "smtpFrom",
  "smtpReplyTo",
  "recipientEmail",
  "barkServerUrl", "barkDeviceKey", "serverchanSendKey",
  "discordWebhookUrl", "discordBotUsername", "discordBotAvatarUrl", "pushplusToken",
];

export async function readCloudBackupConfig(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const config = await getCloudBackupConfig(env, auth.user.id);
  return json(cloudBackupConfigResponseSchema.parse({ config: toConfigDTO(config) }));
}

export async function updateCloudBackupConfig(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, cloudBackupConfigUpdateSchema, locale);
  const saved = await saveCloudBackupConfig(env, auth.user.id, body);
  return json(cloudBackupConfigResponseSchema.parse({ config: toConfigDTO(saved) }));
}

export async function testCloudBackupConfig(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, cloudBackupConfigUpdateSchema, locale);
  const current = await getCloudBackupTarget(env, auth.user.id, body.provider);
  const target = targetFromUpdate(auth.user.id, body, current);
  const client = remoteClientForTarget(target, locale);
  await client.test().catch((error: unknown) => {
    throw cloudBackupOperationError(locale, "cloudBackup.testFailed", "CLOUD_BACKUP_TEST_FAILED", error);
  });
  return json(cloudBackupTestResponseSchema.parse({
    ok: true,
    checkedAt: nowIso(),
  }));
}

export async function listCloudBackups(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const locale = requestLocale(request);
  const providerQuery = cloudBackupProviderFromRequest(request, locale);
  if (!providerQuery.hasProvider) {
    throw cloudBackupProviderParameterError(locale, "CLOUD_BACKUP_PROVIDER_REQUIRED", "provider_required", "Use provider=webdav or provider=s3.");
  }
  // 列表是 provider-scoped API；当前 tab 只访问当前目标，另一个目标的上游错误不能污染本响应。
  const target = await configuredCloudBackupTargetForProvider(env, auth.user.id, providerQuery.provider, locale);
  const manifests = await target.client.list().catch((error: unknown) => {
    throw cloudBackupOperationError(locale, "cloudBackup.listFailed", "CLOUD_BACKUP_LIST_FAILED", error);
  });
  const snapshots: CloudBackupSnapshot[] = snapshotsFromManifests(target.provider, manifests);
  snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return json(cloudBackupSnapshotsResponseSchema.parse({ snapshots }));
}

export async function createCloudBackup(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readCloudBackupCreateRequest(request, locale);
  try {
    const snapshots = await createCloudBackupForUserProvider(env, auth.user, locale, body.provider);
    return json(cloudBackupCreateSnapshotResponseSchema.parse({ snapshots }), { status: 201 });
  } catch (error) {
    await markCloudBackupStatus(env, auth.user.id, body.provider, "failed", persistedCloudBackupErrorMessage(error));
    throw cloudBackupOperationError(locale, "cloudBackup.createFailed", "CLOUD_BACKUP_CREATE_FAILED", error);
  }
}

async function readCloudBackupCreateRequest(request: Request, locale: AppLocale) {
  try {
    return await readJson(request, cloudBackupCreateSnapshotRequestSchema, locale);
  } catch (error) {
    if (error instanceof HttpError && error.code === "INVALID_PAYLOAD") {
      throw cloudBackupProviderParameterError(locale, "CLOUD_BACKUP_PROVIDER_INVALID", "provider_invalid", `Use JSON body {"provider":"webdav"} or {"provider":"s3"}.`);
    }
    throw error;
  }
}

export async function downloadCloudBackup(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireAuth(request, env);
  const locale = requestLocale(request);
  const snapshotId = id.trim();
  if (!snapshotId) throw new HttpError(400, serverText(locale, "cloudBackup.snapshotInvalid"), "CLOUD_BACKUP_SNAPSHOT_INVALID");
  const providerQuery = cloudBackupProviderFromRequest(request, locale);
  let content: Uint8Array;
  let manifest: CloudBackupSnapshotManifest;
  if (providerQuery.hasProvider) {
    const client = await configuredCloudBackupClientForProvider(env, auth.user.id, providerQuery.provider, locale);
    ({ content, manifest } = await client.download(snapshotId).catch((error: unknown) => {
      throw cloudBackupOperationError(locale, "cloudBackup.downloadFailed", "CLOUD_BACKUP_DOWNLOAD_FAILED", error);
    }));
    if (!(await verifySnapshotBytes(content, manifest))) {
      throw new HttpError(400, serverText(locale, "cloudBackup.checksumFailed"), "CLOUD_BACKUP_CHECKSUM_FAILED");
    }
  } else {
    ({ content, manifest } = await downloadCloudBackupWithoutProvider(env, auth.user.id, locale, snapshotId).catch((error: unknown) => {
      throw cloudBackupOperationError(locale, "cloudBackup.downloadFailed", "CLOUD_BACKUP_DOWNLOAD_FAILED", error);
    }));
  }

  // 恢复下载只返回经过 sidecar manifest 校验的 ZIP；前端仍必须交给导入预览，不能直接覆盖 D1。
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${sanitizeDownloadFilename(manifest.filename)}"`);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(bytesForFetchBody(content), { headers });
}

export async function deleteCloudBackup(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireAuth(request, env);
  const locale = requestLocale(request);
  const snapshotId = id.trim();
  if (!snapshotId) throw new HttpError(400, serverText(locale, "cloudBackup.snapshotInvalid"), "CLOUD_BACKUP_SNAPSHOT_INVALID");
  const providerQuery = cloudBackupProviderFromRequest(request, locale);
  if (providerQuery.hasProvider) {
    const client = await configuredCloudBackupClientForProvider(env, auth.user.id, providerQuery.provider, locale);
    await client.delete(snapshotId).catch((error: unknown) => {
      throw cloudBackupOperationError(locale, "cloudBackup.deleteFailed", "CLOUD_BACKUP_DELETE_FAILED", error);
    });
  } else {
    await deleteCloudBackupWithoutProvider(env, auth.user.id, locale, snapshotId).catch((error: unknown) => {
      const messageKey = error instanceof CloudBackupRemoteError && error.code === "CLOUD_BACKUP_PROVIDER_REQUIRED"
        ? "cloudBackup.providerRequired"
        : "cloudBackup.deleteFailed";
      throw cloudBackupOperationError(locale, messageKey, "CLOUD_BACKUP_DELETE_FAILED", error);
    });
  }
  return json(cloudBackupDeleteSnapshotResponseSchema.parse({ ok: true }));
}

export async function runDueCloudBackups(env: Env, now = new Date()): Promise<void> {
  const groups = new Map<string, { user: UserRow; targets: ConfiguredCloudBackupTarget[] }>();
  for (let offset = 0; ; offset += CLOUD_BACKUP_PAGE_SIZE) {
    const rows = await env.DB.prepare(`
      SELECT ${CLOUD_BACKUP_CONFIG_COLUMNS} FROM cloud_backup_targets
      WHERE schedule_enabled = 1
      ORDER BY updated_at ASC
      LIMIT ? OFFSET ?
    `).bind(CLOUD_BACKUP_PAGE_SIZE, offset).all<CloudBackupTargetRow>();
    for (const row of rows.results) {
      const target = rowToTarget(row);
      const user = await env.DB.prepare("SELECT id, email, name, role, banned, ban_reason, password_hash, reset_token_hash, reset_token_expires_at, created_at, updated_at FROM users WHERE id = ? LIMIT 1")
        .bind(target.userId)
        .first<UserRow>();
      if (!user || user.banned === 1) {
        await markCloudBackupStatus(env, target.userId, target.provider, "failed", "CLOUD_BACKUP_USER_UNAVAILABLE");
        continue;
      }
      const settings = await getSettings(env, target.userId).catch(() => createDefaultFallbackSettings());
      if (!cloudBackupTargetDue(target, settings.timezone, now)) continue;
      if (!(await acquireCloudBackupLock(env, target.userId, target.provider, now))) continue;
      try {
        const configuredTarget = configuredTargetFromResolvedTarget(target, requestLocaleFromDefault());
        const group = groups.get(target.userId) ?? { user, targets: [] };
        group.targets.push(configuredTarget);
        groups.set(target.userId, group);
      } catch (error) {
        await markCloudBackupStatus(env, target.userId, target.provider, "failed", persistedCloudBackupErrorMessage(error));
      }
    }
    if (rows.results.length < CLOUD_BACKUP_PAGE_SIZE) break;
  }
  for (const [userId, group] of groups) {
    if (group.targets.length === 0) continue;
    let payload: CloudBackupSnapshotPayload;
    try {
      payload = await buildCloudBackupSnapshotPayload(env, userId);
    } catch (error) {
      for (const target of group.targets) {
        await markCloudBackupStatus(env, userId, target.provider, "failed", persistedCloudBackupErrorMessage(error));
      }
      continue;
    }
    for (const target of group.targets) {
      try {
        await uploadCloudBackupSnapshotToTarget(env, userId, payload, target);
      } catch (error) {
        await markCloudBackupStatus(env, userId, target.provider, "failed", persistedCloudBackupErrorMessage(error));
      }
    }
  }
}

function requestLocaleFromDefault(): AppLocale {
  return DEFAULT_SERVER_I18N_LOCALE;
}

async function configuredCloudBackupTargets(env: Env, userId: string, locale: AppLocale): Promise<{
  config: ResolvedCloudBackupConfig;
  targets: CloudBackupTarget[];
}> {
  const config = await getCloudBackupConfig(env, userId);
  const targets = cloudBackupTargetsForConfig(config);
  if (targets.length === 0) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_TARGET_REQUIRED");
  return { config, targets };
}

async function configuredCloudBackupClientForProvider(env: Env, userId: string, provider: CloudBackupProvider, locale: AppLocale): Promise<CloudBackupRemoteClient> {
  return (await configuredCloudBackupTargetForProvider(env, userId, provider, locale)).client;
}

async function configuredCloudBackupTargetForProvider(env: Env, userId: string, provider: CloudBackupProvider, locale: AppLocale): Promise<ConfiguredCloudBackupTarget> {
  const config = await getCloudBackupConfig(env, userId);
  const target = cloudBackupTargetForProvider(config, provider)[0];
  if (!target) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_TARGET_REQUIRED");
  return target;
}

function remoteClientForProvider(config: ResolvedCloudBackupConfig, provider: CloudBackupProvider, locale: AppLocale): CloudBackupRemoteClient {
  const target = config.targets[provider];
  if (!target) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_TARGET_REQUIRED");
  return remoteClientForTarget(target, locale);
}

function remoteClientForTarget(target: ResolvedCloudBackupTarget, locale: AppLocale): CloudBackupRemoteClient {
  if (target.provider === "webdav") {
    if (!target.webdav) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_WEBDAV_REQUIRED");
    if (!target.credential.webdavPassword?.trim()) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_WEBDAV_CREDENTIAL_REQUIRED");
    return new WebDAVCloudBackupClient(target.webdav, target.credential.webdavPassword);
  }
  if (!target.s3) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_S3_REQUIRED");
  if (!target.s3.accessKeyId?.trim() || !target.credential.s3SecretAccessKey?.trim()) {
    throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_S3_CREDENTIAL_REQUIRED");
  }
  return new S3CloudBackupClient(target.s3, target.credential.s3SecretAccessKey);
}

function cloudBackupTargetsForConfig(config: ResolvedCloudBackupConfig): CloudBackupTarget[] {
  // 只有配置完整且密钥已保存的 provider 才参与多目标备份；未配置目标不能阻断另一目标。
  return cloudBackupTargetProvidersForConfig(config).flatMap((provider) => cloudBackupTargetForProvider(config, provider));
}

function cloudBackupTargetProvidersForConfig(config: ResolvedCloudBackupConfig): CloudBackupProvider[] {
  const providers: CloudBackupProvider[] = [];
  if (config.provider === "webdav" || config.provider === "s3") providers.push(config.provider);
  for (const provider of ["webdav", "s3"] as const) {
    if (provider !== config.provider) providers.push(provider);
  }
  return providers;
}

function cloudBackupTargetForProvider(config: ResolvedCloudBackupConfig, provider: CloudBackupProvider): ConfiguredCloudBackupTarget[] {
  try {
    const target = config.targets[provider];
    if (!target) return [];
    return [configuredTargetFromResolvedTarget(target, requestLocaleFromDefault())];
  } catch {
    return [];
  }
}

function configuredTargetFromResolvedTarget(target: ResolvedCloudBackupTarget, locale: AppLocale): ConfiguredCloudBackupTarget {
  return { provider: target.provider, client: remoteClientForTarget(target, locale), retention: target.policy.retention };
}

async function getCloudBackupConfig(env: Env, userId: string): Promise<ResolvedCloudBackupConfig> {
  const rows = await env.DB.prepare(`SELECT ${CLOUD_BACKUP_CONFIG_COLUMNS} FROM cloud_backup_targets WHERE user_id = ? ORDER BY updated_at DESC`).bind(userId).all<CloudBackupTargetRow>();
  const config = defaultConfig(userId);
  for (const row of rows.results) {
    const target = rowToTarget(row);
    config.targets[target.provider] = target;
    if (!config.updatedAt || (target.updatedAt && target.updatedAt > config.updatedAt)) {
      config.updatedAt = target.updatedAt;
      config.provider = target.provider;
    }
  }
  return config;
}

async function getCloudBackupTarget(env: Env, userId: string, provider: CloudBackupProvider): Promise<ResolvedCloudBackupTarget> {
  const row = await env.DB.prepare(`SELECT ${CLOUD_BACKUP_CONFIG_COLUMNS} FROM cloud_backup_targets WHERE user_id = ? AND provider = ? LIMIT 1`).bind(userId, provider).first<CloudBackupTargetRow>();
  return row ? rowToTarget(row) : defaultTarget(userId, provider);
}

async function saveCloudBackupConfig(env: Env, userId: string, body: CloudBackupConfigUpdate): Promise<ResolvedCloudBackupConfig> {
  const current = await getCloudBackupTarget(env, userId, body.provider);
  const next = targetFromUpdate(userId, body, current);
  const timestamp = nowIso();
  // user+provider 是 D1 唯一写入边界；credential_json 永远独立存储并由 DTO 脱敏成 credentialSet。
  await env.DB.prepare(`
    INSERT INTO cloud_backup_targets (
      user_id, provider, config_json, credential_json, schedule_enabled, schedule_frequency, schedule_time,
      schedule_weekday, retention, last_status, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      config_json = excluded.config_json,
      credential_json = excluded.credential_json,
      schedule_enabled = excluded.schedule_enabled,
      schedule_frequency = excluded.schedule_frequency,
      schedule_time = excluded.schedule_time,
      schedule_weekday = excluded.schedule_weekday,
      retention = excluded.retention,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    next.provider,
    JSON.stringify(storedConfigFromTarget(next)),
    JSON.stringify(next.credential),
    boolToInt(next.policy.scheduleEnabled),
    next.policy.scheduleFrequency,
    next.policy.scheduleTime,
    next.policy.scheduleWeekday,
    next.policy.retention,
    timestamp,
    timestamp,
  ).run();
  return await getCloudBackupConfig(env, userId);
}

function rowToTarget(row: CloudBackupTargetRow): ResolvedCloudBackupTarget {
  const stored = parseJsonObject<StoredCloudBackupConfig>(row.config_json);
  const webdavResult = stored.webdav ? cloudBackupWebDavConfigSchema.safeParse(stored.webdav) : null;
  const s3Result = stored.s3 ? cloudBackupS3ConfigSchema.safeParse(stored.s3) : null;
  const webdav = webdavResult?.success ? webdavResult.data : undefined;
  const s3 = s3Result?.success ? s3Result.data : undefined;
  return {
    row,
    userId: row.user_id,
    provider: row.provider,
    credential: parseJsonObject<StoredCloudBackupCredential>(row.credential_json),
    policy: cloudBackupPolicySchema.parse({
      scheduleEnabled: row.schedule_enabled === 1,
      scheduleFrequency: row.schedule_frequency || "daily",
      scheduleTime: row.schedule_time || CLOUD_BACKUP_DEFAULT_SCHEDULE_TIME,
      scheduleWeekday: row.schedule_weekday || CLOUD_BACKUP_DEFAULT_SCHEDULE_WEEKDAY,
      retention: row.retention > 0 ? row.retention : CLOUD_BACKUP_DEFAULT_RETENTION,
    }),
    lastBackupAt: row.last_backup_at,
    lastStatus: row.last_status || "idle",
    lastError: row.last_error,
    lockedUntil: row.locked_until,
    updatedAt: row.updated_at,
    ...(webdav ? { webdav } : {}),
    ...(s3 ? { s3 } : {}),
  };
}

function defaultConfig(userId: string): ResolvedCloudBackupConfig {
  return {
    userId,
    provider: "webdav",
    targets: {},
    updatedAt: null,
  };
}

function defaultTarget(userId: string, provider: CloudBackupProvider): ResolvedCloudBackupTarget {
  return {
    row: null,
    userId,
    provider,
    credential: {},
    policy: cloudBackupPolicySchema.parse({}),
    lastBackupAt: null,
    lastStatus: "idle",
    lastError: null,
    lockedUntil: null,
    updatedAt: null,
  };
}

function targetFromUpdate(userId: string, body: CloudBackupConfigUpdate, current: ResolvedCloudBackupTarget): ResolvedCloudBackupTarget {
  const credential = { ...current.credential };
  // provider 行是本次保存的写入边界；另一个目标有独立 D1 行，避免策略、状态或 secret 串目标。
  if (body.provider === "webdav" && body.credentials?.webdavPassword?.trim()) credential.webdavPassword = body.credentials.webdavPassword;
  if (body.provider === "s3" && body.credentials?.s3SecretAccessKey?.trim()) credential.s3SecretAccessKey = body.credentials.s3SecretAccessKey;
  const next: ResolvedCloudBackupTarget = {
    ...current,
    userId,
    provider: body.provider,
    credential,
    policy: body.policy,
  };
  if (body.provider === "webdav" && body.webdav) {
    const { s3: _s3, ...withoutS3 } = next;
    return { ...withoutS3, webdav: body.webdav };
  }
  if (body.provider === "s3" && body.s3) {
    const { webdav: _webdav, ...withoutWebDAV } = next;
    return { ...withoutWebDAV, s3: body.s3 };
  }
  return next;
}

function toConfigDTO(config: ResolvedCloudBackupConfig): CloudBackupConfig {
  return cloudBackupConfigResponseSchema.parse({
    config: {
      provider: config.provider,
      ...(config.targets.webdav?.webdav ? { webdav: config.targets.webdav.webdav } : {}),
      ...(config.targets.s3?.s3 ? { s3: config.targets.s3.s3 } : {}),
      credentialSet: credentialSet(config),
      credentialSetByProvider: credentialSetByProvider(config),
      policyByProvider: {
        webdav: config.targets.webdav?.policy ?? cloudBackupPolicySchema.parse({}),
        s3: config.targets.s3?.policy ?? cloudBackupPolicySchema.parse({}),
      },
      statusByProvider: {
        webdav: statusForTarget(config.targets.webdav),
        s3: statusForTarget(config.targets.s3),
      },
      updatedAt: config.updatedAt,
    },
  }).config;
}

function credentialSet(config: ResolvedCloudBackupConfig): boolean {
  return credentialSetForTarget(config.targets[config.provider]);
}

function credentialSetByProvider(config: ResolvedCloudBackupConfig): CloudBackupCredentialState {
  return {
    webdav: credentialSetForTarget(config.targets.webdav),
    s3: credentialSetForTarget(config.targets.s3),
  };
}

async function createCloudBackupForUserProvider(env: Env, user: UserRow, locale: AppLocale, provider: CloudBackupProvider): Promise<CloudBackupSnapshot[]> {
  const config = await getCloudBackupConfig(env, user.id);
  const target = cloudBackupTargetForProvider(config, provider)[0];
  if (!target) throw new HttpError(400, serverText(locale, "cloudBackup.configIncomplete"), "CLOUD_BACKUP_TARGET_REQUIRED");
  const payload = await buildCloudBackupSnapshotPayload(env, user.id);
  return [await uploadCloudBackupSnapshotToTarget(env, user.id, payload, target)];
}

async function buildCloudBackupSnapshotPayload(env: Env, userId: string): Promise<CloudBackupSnapshotPayload> {
  const { content, exportedAt } = await buildCloudBackupExportZip(env, userId);
  if (content.length > CLOUD_BACKUP_MAX_SNAPSHOT_BYTES) throw new Error("CLOUD_BACKUP_SNAPSHOT_TOO_LARGE");
  const id = snapshotId(exportedAt);
  const filename = `${id}.zip`;
  const manifest = cloudBackupSnapshotManifestSchema.parse({
    kind: "renewlet-cloud-backup-snapshot",
    schemaVersion: 1,
    id,
    filename,
    createdAt: exportedAt.toISOString(),
    sizeBytes: content.length,
    sha256: await sha256Hex(content),
    exportKind: "renewlet-export",
    exportSchemaVersion: 1,
  });
  return { content, id, filename, manifest };
}

async function uploadCloudBackupSnapshotToTarget(env: Env, userId: string, payload: CloudBackupSnapshotPayload, target: ConfiguredCloudBackupTarget): Promise<CloudBackupSnapshot> {
  // 远端快照只以 sidecar manifest 为可信索引；下载时仍会重算 sha256，坏包不能进入导入预览。
  await target.client.upload(payload.filename, payload.content, payload.manifest);
  await enforceRetention(target.client, target.retention, payload.id);
  await markCloudBackupSuccess(env, userId, target.provider, payload.manifest.createdAt);
  return snapshotFromManifest(target.provider, payload.manifest);
}

async function buildCloudBackupExportZip(env: Env, userId: string): Promise<{ content: Uint8Array; exportedAt: Date }> {
  const exportedAt = new Date();
  const subscriptions = await listSubscriptions(env, userId);
  const assets: ExportAsset[] = [];
  const exportSubscriptions = [];
  for (const row of subscriptions) {
    const subscription = { ...toApiSubscription(row) };
    const assetId = privateAssetIdFromLogo(subscription.logo ?? null);
    if (assetId) {
      const asset = await readExportAsset(env, userId, assetId);
      if (asset) {
        subscription.logo = asset.path;
        assets.push(asset);
      } else {
        delete subscription.logo;
      }
    }
    exportSubscriptions.push(subscription);
  }
  // 云备份使用业务恢复 allowlist 组包；sessions/MFA/passkey/tickets 和 R2 系统密钥对象都不进入 ZIP。
  const payload = renewletExportV1Schema.parse({
    kind: "renewlet-export",
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    data: {
      subscriptions: exportSubscriptions,
      settings: sanitizeSettingsForCloudBackup(await getSettings(env, userId)),
      customConfig: await getCustomConfig(env, userId),
      ...(assets.length > 0
        ? { assets: assets.map(({ content: _content, ...asset }) => asset) }
        : {}),
    },
  });
  const zipEntries = [
    ...assets.map((asset) => ({ name: asset.path, data: asset.content, date: exportedAt })),
    { name: "data.json", data: textEncoder.encode(JSON.stringify(payload, null, 2)), date: exportedAt },
    {
      name: "manifest.json",
      data: textEncoder.encode(JSON.stringify({
        kind: payload.kind,
        schemaVersion: payload.schemaVersion,
        exportedAt: payload.exportedAt,
        subscriptions: payload.data.subscriptions.length,
        assets: assets.length,
      }, null, 2)),
      date: exportedAt,
    },
  ];
  return { content: createStoredZip(zipEntries, exportedAt), exportedAt };
}

export function sanitizeSettingsForCloudBackup(settings: ApiAppSettings): Partial<ApiAppSettings> {
  const sanitized = { ...settings } as Partial<ApiAppSettings> & Record<string, unknown>;
  // 普通云快照用于恢复订阅数据，不是 secrets 备份；新增外部通知字段必须进入这组剔除边界。
  for (const key of SECRET_SETTING_KEYS) delete sanitized[key];
  if (sanitized.aiRecognition) {
    sanitized.aiRecognition = {
      ...sanitized.aiRecognition,
      baseUrl: "",
      apiKey: "",
    };
  }
  return sanitized;
}

async function readExportAsset(env: Env, userId: string, assetId: string): Promise<ExportAsset | null> {
  const row = await getAsset(env, userId, assetId);
  if (!row) return null;
  const object = await env.ASSETS_BUCKET.get(row.r2_key);
  if (!object) return null;
  if (row.size_bytes !== null && row.size_bytes > CLOUD_BACKUP_MAX_SNAPSHOT_BYTES) return null;
  const content = new Uint8Array(await object.arrayBuffer());
  if (content.length > CLOUD_BACKUP_MAX_SNAPSHOT_BYTES) return null;
  const mimeType = row.mime_type ?? object.httpMetadata?.contentType ?? "application/octet-stream";
  return {
    id: assetId,
    path: `assets/${assetId}${extensionFromMime(mimeType, row.original_name ?? "")}`,
    ...(row.original_name ? { originalName: row.original_name } : {}),
    mimeType,
    sizeBytes: content.length,
    content,
  };
}

async function verifySnapshotBytes(content: Uint8Array, manifest: CloudBackupSnapshotManifest): Promise<boolean> {
  if (manifest.kind !== "renewlet-cloud-backup-snapshot" || manifest.schemaVersion !== 1) return false;
  if (manifest.sizeBytes !== content.length) return false;
  return (await sha256Hex(content)) === manifest.sha256.toLowerCase();
}

async function downloadCloudBackupWithoutProvider(env: Env, userId: string, locale: AppLocale, id: string): Promise<{ content: Uint8Array; manifest: CloudBackupSnapshotManifest }> {
  const { targets } = await configuredCloudBackupTargets(env, userId, locale);
  return await downloadCloudBackupFromTargets(targets, id);
}

async function deleteCloudBackupWithoutProvider(env: Env, userId: string, locale: AppLocale, id: string): Promise<void> {
  const { targets } = await configuredCloudBackupTargets(env, userId, locale);
  await deleteCloudBackupFromTargets(targets, id);
}

async function enforceRetention(client: CloudBackupRemoteClient, retention: number, keepId: string): Promise<void> {
  const manifests = await client.list().catch(() => []);
  manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (let index = 0; index < manifests.length; index += 1) {
    const manifest = manifests[index]!;
    if (index < retention || manifest.id === keepId) continue;
    await client.delete(manifest.id);
  }
}

async function markCloudBackupSuccess(env: Env, userId: string, provider: CloudBackupProvider, backupAt: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE cloud_backup_targets
    SET last_backup_at = ?, last_status = 'success', last_error = NULL, locked_until = NULL, updated_at = ?
    WHERE user_id = ? AND provider = ?
  `).bind(backupAt, nowIso(), userId, provider).run();
}

async function markCloudBackupStatus(env: Env, userId: string, provider: CloudBackupProvider, status: "idle" | "success" | "failed", message: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE cloud_backup_targets
    SET last_status = ?, last_error = ?, locked_until = NULL, updated_at = ?
    WHERE user_id = ? AND provider = ?
  `).bind(status, message.slice(0, 2000), nowIso(), userId, provider).run();
}

async function acquireCloudBackupLock(env: Env, userId: string, provider: CloudBackupProvider, now: Date): Promise<boolean> {
  const lockedUntil = new Date(now.getTime() + CLOUD_BACKUP_LOCK_MS).toISOString();
  // D1 没有 SELECT FOR UPDATE；provider 级条件 UPDATE 是 scheduled tick 防重入的最终锁边界。
  const result = await env.DB.prepare(`
    UPDATE cloud_backup_targets SET locked_until = ?, updated_at = ?
    WHERE user_id = ? AND provider = ? AND (locked_until IS NULL OR locked_until = '' OR locked_until <= ?)
  `).bind(lockedUntil, nowIso(), userId, provider, now.toISOString()).run();
  return (result.meta.changes ?? 0) > 0;
}

function snapshotsFromManifests(provider: CloudBackupProvider, manifests: CloudBackupSnapshotManifest[]): CloudBackupSnapshot[] {
  return manifests
    .map((manifest) => snapshotFromManifest(provider, manifest))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function snapshotFromManifest(provider: CloudBackupProvider, manifest: CloudBackupSnapshotManifest): CloudBackupSnapshot {
  return {
    id: manifest.id,
    filename: manifest.filename,
    provider,
    createdAt: manifest.createdAt,
    sizeBytes: manifest.sizeBytes,
    sha256: manifest.sha256,
  };
}

function cloudBackupOperationError(locale: AppLocale, messageKey: ServerTextKey, fallbackCode: string, error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof CloudBackupRemoteError) {
    // 操作层 code 保持稳定，provider 细节只放 details；否则测试连接/列表/下载的错误语义会被底层 SDK code 打散。
    return new HttpError(400, serverText(locale, messageKey), fallbackCode, error.details);
  }
  return new HttpError(400, serverText(locale, messageKey), fallbackCode, cloudBackupLocalErrorDetails(error));
}

function persistedCloudBackupErrorMessage(error: unknown): string {
  if (error instanceof CloudBackupRemoteError) {
    return error.code;
  }
  return "local_sdk_error";
}

function cloudBackupLocalErrorDetails(error: unknown): CloudBackupErrorDetails {
  return { rawResponseText: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function credentialSetForTarget(target: ResolvedCloudBackupTarget | undefined): boolean {
  if (!target) return false;
  if (target.provider === "webdav") return Boolean(target.credential.webdavPassword?.trim());
  return Boolean(target.credential.s3SecretAccessKey?.trim());
}

function statusForTarget(target: ResolvedCloudBackupTarget | undefined) {
  return {
    lastBackupAt: target?.lastBackupAt ?? null,
    lastStatus: target?.lastStatus ?? "idle",
    lastError: target?.lastError ?? null,
    updatedAt: target?.updatedAt ?? null,
  };
}

function storedConfigFromTarget(target: ResolvedCloudBackupTarget): StoredCloudBackupConfig {
  return {
    ...(target.webdav ? { webdav: target.webdav } : {}),
    ...(target.s3 ? { s3: target.s3 } : {}),
  };
}
