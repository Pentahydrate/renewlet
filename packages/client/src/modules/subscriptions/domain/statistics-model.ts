/**
 * 统计页领域模型。
 *
 * 架构位置：
 * - 将金额换算、预算占比、分类/支付方式图表数据集中在纯函数中。
 * - 页面只负责渲染 Recharts 和统计卡片，避免图表 UI 反向承载业务规则。
 *
 * 数据流：
 * ```
 * 输入：subscriptions + settings.defaultCurrency + exchangeRates + customConfig
 *   -> buildStatisticsModel
 *   -> StatBox / PieChart view model
 * ```
 */
import { toMonthlyAmount } from "@/lib/subscription-billing";
import { isSameMonthDateOnly, todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import { localizedLabel, type Locale } from "@/i18n/locales";
import { translate } from "@/i18n/messages";
import type { CustomConfig } from "@/types/config";
import type { Subscription } from "@/types/subscription";

/** 统计图表固定色板；保持跨图表颜色稳定，避免同一分类在不同渲染中频繁换色。 */
export const STATISTICS_CHART_COLORS = [
  "hsl(200 80% 50%)",
  "hsl(350 75% 55%)",
  "hsl(160 84% 45%)",
  "hsl(35 90% 55%)",
  "hsl(280 70% 55%)",
  "hsl(180 60% 45%)",
  "hsl(45 90% 50%)",
  "hsl(320 70% 55%)",
];

function chartColorAt(index: number): string {
  return STATISTICS_CHART_COLORS[index % STATISTICS_CHART_COLORS.length] ?? "hsl(200 80% 50%)";
}

interface BuildStatisticsModelInput {
  subscriptions: readonly Subscription[];
  config: CustomConfig;
  monthlyBudget: number;
  defaultCurrency: string;
  convert: (amount: number, from: string, to: string) => number;
  now?: Date;
  timeZone?: string;
  locale?: Locale;
}

/** 构建统计页视图模型。 */
export function buildStatisticsModel({
  subscriptions,
  config,
  monthlyBudget,
  defaultCurrency,
  convert,
  now = new Date(),
  timeZone = "UTC",
  locale = "zh-CN",
}: BuildStatisticsModelInput) {
  const today = todayDateOnlyInTimeZone(now, timeZone);
  const categoryByValue = new Map(config.categories.map((category) => [category.value, category]));
  const paymentMethodByValue = new Map(config.paymentMethods.map((method) => [method.value, method]));
  const activeSubscriptions = subscriptions.filter((subscription) =>
    subscription.status === "active" || subscription.status === "trial"
  );
  const inactiveSubscriptions = subscriptions.filter((subscription) =>
    subscription.status === "paused" || subscription.status === "cancelled"
  );

  const convertToDefault = (price: number, currency: string) => convert(price, currency, defaultCurrency);
  const calculateMonthlyAmount = (subscription: Subscription): number => {
    // 先换算币种再折算周期，保证所有图表都以用户当前统计货币为唯一口径。
    const amountInDefault = convertToDefault(subscription.price, subscription.currency);
    return toMonthlyAmount(amountInDefault, subscription.billingCycle, subscription.customDays);
  };

  const totalMonthly = activeSubscriptions.reduce((sum, subscription) => sum + calculateMonthlyAmount(subscription), 0);
  const totalAnnual = totalMonthly * 12;
  const avgMonthlyPerSub = activeSubscriptions.length > 0 ? totalMonthly / activeSubscriptions.length : 0;
  const mostExpensive = activeSubscriptions.reduce((max, subscription) => {
    // 使用月折算金额比较，而不是原始价格，避免年付订阅被低估。
    const currentMonthly = calculateMonthlyAmount(subscription);
    const maxMonthly = max ? calculateMonthlyAmount(max) : 0;
    return currentMonthly > maxMonthly ? subscription : max;
  }, null as Subscription | null);
  const thisMonthDue = activeSubscriptions
    .filter((subscription) => isSameMonthDateOnly(subscription.nextBillingDate, today))
    .reduce((sum, subscription) => sum + convertToDefault(subscription.price, subscription.currency), 0);
  const budgetUsedPercent = monthlyBudget > 0 ? (totalMonthly / monthlyBudget) * 100 : 0;
  const budgetRemaining = monthlyBudget - totalMonthly;
  const inactiveSavings = inactiveSubscriptions.reduce(
    (sum, subscription) => sum + calculateMonthlyAmount(subscription),
    0,
  );

  const categoryData = Object.entries(
    activeSubscriptions.reduce((acc, subscription) => {
      const amount = calculateMonthlyAmount(subscription);
      acc[subscription.category] = (acc[subscription.category] || 0) + amount;
      return acc;
    }, {} as Record<string, number>),
  ).map(([name, value], index) => ({
    name: categoryByValue.get(name)
      ? localizedLabel(categoryByValue.get(name)!.labels, locale)
      : name,
    value: Math.round(value * 1000) / 1000,
    color: categoryByValue.get(name)?.color ?? chartColorAt(index),
  }));

  const paymentData = Object.entries(
    activeSubscriptions.reduce((acc, subscription) => {
      const method = subscription.paymentMethod || "other";
      acc[method] = (acc[method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  ).map(([name, value], index) => ({
    name: paymentMethodByValue.get(name)
      ? localizedLabel(paymentMethodByValue.get(name)!.labels, locale)
      : name,
    value,
    color: chartColorAt(index),
  }));

  const budgetChartData = [
    { name: translate(locale, "statistics.budgetUsed"), value: Math.min(totalMonthly, monthlyBudget), color: "hsl(350 75% 55%)" },
    { name: translate(locale, "statistics.budgetRemaining"), value: Math.max(budgetRemaining, 0), color: "hsl(200 80% 50%)" },
  ];

  // TODO：若未来支持多预算周期，可把 monthlyBudget 和 budgetChartData 抽成独立预算 domain。
  return {
    activeCount: activeSubscriptions.length,
    inactiveCount: inactiveSubscriptions.length,
    totalMonthly,
    totalAnnual,
    avgMonthlyPerSub,
    mostExpensive,
    thisMonthDue,
    budgetUsedPercent,
    budgetRemaining,
    monthlySavings: inactiveSavings,
    annualSavings: inactiveSavings * 12,
    categoryData,
    paymentData,
    budgetChartData,
  };
}
