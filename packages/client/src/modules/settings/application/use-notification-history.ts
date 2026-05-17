/**
 * 通知历史查询 Hook。
 *
 * 架构位置：
 * - 设置 presentation 只负责展示，分页、筛选和 schema 校验都集中在这里。
 * - 后端返回 summary/upcoming/history 三段结构；hook 将分页 history 合并成稳定的前端 view model。
 *
 * 状态链路：
 * ```
 * 状态筛选 -> queryKey 变化 -> apiFetch(schema parse)
 * fetchNextPage -> 合并 pages.history.jobs -> presentation 选择详情行
 * ```
 *
 * 注意： notification job result 已在 schema 层建成联合类型；展示层不要再用动态 Record 读取任意字段。
 * PERF： 历史量继续增长后，可把 summary/upcoming 与 history page 拆成两个 query，减少翻页时重复传输。
 */
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import {
  notificationHistoryResponseSchema,
  type NotificationHistoryResponse,
  type NotificationHistoryStatusFilter,
} from "@/lib/api/schemas/notifications";

export type {
  NotificationJobResult,
  NotificationHistoryJob,
  NotificationHistoryResponse,
  NotificationHistoryStatusFilter,
  UpcomingNotificationBatch,
} from "@/lib/api/schemas/notifications";

const HISTORY_PAGE_SIZE = 20;

export function useNotificationHistory() {
  const [status, setStatus] = useState<NotificationHistoryStatusFilter>("all");

  const query = useInfiniteQuery({
    queryKey: ["notification-history", status],
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const params = new URLSearchParams({
        status,
        limit: String(HISTORY_PAGE_SIZE),
        offset: String(typeof pageParam === "number" ? pageParam : 0),
      });
      return await apiFetch(`/api/app/notifications/history?${params.toString()}`, notificationHistoryResponseSchema, { signal });
    },
    getNextPageParam: (lastPage) =>
      lastPage.history.hasMore ? lastPage.history.offset + lastPage.history.limit : undefined,
  });

  const data = useMemo<NotificationHistoryResponse | undefined>(() => {
    const pages = query.data?.pages;
    if (!pages || pages.length === 0) return undefined;

    const first = pages[0];
    if (!first) return undefined;
    const latest = pages[pages.length - 1] ?? first;
    const jobs = pages.flatMap((page) => page.history.jobs);

    // useInfiniteQuery 的每页都带 summary/upcoming；前端只拼接 history.jobs，
    // 其余调度预览保留第一页，避免翻页时把“当前状态”误解成历史快照。
    return {
      ...first,
      history: {
        ...first.history,
        jobs,
        status,
        limit: jobs.length,
        offset: 0,
        hasMore: latest.history.hasMore,
      },
    };
  }, [query.data?.pages, status]);

  return {
    ...query,
    data,
    historyStatus: status,
    setStatus,
    limit: HISTORY_PAGE_SIZE,
    loadMore: () => {
      if (query.hasNextPage) void query.fetchNextPage();
    },
  };
}
