#!/usr/bin/env node

/**
 * @file 本地开发库订阅 Demo Seed 脚本。
 *
 * 职责：作为 seed 编排器读取环境变量、完成 PocketBase 鉴权、合并 settings，并把
 * 100 条开发者订阅 demo 以幂等 upsert 的方式写入当前用户。
 *
 * 架构：本地 Go server/PocketBase 提供 API；前端 Dashboard、Subscriptions、Statistics
 * 读取 settings/subscriptions。settings 影响主题、币种和预算，subscriptions 影响统计、续费提醒和筛选。
 *
 * 使用方式：
 * 1. 启动本地后端：pnpm --dir packages/server start
 * 2. 另开终端运行：
 *    ```bash
 *    PB_URL=http://127.0.0.1:3000 \
 *    RENEWLET_EMAIL='你的邮箱' \
 *    RENEWLET_PASSWORD='你的密码' \
 *    node scripts/seed-developer-subscriptions.mjs
 *    ```
 * 3. 可选：追加 RENEWLET_LOCALE=zh-CN 或 RENEWLET_LOCALE=en-US 覆盖界面语言。
 *
 * 外部依赖：PocketBase REST API、Node.js fetch/URLSearchParams/Intl、TheSVG CDN。
 *
 * 流程：env -> validate fixtures -> auth -> settings merge -> list subscriptions -> seedKey/slug index
 *      -> create|patch demo records -> delete stale demo records -> summary。
 *
 * Caveat：不要把 seedKey 改成通用字段名；删除逻辑依赖它隔离真实用户数据。
 * Caveat：新增订阅字段时，需要同步 PocketBase schema、前端 Zod schema、toSubscriptionPayload。
 */

import { DEVELOPER_SUBSCRIPTION_FIXTURES, PRICE_CHECKED_AT } from "./data/developer-subscriptions.mjs";
import { buildDemoSubscriptions } from "./lib/developer-subscription-fixtures.mjs";
import { DEFAULT_SEED_WRITE_DELAY_MS, createSeedApi, parseSeedWriteDelayMs } from "./lib/seed-api.mjs";

const DEFAULT_PB_URL = "http://127.0.0.1:3000";
const SEED_KEY = "developer-subscriptions-demo-v1";
const SCRIPT_NAME = "scripts/seed-developer-subscriptions.mjs";
const LOGO_CDN = "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons";
let api = createSeedApi({ writeDelayMs: DEFAULT_SEED_WRITE_DELAY_MS });

/**
 * 新用户没有 settings 记录时才使用完整默认值；已有记录只合并展示字段。
 * settings JSON 同时承载通知密钥、SMTP 等敏感信息，脚本不能为了截图重置真实通知配置。
 */
const DEFAULT_SETTINGS = {
  adminUsername: "Renewlet Demo",
  themeMode: "dark",
  themeVariant: "emerald",
  themeCustomColor: { h: 160, s: 84, l: 39 },
  locale: "zh-CN",
  showExpired: true,
  defaultCurrency: "USD",
  exchangeRateProvider: "floatrates",
  monthlyBudget: 450,
  timezone: localTimeZone(),
  notificationTimeLocal: "08:30",
  enabledChannels: ["email"],
  testPhone: "",
  telegramBotToken: "123456789:demo-token-for-screenshots",
  telegramChatId: "987654321",
  notifyxApiKey: "napi_demo_readme_screenshots",
  webhookUrl: "https://example.com/renewlet/webhook",
  webhookMethod: "POST",
  webhookHeaders: "{\"X-Renewlet-Demo\":\"readme\"}",
  webhookPayload: "{\"title\":\"{title}\",\"content\":\"{content}\",\"timestamp\":\"{timestamp}\"}",
  wechatWebhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000-0000-0000-000000000000",
  wechatMessageType: "text",
  wechatAddModeTag: true,
  wechatAtPhones: "13800000000",
  wechatAtAll: false,
  smtpHost: "smtp.example.com",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "renewlet-demo",
  smtpPassword: "demo-password",
  smtpFrom: "Renewlet <notify@example.com>",
  smtpReplyTo: "ops@example.com",
  notifyMultipleAddresses: false,
  recipientEmail: "developer@example.com",
  barkServerUrl: "https://api.day.app",
  barkDeviceKey: "demoDeviceKeyForReadme",
  barkSilentPush: false,
};

