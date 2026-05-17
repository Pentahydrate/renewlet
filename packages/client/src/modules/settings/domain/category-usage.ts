/**
 * 设置领域规则：分类使用情况。
 *
 * 该函数用于删除分类前的保护判断。把统计逻辑放在 domain 层，是为了避免
 * 避免 Settings UI 直接理解订阅列表结构以外的删除策略。
 */
import type { Subscription } from "@/types/subscription";

/** 统计每个分类当前被多少个订阅使用。 */
export function countSubscriptionsByCategory(subscriptions: readonly Subscription[]): Map<string, number> {
  const usage = new Map<string, number>();

  for (const subscription of subscriptions) {
    usage.set(subscription.category, (usage.get(subscription.category) ?? 0) + 1);
  }

  return usage;
}
