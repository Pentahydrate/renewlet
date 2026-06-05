import { z } from "zod";
import {
  importApplyRequestSchema,
  importApplyResponseSchema,
  IMPORT_APPLY_SUBSCRIPTION_LIMIT,
  importPreviewRequestSchema,
  importPreviewResponseSchema,
  type ImportConflictMode,
  type ImportPayload,
  type ImportPreviewItem,
  type ImportSummary,
  type ImportSubscription,
} from "@renewlet/shared/schemas/import-export";
import { appSettingsSchema } from "@renewlet/shared/schemas/settings";
import { customConfigSchema } from "@renewlet/shared/schemas/custom-config";
import { cleanBuiltInIconSourceSettingsPatch, mergeBuiltInIconSourceSettings } from "@renewlet/shared/built-in-icons";
import { getSettings, listSubscriptions, newId, nowIso, parseJsonObject } from "./db";
import { requestLocale, json, readJsonWithLimit, HttpError, type AppLocale } from "./http";
import { serverText } from "./server-i18n";
import { requireAuth } from "./auth";
import { normalizeSubscriptionBodyForStorage, subscriptionRowValues, toSubscriptionRow, type SubscriptionBody } from "./subscriptions";
import type { Env, SubscriptionRow } from "./types";

const INSERT_SUBSCRIPTION_SQL = `
  INSERT INTO subscriptions (
    id, user_id, name, logo, price, currency, billing_cycle, custom_days, custom_cycle_unit, category, status, pinned, payment_method,
    start_date, next_billing_date, auto_calculate_next_billing_date, trial_end_date, website, notes, tags_json,
    reminder_days, repeat_reminder_enabled, repeat_reminder_interval, repeat_reminder_window, extra_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SUBSCRIPTION_SQL = `
  UPDATE subscriptions SET
    name = ?, logo = ?, price = ?, currency = ?, billing_cycle = ?, custom_days = ?, custom_cycle_unit = ?, category = ?, status = ?,
    pinned = ?, payment_method = ?, start_date = ?, next_billing_date = ?, auto_calculate_next_billing_date = ?,
    trial_end_date = ?, website = ?, notes = ?, tags_json = ?, reminder_days = ?, repeat_reminder_enabled = ?,
    repeat_reminder_interval = ?, repeat_reminder_window = ?, extra_json = ?, updated_at = ?
  WHERE user_id = ? AND id = ?
