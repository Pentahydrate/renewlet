/**
 * @file 开发者订阅 fixture 的校验与 demo 字段补全。
 *
 * 职责：把 data 文件中的“官方公开价格快照”转换成 seed 脚本可直接写入的稳定 demo 订阅。
 * 本模块不连接 PocketBase，也不读取环境变量；它只守住数据契约，让 `--validate-only`
 * 可以在没有本地后端的情况下提前暴露价格、分类、URL 或 slug 问题。
 *
 * 外部依赖：标准 URL 解析器；字段枚举需与 PocketBase subscriptions schema 和前端 schema 保持一致。
 *
 * 流程：
 *   official price fixture -> demo defaults -> schema/invariant checks -> normalized demo list
 *
 * Caveat：真实信息只覆盖服务、计划、价格、币种、账期和官方来源；续费日、状态、付款方式是演示分布。
 * Caveat：slug 会在写入层与 extra.seedKey 组合成清理边界，改名会让旧 demo 记录被视为 stale。
 */

const EXPECTED_DEMO_SUBSCRIPTION_COUNT = 100;
const VALID_BILLING_CYCLES = new Set(["weekly", "monthly", "quarterly", "semi-annual", "annual", "custom"]);
const VALID_CATEGORIES = new Set([
  "productivity",
  "entertainment",
  "lifestyle",
  "finance",
  "streaming",
  "music",
  "gaming",
  "utilities",
  "cloud_storage",
  "education",
  "health_fitness",
  "food_dining",
  "shopping",
  "travel",
  "business",
  "communication",
  "developer_tools",
  "design",
  "ai_tools",
  "security_vpn",
  "hosting_domains",
  "news_media",
  "other",
]);
const VALID_STATUSES = new Set(["trial", "active", "paused", "cancelled"]);
const VALID_PAYMENT_METHODS = new Set([
  "alipay",
  "wechat",
  "credit_card",
  "debit_card",
  "paypal",
  "apple_pay",
  "google_pay",
  "bank_transfer",
  "crypto",
  "other",
]);
const DEMO_PAYMENT_METHODS = ["credit_card", "paypal", "apple_pay", "google_pay", "bank_transfer", "debit_card"];

/**
 * 统一执行 fixture 校验和 demo-only 字段补全。
 *
 * 为什么补全放在校验前：部分数据源只维护官方价格事实，续费偏移、付款方式和状态由脚本生成；
 * 先补全再校验可以确保最终写入 PocketBase 的对象才是被验证过的对象。
 *
 * @param {Array<Record<string, unknown>>} fixtures 官方公开价格 fixture 列表。
 * @returns {Array<Record<string, unknown>>} 可写入 seed 流程的规范化 demo 订阅。
 */
