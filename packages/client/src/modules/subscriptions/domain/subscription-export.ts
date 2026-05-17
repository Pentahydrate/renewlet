/**
 * 订阅导出领域逻辑。
 *
 * 架构位置：
 * - domain 负责把订阅转换为稳定的 JSON/CSV 内容。
 * - application hook 负责浏览器下载副作用。
 *
 * 注意： CSV 面向表格软件，任何新增字段都要继续经过 `escapeCsvCell`，
 * 避免 `= + - @ tab` 开头的内容被当作公式执行。
 */
import { localizedLabel, type Locale } from "@/i18n/locales";
import { translate } from "@/i18n/messages";
import { CYCLE_LABELS, type Subscription } from "@/types/subscription";

interface SubscriptionExportLabelMaps {
  categoryLabelByValue: ReadonlyMap<string, string>;
  statusLabelByValue: ReadonlyMap<string, string>;
  locale: Locale;
}

/** CSV 单元格转义，并防护常见表格公式注入前缀。 */
export function escapeCsvCell(value: unknown): string {
  // 为什么加单引号：Excel/Numbers/Sheets 会把特定前缀识别成公式，导出文件可能变成注入载体。
  const text = String(value ?? "");
  const formulaSafe = /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

/** 构建 JSON 导出内容。 */
export function buildSubscriptionsJsonExport(subscriptions: readonly Subscription[]) {
  return subscriptions.map((subscription) => ({
    ...subscription,
    startDate: subscription.startDate,
    nextBillingDate: subscription.nextBillingDate,
    trialEndDate: subscription.trialEndDate ?? null,
  }));
}

/** 构建 CSV 导出内容。 */
export function buildSubscriptionsCsv(
  subscriptions: readonly Subscription[],
  labelMaps: SubscriptionExportLabelMaps,
): string {
  const headers = [
    translate(labelMaps.locale, "subscriptions.csv.name"),
    translate(labelMaps.locale, "subscriptions.csv.price"),
    translate(labelMaps.locale, "subscriptions.csv.currency"),
    translate(labelMaps.locale, "subscriptions.csv.billingCycle"),
    translate(labelMaps.locale, "subscriptions.csv.category"),
    translate(labelMaps.locale, "subscriptions.csv.status"),
    translate(labelMaps.locale, "subscriptions.csv.startDate"),
    translate(labelMaps.locale, "subscriptions.csv.nextBillingDate"),
    translate(labelMaps.locale, "subscriptions.csv.reminderDays"),
    translate(labelMaps.locale, "subscriptions.csv.tags"),
  ];
  const rows = subscriptions.map((subscription) => [
    subscription.name,
    subscription.price,
    subscription.currency,
    localizedLabel(CYCLE_LABELS[subscription.billingCycle], labelMaps.locale),
    labelMaps.categoryLabelByValue.get(subscription.category) ?? subscription.category,
    labelMaps.statusLabelByValue.get(subscription.status) ?? subscription.status,
    subscription.startDate,
    subscription.nextBillingDate,
    subscription.reminderDays,
    subscription.tags?.join(";") || "",
  ]);

  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\n");
}