/**
 * Demo 数据以“稳定 slug + 官方价格快照”作为维护单元。价格/来源放在 data 文件；
 * 续费日、付款方式、状态只负责截图和本地验收的分布，不伪装成真实个人账单。
 */
const DEMO_SUBSCRIPTIONS = buildDemoSubscriptions(DEVELOPER_SUBSCRIPTION_FIXTURES);

function usage() {
  console.log(`
Seed developer demo subscriptions into a local Renewlet/PocketBase database.

Usage:
  PB_URL=http://127.0.0.1:3000 \\
  RENEWLET_EMAIL=you@example.com \\
  RENEWLET_PASSWORD=your-password \\
  node ${SCRIPT_NAME}

Optional:
  RENEWLET_LOCALE=zh-CN|en-US  Override the UI locale setting.
  RENEWLET_SEED_WRITE_DELAY_MS=300  Delay between PocketBase collection writes; use 0 to opt out.
  --validate-only              Validate the 100 public-pricing fixtures without connecting to PocketBase.

The script upserts only records marked with extra.seedKey="${SEED_KEY}".
It does not delete or modify your unmarked real subscriptions.
`);
}

/**
 * 脚本入口按“先鉴权、再设置、再订阅”的顺序串行执行。
 * 不并发的原因：settings/subscriptions 都依赖 userId，且 upsert/delete 必须基于同一次 demo 索引；
 * 本地人工 seed 更重视确定性和错误可读性，而不是吞吐。
 */
async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  if (process.argv.includes("--validate-only")) {
    console.log(`Validated ${DEMO_SUBSCRIPTIONS.length} developer subscription fixtures.`);
    console.log(`Price snapshot: ${PRICE_CHECKED_AT}`);
    return;
  }

  const pbUrl = normalizeBaseUrl(process.env.PB_URL || DEFAULT_PB_URL);
  const email = requiredEnv("RENEWLET_EMAIL");
  const password = requiredEnv("RENEWLET_PASSWORD");
  const locale = optionalLocale(process.env.RENEWLET_LOCALE);
  const writeDelayMs = parseSeedWriteDelayMs(process.env.RENEWLET_SEED_WRITE_DELAY_MS);
  api = createSeedApi({ writeDelayMs });

  console.log(`Renewlet demo seed`);
  console.log(`PocketBase: ${pbUrl}`);
  console.log(`Seed key:   ${SEED_KEY}`);
  console.log(`Write delay: ${writeDelayMs}ms`);

  const auth = await authenticate(pbUrl, email, password);
  const token = auth.token;
  const userId = auth.record?.id;
  if (!token || !userId) {
    throw new Error("Authentication succeeded but PocketBase did not return token/record.id.");
  }
  console.log(`Authenticated user: ${auth.record.email || email} (${userId})`);

  const settingsAction = await upsertSettings(pbUrl, token, userId, locale);
  const result = await upsertSubscriptions(pbUrl, token, userId);

  console.log("");
  console.log(`Settings:      ${settingsAction}`);
  console.log(`Created:       ${result.created}`);
  console.log(`Updated:       ${result.updated}`);
  console.log(`Deleted stale: ${result.deleted}`);
  console.log(`Demo records:  ${DEMO_SUBSCRIPTIONS.length}`);
  console.log("");
  console.log("Done. Open /subscriptions, /, and /statistics in the local client to review the seeded data.");
}

/** 使用用户 collection 的密码登录接口获取 bearer token 和当前用户 id。 */
async function authenticate(pbUrl, email, password) {
  return api(pbUrl, "/api/collections/users/auth-with-password", {
    method: "POST",
    body: { identity: email, password },
  });
}

