/**
 * 订阅导出 application hook。
 *
 * 架构位置：
 * - domain 生成导出内容。
 * - shared/browser 封装下载副作用。
 *
 * 注意： 这里接收的是“已经筛选后的订阅列表”，因此导出结果跟当前页面视图一致。
 */
import { useMemo } from "react";
import type { Locale } from "@/i18n/locales";
import { localizedLabel } from "@/i18n/locales";
import { downloadFile } from "@/shared/browser/download-file";
import type { CustomConfig } from "@/types/config";
import type { Subscription } from "@/types/subscription";
import { buildSubscriptionsCsv, buildSubscriptionsJsonExport } from "../domain/subscription-export";

/** 订阅导出控制器。 */
export function useSubscriptionExport(subscriptions: readonly Subscription[], config: CustomConfig, locale: Locale) {
  const categoryLabelByValue = useMemo(
    () => new Map(config.categories.map((category) => [category.value, localizedLabel(category.labels, locale)])),
    [config.categories, locale],
  );
  const statusLabelByValue = useMemo(
    () => new Map(config.statuses.map((status) => [status.value, localizedLabel(status.labels, locale)])),
    [config.statuses, locale],
  );

  const exportToJSON = () => {
    const data = buildSubscriptionsJsonExport(subscriptions);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadFile(blob, "subscriptions.json");
  };

  const exportToCSV = () => {
    const csvContent = buildSubscriptionsCsv(subscriptions, {
      categoryLabelByValue,
      statusLabelByValue,
      locale,
    });
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    downloadFile(blob, "subscriptions.csv");
  };

  return { exportToJSON, exportToCSV };
}
