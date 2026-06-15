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
import { todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import type { Category, Subscription, SubscriptionStatus } from "@/types/subscription";
import {
  collectSubscriptionTags,
  filterSubscriptions,
  hasActiveSubscriptionControls,
  hasActiveSubscriptionFilters,
  sortSubscriptions,
  type SubscriptionSortOption,
  type SubscriptionFilterState,
  type SubscriptionRenewalFilter,
} from "../domain/subscription-filters";

interface UseSubscriptionFiltersOptions {
  defaultCurrency?: string;
  convert?: (amount: number, from: string, to: string) => number;
  locale?: Locale;
  timeZone?: string;
}

const IDENTITY_CONVERT = (amount: number) => amount;

/** 管理订阅列表筛选状态，并返回筛选后的结果。 */
export function useSubscriptionFilters(
  subscriptions: readonly Subscription[],
  {
    defaultCurrency = "CNY",
    convert = IDENTITY_CONVERT,
    locale = "zh-CN",
    timeZone = "UTC",
  }: UseSubscriptionFiltersOptions = {},
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "all">("all");
  const [renewalFilter, setRenewalFilter] = useState<SubscriptionRenewalFilter>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SubscriptionSortOption>("default");

  const filters: SubscriptionFilterState = useMemo(
    () => ({ searchQuery, selectedCategories, statusFilter, renewalFilter, selectedTags }),
    [renewalFilter, searchQuery, selectedCategories, selectedTags, statusFilter],
  );
  const today = useMemo(() => todayDateOnlyInTimeZone(new Date(), timeZone), [timeZone]);
  const allTags = useMemo(() => collectSubscriptionTags(subscriptions), [subscriptions]);
  const filteredSubscriptions = useMemo(
    () => filterSubscriptions(subscriptions, filters, { today }),
    [filters, subscriptions, today],
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
  const toggleCategory = (category: Category) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };
  const clearSelectedCategories = () => {
    setSelectedCategories([]);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategories([]);
    setStatusFilter("all");
    setRenewalFilter("all");
    setSelectedTags([]);
    setSortOption("default");
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    statusFilter,
    setStatusFilter,
    renewalFilter,
    setRenewalFilter,
    sortOption,
    setSortOption,
    selectedTags,
    setSelectedTags,
    allTags,
    filteredSubscriptions: sortedSubscriptions,
    hasActiveFilters,
    hasActiveControls,
    toggleCategory,
    clearSelectedCategories,
    toggleTag,
    clearFilters,
  };
}
