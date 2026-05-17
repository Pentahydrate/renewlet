#!/usr/bin/env node

/**
 * @file 本地开发库订阅 Demo Seed 脚本。
 *
 * 职责：通过 PocketBase collection REST API，把 20 条开发者订阅 demo 写入当前用户；
 * 使用 upsert 维护“脚本自己创建的数据”，供 README 截图、开源演示和本地验收复用。
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
 * 流程：env -> auth -> settings merge -> list subscriptions -> seedKey/slug index
 *      -> create|patch demo records -> delete stale demo records -> summary。
 *
 * Caveat：不要把 seedKey 改成通用字段名；删除逻辑依赖它隔离真实用户数据。
 * Caveat：新增订阅字段时，需要同步 PocketBase schema、前端 Zod schema、toSubscriptionPayload。
 * TODO：若要自动校验官方价格，可把 DEMO_SUBSCRIPTIONS 拆成 JSON 并加入来源校验任务。
 */

const DEFAULT_PB_URL = "http://127.0.0.1:3000";
const SEED_KEY = "developer-subscriptions-demo-v1";
const PRICE_CHECKED_AT = "2026-05-17";
const SCRIPT_NAME = "scripts/seed-developer-subscriptions.mjs";
const LOGO_CDN = "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

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
 * Demo 数据以“稳定 slug + 公开价格快照”作为维护单元。
 * 相对日期能保证“近期续费、试用中、年度订阅”
 * 始终分布在可见窗口内，而不会随着时间推移全部过期。
 *
 * Caveat：价格、计划名、年付/月付选项会变化。更新金额时请同时更新 priceNote、
 * pricingSource 和 PRICE_CHECKED_AT，避免 demo 看起来像真实账单凭证。
 */
const DEMO_SUBSCRIPTIONS = [
  demo("chatgpt-plus", "ChatGPT Plus", "openai", 20, "monthly", "ai_tools", "credit_card", 1, -274, "https://chatgpt.com", "https://help.openai.com/en/articles/6950777-chatgpt-plus", ["AI", "Writing", "Research"], "OpenAI public ChatGPT Plus plan price."),
  demo("claude-pro", "Claude Pro", "anthropic", 20, "monthly", "ai_tools", "credit_card", 4, -231, "https://claude.ai", "https://www.anthropic.com/pricing", ["AI", "Coding"], "Anthropic public Claude Pro monthly price."),
  demo("perplexity-pro", "Perplexity Pro", "perplexity", 20, "monthly", "ai_tools", "paypal", 8, -167, "https://www.perplexity.ai", "https://www.perplexity.ai/pricing", ["AI", "Search"], "Perplexity public Pro monthly price."),
  demo("github-copilot-pro", "GitHub Copilot Pro", "github", 10, "monthly", "developer_tools", "credit_card", 3, -390, "https://github.com/features/copilot", "https://github.com/features/copilot/plans", ["Code", "AI"], "GitHub public Copilot Pro monthly price."),
  {
    ...demo("cursor-pro", "Cursor Pro", "cursor", 20, "monthly", "developer_tools", "credit_card", 6, -32, "https://cursor.com", "https://cursor.com/pricing", ["Editor", "AI"], "Cursor public Pro monthly price."),
    status: "trial",
    trialEndOffsetDays: 2,
  },
  demo("jetbrains-ai-pro", "JetBrains AI Pro", "jetbrains", 10, "monthly", "developer_tools", "credit_card", 18, -123, "https://www.jetbrains.com/ai/", "https://www.jetbrains.com/ai/", ["IDE", "AI"], "JetBrains public AI Pro personal monthly price."),
  demo("raycast-pro", "Raycast Pro", "raycast", 10, "monthly", "productivity", "apple_pay", 20, -76, "https://www.raycast.com", "https://www.raycast.com/pricing", ["Launcher", "Mac"], "Raycast public Pro monthly price."),
  demo("vercel-pro", "Vercel Pro", "vercel", 20, "monthly", "hosting_domains", "credit_card", 13, -305, "https://vercel.com", "https://vercel.com/pricing", ["Hosting", "Frontend"], "Vercel public Pro monthly price."),
  demo("supabase-pro", "Supabase Pro", "supabase", 25, "monthly", "hosting_domains", "credit_card", 26, -198, "https://supabase.com", "https://supabase.com/pricing", ["Database", "Backend"], "Supabase public Pro monthly price."),
  demo("railway-pro", "Railway Pro", "railway", 20, "monthly", "hosting_domains", "credit_card", 28, -142, "https://railway.com", "https://docs.railway.com/pricing/plans", ["Hosting", "Backend"], "Railway public Pro plan price."),
  demo("netlify-pro", "Netlify Pro", "netlify", 20, "monthly", "hosting_domains", "credit_card", 23, -251, "https://www.netlify.com", "https://www.netlify.com/pricing/", ["Hosting", "Frontend"], "Netlify public Pro monthly price."),
  demo("digitalocean-droplet", "DigitalOcean Droplet", "digitalocean", 6, "monthly", "hosting_domains", "credit_card", 15, -420, "https://www.digitalocean.com", "https://www.digitalocean.com/pricing/droplets", ["VPS", "Infra"], "DigitalOcean Basic Droplet public entry monthly price."),
  demo("sentry-team", "Sentry Team", "sentry", 26, "monthly", "developer_tools", "credit_card", 17, -155, "https://sentry.io", "https://sentry.io/pricing/", ["Observability", "Errors"], "Sentry public Team annual-billing monthly price."),
  demo("postman-solo", "Postman Solo", "postman", 108, "annual", "developer_tools", "credit_card", 96, -269, "https://www.postman.com", "https://www.postman.com/pricing/", ["API", "Testing"], "Postman public Solo annual amount based on the $9/month billed annually plan."),
  demo("figma-professional", "Figma Professional", "figma", 20, "monthly", "design", "credit_card", 5, -333, "https://www.figma.com", "https://www.figma.com/pricing/", ["Design", "Collaboration"], "Figma public Professional monthly price."),
  demo("notion-plus", "Notion Plus", "notion", 10, "monthly", "productivity", "credit_card", 9, -214, "https://www.notion.com", "https://www.notion.com/pricing", ["Docs", "Knowledge"], "Notion public Plus monthly price."),
  demo("linear-basic", "Linear Basic", "linear", 10, "monthly", "business", "credit_card", 16, -118, "https://linear.app", "https://linear.app/pricing", ["Issues", "Planning"], "Linear public Basic monthly price."),
  demo("1password-individual", "1Password Individual", "1password", 47.88, "annual", "security_vpn", "credit_card", 201, -164, "https://1password.com", "https://1password.com/pricing", ["Security", "Passwords"], "1Password Individual public annual amount based on the $3.99/month annual plan."),
  demo("bitwarden-premium", "Bitwarden Premium", "bitwarden", 19.8, "annual", "security_vpn", "credit_card", 208, -157, "https://bitwarden.com", "https://bitwarden.com/pricing/", ["Security", "Passwords"], "Bitwarden Premium public annual price."),
  demo("upstash-redis-select", "Upstash Redis Select", "upstash", 10, "monthly", "hosting_domains", "credit_card", 2, -91, "https://upstash.com", "https://upstash.com/pricing", ["Redis", "Serverless"], "Upstash public Redis Select monthly price."),
];

