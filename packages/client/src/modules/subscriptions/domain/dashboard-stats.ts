/**
 * 首页统计领域模型。
 *
 * 架构位置：
 * - 这里只计算“月支出、活跃数、7 天内续费、试用数”等首页概要。
 * - 汇率转换函数由 application hook 注入，domain 不关心汇率来源和缓存策略。
 */
import { toMonthlyAmount } from "@/lib/subscription-billing";
import { daysBetweenDateOnly, todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";

interface BuildDashboardStatsInput {
  subscriptions: readonly Subscription[];
  defaultCurrency: string;
  convert: (amount: number, from: string, to: string) => number;
  now?: Date;
  timeZone?: string;
}

/** 构建首页概要统计模型。 */
export function buildDashboardStats({
  subscriptions,
  defaultCurrency,
  convert,
  now = new Date(),
  timeZone = "UTC",
}: BuildDashboardStatsInput) {
  const today = todayDateOnlyInTimeZone(now, timeZone);
  // 首页只把 active/trial 算作有效支出；paused/cancelled 不进入月度预算口径。
  const activeSubscriptions = subscriptions.filter((subscription) =>
    subscription.status === "active" || subscription.status === "trial"
  );
  const totalMonthly = activeSubscriptions.reduce((sum, subscription) => {
    const amountInDefault = convert(subscription.price, subscription.currency, defaultCurrency);
    return sum + toMonthlyAmount(amountInDefault, subscription.billingCycle, subscription.customDays);
  }, 0);
  const upcomingCount = subscriptions.filter((subscription) => {
    if (subscription.status !== "active" && subscription.status !== "trial") return false;
    // 注意： 这里是用户时区下的 0..7 天窗口，和 Cron 的发送时间窗口不是同一个概念。
    const days = daysBetweenDateOnly(today, subscription.nextBillingDate);
    return days <= 7 && days >= 0;
  }).length;
  const trialCount = subscriptions.filter((subscription) => subscription.status === "trial").length;

  return {
    activeSubscriptions,
    totalMonthly,
    upcomingCount,
    trialCount,
  };
}