export function buildDemoSubscriptions(fixtures) {
  const errors = [];
  const slugs = new Set();
  const normalized = [];

  if (!Array.isArray(fixtures)) {
    throw new Error("Developer subscription fixtures must be an array.");
  }
  if (fixtures.length !== EXPECTED_DEMO_SUBSCRIPTION_COUNT) {
    errors.push(`expected ${EXPECTED_DEMO_SUBSCRIPTION_COUNT} subscriptions, got ${fixtures.length}`);
  }

  for (const [index, fixture] of fixtures.entries()) {
    const item = withDemoDefaults(fixture, index);
    const label = typeof item.slug === "string" && item.slug ? item.slug : `#${index + 1}`;

    for (const field of ["slug", "name", "currency", "billingCycle", "category", "status", "paymentMethod", "website", "pricingSource", "planLabel", "priceBasis"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        errors.push(`${label}: ${field} must be a non-empty string`);
      }
    }
    if (typeof item.slug === "string" && item.slug) {
      if (slugs.has(item.slug)) errors.push(`${label}: duplicate slug`);
      slugs.add(item.slug);
    }
    if (item.iconSlug !== null && item.iconSlug !== undefined && typeof item.iconSlug !== "string") {
      errors.push(`${label}: iconSlug must be a string, null, or undefined`);
    }
    if (!Number.isFinite(item.price) || item.price < 0) {
      errors.push(`${label}: price must be a finite non-negative number`);
    }
    if (typeof item.currency === "string" && !/^[A-Z]{3}$/.test(item.currency)) {
      errors.push(`${label}: currency must be a 3-letter uppercase code`);
    }
    if (!VALID_BILLING_CYCLES.has(item.billingCycle)) errors.push(`${label}: invalid billingCycle ${item.billingCycle}`);
    if (!VALID_CATEGORIES.has(item.category)) errors.push(`${label}: invalid category ${item.category}`);
    if (!VALID_STATUSES.has(item.status)) errors.push(`${label}: invalid status ${item.status}`);
    if (!VALID_PAYMENT_METHODS.has(item.paymentMethod)) errors.push(`${label}: invalid paymentMethod ${item.paymentMethod}`);
    if (!Number.isInteger(item.nextOffsetDays)) errors.push(`${label}: nextOffsetDays must be an integer`);
    if (!Number.isInteger(item.startOffsetDays)) errors.push(`${label}: startOffsetDays must be an integer`);
    if (item.billingCycle === "custom" && (!Number.isInteger(item.customDays) || item.customDays <= 0)) {
      errors.push(`${label}: custom billingCycle requires positive customDays`);
    }
    if (!isHttpUrl(item.website)) errors.push(`${label}: website must be an HTTP(S) URL`);
    if (!isHttpUrl(item.pricingSource)) errors.push(`${label}: pricingSource must be an HTTP(S) URL`);
    if (!Array.isArray(item.tags) || item.tags.length === 0) {
      errors.push(`${label}: tags must be a non-empty array`);
    } else {
      for (const tag of item.tags) {
        if (typeof tag !== "string" || tag.trim() === "" || tag.length > 40) {
          errors.push(`${label}: tags must be non-empty strings up to 40 characters`);
          break;
        }
      }
    }
    normalized.push(item);
  }

  if (errors.length > 0) {
    throw new Error(`Demo subscription validation failed:\n- ${errors.join("\n- ")}`);
  }
  return normalized;
}

function withDemoDefaults(item, index) {
  const nextOffsetDays = item.nextOffsetDays ?? defaultNextOffsetDays(item.billingCycle, index);
  const status = item.status ?? defaultDemoStatus(index);
  return {
    ...item,
    status,
    paymentMethod: item.paymentMethod ?? DEMO_PAYMENT_METHODS[index % DEMO_PAYMENT_METHODS.length],
    nextOffsetDays,
    startOffsetDays: item.startOffsetDays ?? -((index * 37) % 720 + 30),
    trialEndOffsetDays: status === "trial" ? item.trialEndOffsetDays ?? Math.min(nextOffsetDays, 9) : item.trialEndOffsetDays,
    reminderDays: item.reminderDays ?? defaultReminderDays(item.billingCycle, nextOffsetDays),
  };
}

function defaultNextOffsetDays(billingCycle, index) {
  if (billingCycle === "annual") return 30 + ((index * 17) % 330);
  if (billingCycle === "semi-annual") return 15 + ((index * 13) % 170);
  if (billingCycle === "quarterly") return 10 + ((index * 11) % 80);
  if (billingCycle === "weekly") return 1 + (index % 7);
  return 1 + ((index * 5) % 31);
}

// 用索引取模而不是随机数，保证截图、回归测试和重复 seed 的状态分布不会漂移。
function defaultDemoStatus(index) {
  if (index % 37 === 0 && index > 0) return "cancelled";
  if (index % 29 === 0 && index > 0) return "paused";
  if (index % 23 === 0 && index > 0) return "trial";
  return "active";
}

function defaultReminderDays(billingCycle, nextOffsetDays) {
  if (billingCycle === "annual" || billingCycle === "semi-annual") return 14;
  if (billingCycle === "quarterly") return 10;
  return nextOffsetDays <= 8 ? 3 : 7;
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