/**
 * 更新演示所需的展示设置。
 *
 * 边界控制：RENEWLET_LOCALE 未提供时不覆盖已有语言；已有 settings 只浅合并主题、币种、预算；
 * 不写空字符串到通知密钥字段，避免清掉用户已有 webhook/SMTP/Bark 配置。
 *
 * Caveat：这里的字段必须与 DEFAULT_SETTINGS、前端 settings schema 保持兼容；
 * 如果前端把 settings 改成更细粒度的 collection，脚本也要跟着拆分写入。
 */
async function upsertSettings(pbUrl, token, userId, locale) {
  const rows = await listRecords(pbUrl, token, "settings", `user = "${userId}"`, 1);
  const record = rows[0];
  const displayPatch = {
    adminUsername: "Renewlet Demo",
    themeMode: "dark",
    themeVariant: "emerald",
    themeCustomColor: { h: 160, s: 84, l: 39 },
    showExpired: true,
    defaultCurrency: "USD",
    exchangeRateProvider: "floatrates",
    monthlyBudget: 450,
  };
  if (locale) displayPatch.locale = locale;

  if (record) {
    const current = isPlainObject(record.settings) ? record.settings : {};
    const next = { ...current, ...displayPatch };
    await api(pbUrl, `/api/collections/settings/records/${record.id}`, {
      method: "PATCH",
      token,
      body: { settings: next },
    });
    return locale ? `updated existing settings (${locale})` : "updated existing settings";
  }

  await api(pbUrl, "/api/collections/settings/records", {
    method: "POST",
    token,
    body: {
      user: userId,
      settings: {
        ...DEFAULT_SETTINGS,
        ...displayPatch,
        locale: locale || DEFAULT_SETTINGS.locale,
      },
    },
  });
  return locale ? `created settings (${locale})` : "created settings";
}

/**
 * 对 demo 订阅做幂等 upsert。
 *
 * 算法选择：一次性读取当前用户订阅，再在内存按 extra.seedKey/slug 建索引，避开 PocketBase
 * JSON 子字段过滤的版本差异，也避免 100 次查询。同 slug 重复时保留第一条并删除其余 demo。
 *
 * 并发说明：没有分布式锁；两个终端同时运行可能短暂重复，再单独运行一次会通过 cleanup 收敛。
 */
async function upsertSubscriptions(pbUrl, token, userId) {
  const existingRows = await listRecords(pbUrl, token, "subscriptions", `user = "${userId}"`, 500);
  const currentSlugs = new Set(DEMO_SUBSCRIPTIONS.map((item) => item.slug));
  const seededRows = existingRows.filter((row) => row.extra?.seedKey === SEED_KEY);
  const firstBySlug = new Map();
  const rowsToDelete = [];

  for (const row of seededRows) {
    const slug = typeof row.extra?.slug === "string" ? row.extra.slug : "";
    if (!currentSlugs.has(slug)) {
      rowsToDelete.push(row);
      continue;
    }
    if (firstBySlug.has(slug)) {
      rowsToDelete.push(row);
      continue;
    }
    firstBySlug.set(slug, row);
  }

  let created = 0;
  let updated = 0;
  for (const [index, item] of DEMO_SUBSCRIPTIONS.entries()) {
    const payload = toSubscriptionPayload(item, index + 1, userId);
    const existing = firstBySlug.get(item.slug);
    if (existing) {
      await api(pbUrl, `/api/collections/subscriptions/records/${existing.id}`, {
        method: "PATCH",
        token,
        body: payload,
      });
      updated += 1;
    } else {
      await api(pbUrl, "/api/collections/subscriptions/records", {
        method: "POST",
        token,
        body: payload,
      });
      created += 1;
    }
  }

  let deleted = 0;
  for (const row of rowsToDelete) {
    await api(pbUrl, `/api/collections/subscriptions/records/${row.id}`, {
      method: "DELETE",
      token,
    });
    deleted += 1;
  }

  return { created, updated, deleted };
}

/**
 * 把领域 demo 数据转换成 PocketBase subscriptions collection 的写入体。
 * 截图演示需要稳定的近期续费分布；如果交给前端/后端按 startDate 自动推算，月末、闰年和年付周期
 * 会让截图数据在不同日期重跑时漂移。
 *
 * 状态关联：tags/category/paymentMethod 影响筛选与统计分组；extra.seedKey/slug 不参与展示，
 * 但决定 upsert/delete 的数据安全边界。
 */
