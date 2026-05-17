/**
 * 订阅筛选 application hook。
 *
 * 架构位置：
 * - 持有用户当前筛选条件。
 * - 调用 domain 纯函数得到标签集合和筛选结果。
 *
 * PERF： 订阅量很大时，可把搜索字段预先标准化成索引，避免每次输入都遍历原始字符串。
 */
import { useMemo, useState } from "react";
import type { Locale } from "@/i18n/locales";
import type { Category, Subscription, SubscriptionStatus } from "@/types/subscription";
import {
  collectSubscriptionTags,
  filterSubscriptions,
  hasActiveSubscriptionControls,
  hasActiveSubscriptionFilters,
  sortSubscriptions,
  type SubscriptionSortOption,
  type SubscriptionFilterState,
} from "../domain/subscription-filters";

interface UseSubscriptionFiltersOptions {
  defaultCurrency?: string;
  convert?: (amount: number, from: string, to: string) => number;
  locale?: Locale;
}

const IDENTITY_CONVERT = (amount: number) => amount;

/** 管理订阅列表筛选状态，并返回筛选后的结果。 */
export function useSubscriptionFilters(
  subscriptions: readonly Subscription[],
  {
    defaultCurrency = "CNY",
    convert = IDENTITY_CONVERT,
    locale = "zh-CN",
  }: UseSubscriptionFiltersOptions = {},
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "all">("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SubscriptionSortOption>("default");

  const filters: SubscriptionFilterState = useMemo(
    () => ({ searchQuery, categoryFilter, statusFilter, selectedTags }),
    [categoryFilter, searchQuery, selectedTags, statusFilter],
  );
  const allTags = useMemo(() => collectSubscriptionTags(subscriptions), [subscriptions]);
  const filteredSubscriptions = useMemo(
    () => filterSubscriptions(subscriptions, filters),
    [filters, subscriptions],
  );
  const sortedSubscriptions = useMemo(
    () => sortSubscriptions(filteredSubscriptions, { sortOption, defaultCurrency, convert, locale }),
    [convert, defaultCurrency, filteredSubscriptions, locale, sortOption],
  );
  const hasActiveFilters = hasActiveSubscriptionFilters(filters);
  const hasActiveControls = hasActiveSubscriptionControls(filters, sortOption);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setSelectedTags([]);
    setSortOption("default");
  };

  return {
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    sortOption,
    setSortOption,
    selectedTags,
    setSelectedTags,
    allTags,
    filteredSubscriptions: sortedSubscriptions,
    hasActiveFilters,
    hasActiveControls,
    toggleTag,
    clearFilters,
  };
}