`;

const IMPORT_JSON_LIMIT_BYTES = 50 * 1024 * 1024;
const IMPORT_WARNING_LOW_CONFIDENCE_KEY = "IMPORT_WARNING_LOW_CONFIDENCE_KEY";
const IMPORT_WARNING_LOW_CONFIDENCE_NAME_MATCHED = "IMPORT_WARNING_LOW_CONFIDENCE_NAME_MATCHED";

/** 导入预览只做当前用户范围内的冲突判断，不写 D1。 */
export async function previewImport(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJsonWithLimit(request, importPreviewRequestSchema, locale, IMPORT_JSON_LIMIT_BYTES);
  assertValidSkipIndexes(body.skipIndexes, body.payload.subscriptions.length, locale);
  const existing = await listSubscriptions(env, auth.user.id);
  return json(importPreviewResponseSchema.parse(publicPreview(buildPreview(body.payload, body.conflictMode, existing, body.skipIndexes))));
}

/** 应用导入会重新计算 preview，避免客户端篡改 action 结果后直接写库。 */
export async function applyImport(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  // apply 必须重新解析和预览请求体，不能信任浏览器上一轮 preview 的 action 结果。
  const body = await readJsonWithLimit(request, importApplyRequestSchema, locale, IMPORT_JSON_LIMIT_BYTES);
  assertApplyPayloadSize(body.payload.subscriptions.length, locale);
  // 导入只在当前登录用户范围内查重；payload 里的来源用户仅用于 extra.import 幂等键，不能变成 owner。
  assertValidSkipIndexes(body.skipIndexes, body.payload.subscriptions.length, locale);
  const existing = await listSubscriptions(env, auth.user.id);
  const preview = buildPreview(body.payload, body.conflictMode, existing, body.skipIndexes);
  if (preview.summary.errors > 0) {
    throw new HttpError(400, serverText(locale, "import.previewFailed"), "IMPORT_PREVIEW_FAILED", publicPreview(preview));
  }

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  const existingMatches = buildExistingImportMatches(existing);
  for (const item of preview.items) {
    if (item.action !== "create" && item.action !== "replace") continue;
    const source = preview.normalizedByIndex.get(item.index);
    if (!source) continue;
    const { row: existingRow } = resolveExistingImportMatch(existingMatches, source.extra.import, source);
    // import preview 已按 shared 写入 schema 收敛；apply 只消费这份 allowlist body，避免预览通过后 D1 写入才暴露字段错误。
    const row = toSubscriptionRow(
      existingRow?.id ?? newId("sub"),
      auth.user.id,
      source,
      existingRow?.created_at ?? timestamp,
      timestamp,
    );
    if (existingRow) {
      statements.push(env.DB.prepare(UPDATE_SUBSCRIPTION_SQL).bind(
        row.name,
        row.logo,
        row.price,
        row.currency,
        row.billing_cycle,
        row.custom_days,
        row.custom_cycle_unit,
        row.category,
        row.status,
        row.pinned,
        row.payment_method,
        row.start_date,
        row.next_billing_date,
        row.auto_calculate_next_billing_date,
        row.trial_end_date,
        row.website,
        row.notes,
        row.tags_json,
        row.reminder_days,
        row.repeat_reminder_enabled,
        row.repeat_reminder_interval,
        row.repeat_reminder_window,
        row.extra_json,
        timestamp,
        auth.user.id,
        existingRow.id,
      ));
    } else {
      statements.push(env.DB.prepare(INSERT_SUBSCRIPTION_SQL).bind(...subscriptionRowValues(row)));
    }
  }

  if (body.payload.settings) {
    const current = await getSettings(env, auth.user.id);
    const next = appSettingsSchema.parse({
      ...current,
      ...body.payload.settings,
      builtInIconSources: mergeBuiltInIconSourceSettings(current.builtInIconSources, cleanBuiltInIconSourceSettingsPatch(body.payload.settings.builtInIconSources)),
    });
    statements.push(env.DB.prepare(`
      INSERT INTO settings (user_id, settings_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
    `).bind(auth.user.id, JSON.stringify(next), timestamp, timestamp));
  }
  if (body.payload.customConfig) {
    const nextConfig = customConfigSchema.parse(body.payload.customConfig);
    statements.push(env.DB.prepare(`
      INSERT INTO custom_configs (user_id, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
    `).bind(auth.user.id, JSON.stringify(nextConfig), timestamp, timestamp));
  }

  if (statements.length > 0) {
    // D1 batch 在同一事务里执行；导入要么整体写入，要么让调用方看到明确失败。
    await env.DB.batch(statements);
  }
  return json(importApplyResponseSchema.parse({ ok: true, ...publicPreview(preview) }));
}

function assertApplyPayloadSize(count: number, locale: AppLocale): void {
  if (count > IMPORT_APPLY_SUBSCRIPTION_LIMIT) {
    throw new HttpError(400, serverText(locale, "import.invalid"), "IMPORT_TOO_MANY_SUBSCRIPTIONS");
  }
}

type PreviewResult = {
  summary: ImportSummary;
  items: ImportPreviewItem[];
  includesSettings: boolean;
  includesCustomConfig: boolean;
  normalizedByIndex: Map<number, NormalizedImportSubscription>;
};

type NormalizedImportSubscription = SubscriptionBody & { extra: ImportSubscription["extra"] };

function publicPreview(preview: PreviewResult): Omit<PreviewResult, "normalizedByIndex"> {
  const { normalizedByIndex: _normalizedByIndex, ...rest } = preview;
  return rest;
}

function buildPreview(payload: ImportPayload, conflictMode: ImportConflictMode, existing: SubscriptionRow[], skipIndexes: number[]): PreviewResult {
  const existingMatches = buildExistingImportMatches(existing);
  const skippedIndexes = new Set(skipIndexes);
  const seenPayloadKeys = new Set<string>();
  const normalizedByIndex = new Map<number, NormalizedImportSubscription>();
  const items = payload.subscriptions.map((subscription, index) => {
    const importKey = subscription.extra.import;
    const warnings: string[] = [];
    const errors: string[] = [];
    if (importKey.confidence === "low") {
      warnings.push(IMPORT_WARNING_LOW_CONFIDENCE_KEY);
    }
    if (skippedIndexes.has(index)) {
      return {
        index,
        name: subscription.name,
        source: importKey.source,
        sourceId: importKey.sourceId,
        action: "skip",
        warnings,
        errors,
      } satisfies ImportPreviewItem;
    }
    const keyString = importKeyString(importKey);
    if (seenPayloadKeys.has(keyString)) {
      // 同一个导入文件内部重复 sourceId 必须先失败；否则 replace 会把两条 payload 写到同一订阅上。
      errors.push("IMPORT_SOURCE_ID_DUPLICATE");
    }
    seenPayloadKeys.add(keyString);
    const normalized = normalizeImportSubscriptionForPreview(subscription);
    if (normalized.ok) {
      normalizedByIndex.set(index, normalized.body);
    } else {
      errors.push(normalized.error);
    }
    const { row: existingRow, fallback } = resolveExistingImportMatch(existingMatches, importKey, subscription);
    if (fallback) {
      // Wallos display:* 是低置信桥接，只给用户 warning；真正写入仍保留原 import key 方便后续精确替换。
      warnings.push(IMPORT_WARNING_LOW_CONFIDENCE_NAME_MATCHED);
    }
    const action = errors.length > 0 ? "error" : existingRow ? (conflictMode === "replace" ? "replace" : "skip") : "create";
    return {
      index,
      name: subscription.name,
      source: importKey.source,
      sourceId: importKey.sourceId,
      ...(existingRow ? { existingId: existingRow.id } : {}),
      action,
      warnings,
      errors,
    } satisfies ImportPreviewItem;
  });
  return {
    summary: summarize(items),
    items,
    includesSettings: Boolean(payload.settings),
    includesCustomConfig: Boolean(payload.customConfig),
    normalizedByIndex,
  };
}

function normalizeImportSubscriptionForPreview(subscription: ImportSubscription): { ok: true; body: NormalizedImportSubscription } | { ok: false; error: string } {
  try {
    return { ok: true, body: normalizeSubscriptionBodyForStorage(subscription) as NormalizedImportSubscription };
  } catch (error) {
    return { ok: false, error: importValidationErrorCode(error) };
  }
}

function importValidationErrorCode(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `IMPORT_SUBSCRIPTION_INVALID:${error.issues[0]?.path.join(".") || "payload"}`;
  }
  return "IMPORT_SUBSCRIPTION_INVALID";
}

function summarize(items: ImportPreviewItem[]): ImportSummary {
  return items.reduce<ImportSummary>((summary, item) => ({
    total: summary.total + 1,
    creates: summary.creates + (item.action === "create" ? 1 : 0),
    replaces: summary.replaces + (item.action === "replace" ? 1 : 0),
    skips: summary.skips + (item.action === "skip" ? 1 : 0),
    errors: summary.errors + (item.errors.length > 0 ? 1 : 0),
    warnings: summary.warnings + item.warnings.length,
  }), { total: 0, creates: 0, replaces: 0, skips: 0, errors: 0, warnings: 0 });
}

type ExistingImportMatches = {
  byKey: Map<string, SubscriptionRow>;
  lowConfidenceByName: Map<string, SubscriptionRow | null>;
};

function buildExistingImportMatches(rows: SubscriptionRow[]): ExistingImportMatches {
  const result: ExistingImportMatches = {
    byKey: new Map<string, SubscriptionRow>(),
    lowConfidenceByName: new Map<string, SubscriptionRow | null>(),
  };
  for (const row of rows) {
    // Renewlet 自导入要兼容“已有订阅还没有 extra.import”的当前数据；只在当前用户查询结果内按真实 id 建二级键。
    result.byKey.set(`renewlet:${row.id}`, row);
    const extra = parseJsonObject(row.extra_json);
    const importValue = extra["import"];
    if (!isImportKey(importValue)) continue;
    result.byKey.set(importKeyString(importValue), row);
    if (isLowConfidenceWallosKey(importValue)) {
      addLowConfidenceExisting(result, row);
    }
  }
  return result;
}

function addLowConfidenceExisting(matches: ExistingImportMatches, row: SubscriptionRow): void {
  const nameKey = lowConfidenceImportName(row.name);
  if (!nameKey) return;
  if (matches.lowConfidenceByName.has(nameKey)) {
    // 同名历史订阅不唯一时禁用名称兜底，宁可让用户手动处理，也不要误 replace。
    matches.lowConfidenceByName.set(nameKey, null);
    return;
  }
  matches.lowConfidenceByName.set(nameKey, row);
}

function resolveExistingImportMatch(
  matches: ExistingImportMatches,
  key: ImportSubscription["extra"]["import"],
  subscription: ImportSubscription,
): { row: SubscriptionRow | undefined; fallback: boolean } {
  const exact = matches.byKey.get(importKeyString(key));
  if (exact) return { row: exact, fallback: false };
  if (!isLowConfidenceWallosKey(key)) return { row: undefined, fallback: false };
  const fallback = matches.lowConfidenceByName.get(lowConfidenceImportName(subscription.name));
  return { row: fallback ?? undefined, fallback: Boolean(fallback) };
}

function isImportKey(value: unknown): value is ImportSubscription["extra"]["import"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record["source"] === "renewlet" || record["source"] === "wallos")
    && typeof record["sourceId"] === "string"
    && (record["confidence"] === undefined || record["confidence"] === "high" || record["confidence"] === "low");
}

function assertValidSkipIndexes(indexes: number[], subscriptionCount: number, locale: ReturnType<typeof requestLocale>): void {
  if (indexes.some((index) => index < 0 || index >= subscriptionCount)) {
    throw new HttpError(400, serverText(locale, "import.skipIndexInvalid"), "IMPORT_SKIP_INDEX_INVALID");
  }
}

function isLowConfidenceWallosKey(value: ImportSubscription["extra"]["import"]): boolean {
  return value.source === "wallos" && (value.confidence === "low" || value.sourceId.startsWith("display:"));
}

function lowConfidenceImportName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function importKeyString(value: ImportSubscription["extra"]["import"]): string {
  return `${value.source}:${value.sourceId}`;
}