/**
 * 创建数据描述对象，而不是直接写 PocketBase payload。
 * 保留“领域数据”和“API 写入 payload”的分层：前者便于维护价格来源和演示意图，
 * 后者集中处理 user、extra、日期格式等数据库边界字段，减少后续 schema 变更时漏改。
 */
function demo(slug, name, iconSlug, price, billingCycle, category, paymentMethod, nextOffsetDays, startOffsetDays, website, pricingSource, tags, priceNote) {
  return {
    slug,
    name,
    iconSlug,
    price,
    currency: "USD",
    billingCycle,
    category,
    status: "active",
    paymentMethod,
    nextOffsetDays,
    startOffsetDays,
    website,
    pricingSource,
    tags,
    priceNote,
    reminderDays: billingCycle === "annual" ? 14 : nextOffsetDays <= 8 ? 3 : 7,
  };
}

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

  const pbUrl = normalizeBaseUrl(process.env.PB_URL || DEFAULT_PB_URL);
  const email = requiredEnv("RENEWLET_EMAIL");
  const password = requiredEnv("RENEWLET_PASSWORD");
  const locale = optionalLocale(process.env.RENEWLET_LOCALE);

  console.log(`Renewlet demo seed`);
  console.log(`PocketBase: ${pbUrl}`);
  console.log(`Seed key:   ${SEED_KEY}`);

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
 * JSON 子字段过滤的版本差异，也避免 20 次查询。同 slug 重复时保留第一条并删除其余 demo。
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
    logo: `${LOGO_CDN}/${item.iconSlug}/default.svg`,
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
    notes: `${item.priceNote} Checked ${PRICE_CHECKED_AT}. Demo data only; official pricing may change by region, tax, billing term, and plan update.`,
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
      priceSnapshot: {
        amount: item.price,
        currency: item.currency,
        billingCycle: item.billingCycle,
        note: item.priceNote,
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

/**
 * 统一的 HTTP 边界封装。
 *
 * 边界控制：非 2xx 会带 method/path/status；非 JSON 响应也保留原文，避免吞掉代理或 server panic 信息。
 *
 * TODO：如果这个脚本开始用于自动化环境，可以在 GET/PATCH/POST 上加入有限重试和超时控制；
 * 目前本地人工执行更需要失败快、错误清楚。
 */
async function api(pbUrl, path, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${pbUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data = text ? safeJson(text) : {};
  if (!response.ok) {
    const message = data?.message || text || response.statusText;
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${message}`);
  }
  return data;
}

/** PocketBase 错误大多是 JSON，但代理/崩溃场景可能返回纯文本；这里避免错误处理再次抛错。 */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
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