function toSubscriptionPayload(item, order, userId) {
  const trialEndDate = typeof item.trialEndOffsetDays === "number"
    ? dateFromToday(item.trialEndOffsetDays)
    : null;
  return {
    user: userId,
    name: item.name,
    logo: item.iconSlug ? `${LOGO_CDN}/${item.iconSlug}/default.svg` : null,
    price: item.price,
    currency: item.currency,
    billingCycle: item.billingCycle,
    customDays: null,
    category: item.category,
    status: item.status,
    paymentMethod: item.paymentMethod,
    startDate: dateFromToday(item.startOffsetDays),
    nextBillingDate: dateFromToday(item.nextOffsetDays),
    autoCalculateNextBillingDate: false,
    trialEndDate,
    website: item.website,
    notes: `${item.name} (${item.planLabel}) uses the official public price basis: ${item.priceBasis}. Checked ${PRICE_CHECKED_AT}. Demo data only; official pricing may change by region, tax, billing term, usage, seat count, and plan update.`,
    tags: item.tags,
    reminderDays: item.reminderDays,
    extra: {
      seedKey: SEED_KEY,
      slug: item.slug,
      order,
      source: "public-pricing-demo",
      sourceUrl: item.website,
      pricingSource: item.pricingSource,
      priceCheckedAt: PRICE_CHECKED_AT,
      planLabel: item.planLabel,
      priceBasis: item.priceBasis,
      priceSnapshot: {
        amount: item.price,
        currency: item.currency,
        billingCycle: item.billingCycle,
        planLabel: item.planLabel,
        basis: item.priceBasis,
      },
      updatedBy: SCRIPT_NAME,
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 分页读取 collection，统一处理 PocketBase list API 的 totalPages。
 * 脚本不引入 pocketbase npm 包，减少本地环境耦合；直接 REST 调用也更贴近 Go server 暴露的真实接口。
 *
 * PERF：如果未来 demo 数据量扩大到上千条，可以按 seedKey 做服务端过滤；当前选择客户端过滤是为了
 * 避开 JSON 子字段过滤在不同 PocketBase 版本间的兼容风险。
 */
async function listRecords(pbUrl, token, collection, filter, perPage = 500) {
  const items = [];
  let page = 1;
  let totalPages = 1;

  do {
    const query = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      filter,
    });
    const data = await api(pbUrl, `/api/collections/${collection}/records?${query.toString()}`, {
      method: "GET",
      token,
    });
    items.push(...(Array.isArray(data.items) ? data.items : []));
    totalPages = Number.isInteger(data.totalPages) && data.totalPages > 0 ? data.totalPages : 1;
    page += 1;
  } while (page <= totalPages);

  return items;
}

/** 环境变量在入口处 fail fast，防止脚本半途才发现账号缺失。 */
function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Missing required environment variable: ${name}`);
}

/** locale 只允许前端支持的两个值，避免写入后 settings schema 归一化回默认值造成误判。 */
function optionalLocale(value) {
  if (value === undefined || value === "") return null;
  if (value === "zh-CN" || value === "en-US") return value;
  throw new Error(`RENEWLET_LOCALE must be zh-CN or en-US, got: ${value}`);
}

/** 归一化 base URL，避免用户传入尾部斜杠时拼出双斜杠路径。 */
function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

/**
 * 使用 UTC date-only 生成 YYYY-MM-DD。
 *
 * 为什么不用本地 midnight：
 * Renewlet 的账单日期是 date-only 业务语义，不能让 Node 运行机的时区把日期推前/推后一天。
 */
function dateFromToday(offsetDays) {
  const now = new Date();
  const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

// 顶层兜底只负责把错误转成人可读输出；真正的恢复策略交给用户重新启动 server 或修正凭据。
main().catch((error) => {
  console.error("");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error("Tip: start the local backend first with `pnpm --dir packages/server start`.");
  process.exit(1);
});
