/**
 * 站点图标/Logo 搜索 hook。
 *
 * 架构位置：
 * - LogoPicker 和 IconPicker 复用本 Hook 管理 popover、query、结果列表和远端增强搜索。
 * - 本地候选生成是同步兜底，服务端抓取只是增强能力。
 *
 * 异步流转：
 * ```
 * 本地候选立即显示 -> 服务端增强异步追加
 * 关闭/新搜索 -> abort + requestId 失效旧响应
 * 图片加载失败 -> blockedUrls 防止旧响应重新加入
 * ```
 *
 * 注意： 远端 favicon 搜索只是增强路径，不能替代本地候选；否则外部搜索波动会让 Logo/Icon 选择不可用。
 * TODO： 如果服务端 favicon 搜索增加持久缓存，需要保留 blockedUrls 逻辑；用户本轮已判定失败的图片不应被缓存结果重新注入。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { faviconSearchResponseSchema, type FaviconSearchKind } from "@/lib/api/schemas/media";

/** Favicon 搜索 Hook 的输入参数。 */
export interface UseFaviconSearchOptions {
  /**
   * 弹层打开时自动带入的提示词：
   * - LogoPicker：通常来自订阅名称（serviceName）
   * - IconPicker：通常来自支付方式名称（searchHint）
   */
  autoQuery?: string;
  /** 将关键词转换为候选 URL 列表的函数（需要是纯函数）。 */
  generateUrls: (query: string) => string[];
  /**
   * 可选：服务端搜索（增强命中率）。
   *
   * 说明：
   * - 服务端会抓取外部搜索页并提取图片 URL（可能失败/被限流），因此前端必须始终保留“客户端候选 URL”兜底
   * - 未登录时该接口会返回 401，这里会静默忽略（不影响未登录场景）
   */
  serverSearch?: {
    /** 是否启用服务端搜索（默认 true）。 */
    enabled?: boolean;
    /** API 路径（默认 `/api/app/favicon-search`）。 */
    endpoint?: string;
    /** 搜索类型：logo/icon（影响服务端拼接的关键词后缀）。 */
    kind?: FaviconSearchKind;
  };
  /** 每次触发搜索时同步通知调用方；用于把同一输入词转发给其他搜索源。 */
  onSearch?: (query: string) => void;
  /**
   * 关闭 Popover 后延迟清空可见搜索状态的时间。
   *
   * 用途：
   * - Radix Popover 关闭时内容会保留一小段退出动画。
   * - 如果同步清空结果，弹窗高度会突变并触发 Floating UI 重算位置，产生关闭前跳位。
   */
  closeResetDelayMs?: number;
}

export interface UseFaviconSearchResult {
  /** Popover 打开状态。 */
  open: boolean;
  /** Popover 的 onOpenChange（包含关闭时的 state reset）。 */
  onOpenChange: (open: boolean) => void;
  /** 当前输入框内容。 */
  query: string;
  /** 设置输入框内容。 */
  setQuery: (next: string) => void;
  /** 是否处于“搜索中”（这里是同步生成，但保留该状态便于 UI 统一）。 */
  isSearching: boolean;
  /** 候选 URL 列表。 */
  results: string[];
  /** 是否搜索过（用于区分“未搜索”与“搜索无结果”）。 */
  hasSearched: boolean;
  /** 触发一次搜索（仅使用当前输入框内容；空内容不搜索）。 */
  search: () => void;
  /** 从候选列表中移除某个 URL（通常用于 `<img onError>`）。 */
  removeResult: (url: string) => void;
  /** 关闭 popover（等价于 onOpenChange(false)）。 */
  close: () => void;
}

/** 管理本地 favicon 候选与服务端增强搜索的合并状态。 */
export function useFaviconSearch(options: UseFaviconSearchOptions): UseFaviconSearchResult {
  const { autoQuery, generateUrls, serverSearch, onSearch, closeResetDelayMs = 0 } = options;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // 远端搜索是异步的：用 requestId + AbortController 处理“快速输入/关闭弹窗”的竞态。
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const closeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoQueryInitializedRef = useRef(false);
  // 记录“已判定为不可用”的 URL（例如 <img onError> 触发后移除的）。
  // 由于远端结果可能晚于本地结果返回，这里需要一个黑名单来避免把已移除的 URL 又加回来。
  const blockedUrlsRef = useRef<Set<string>>(new Set());

  const mergeUnique = useCallback((a: string[], b: string[]) => {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const url of a) {
      if (seen.has(url)) continue;
      seen.add(url);
      merged.push(url);
    }
    for (const url of b) {
      if (seen.has(url)) continue;
      seen.add(url);
      merged.push(url);
    }
    return merged;
  }, []);

  const clearCloseResetTimer = useCallback(() => {
    if (closeResetTimerRef.current === null) return;
    clearTimeout(closeResetTimerRef.current);
    closeResetTimerRef.current = null;
  }, []);

  const resetVisibleSearchState = useCallback(() => {
    setIsSearching(false);
    setResults([]);
    setHasSearched(false);
    setQuery("");
  }, []);

  const abortActiveSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    blockedUrlsRef.current = new Set();
  }, []);

  const searchWithQuery = useCallback(
    (nextQuery: string) => {
      const q = nextQuery.trim();
      if (!q) return;

      // 新一轮搜索：清空本轮黑名单（不影响下一轮搜索）
      blockedUrlsRef.current = new Set();

      setIsSearching(true);
      setHasSearched(true);

      const urls = generateUrls(q);
      setResults(urls);
      setIsSearching(false);
      onSearch?.(q);

      // 服务端搜索：作为增强能力“追加”结果；不影响现有 UI（不占用 isSearching，避免把结果列表替换成 loading）。
      // 为什么不把远端请求纳入 loading：本地候选已经可用，远端慢/失败不应阻塞用户选择。
      // 这也是网络防御策略：第三方搜索被限流/超时，只损失额外候选，不影响用户继续填写表单。
      const serverEnabled = serverSearch?.enabled ?? true;
      if (!serverEnabled) return;

      const endpoint = serverSearch?.endpoint ?? "/api/app/favicon-search";
      const kind: FaviconSearchKind = serverSearch?.kind ?? "logo";

      // 取消上一次远端请求（如果有）
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const currentRequestId = requestIdRef.current + 1;
      requestIdRef.current = currentRequestId;

      void (async () => {
        try {
          const apiUrl = `${endpoint}?search=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`;
          const res = await apiFetch(apiUrl, faviconSearchResponseSchema, { signal: controller.signal });
          const blocked = blockedUrlsRef.current;
          const remoteUrls = (res.imageUrls ?? []).filter((u) => !blocked.has(u));
          // requestId 防御“旧请求晚返回覆盖新结果”的竞态；AbortController 不保证所有阶段都能取消。
          if (controller.signal.aborted) return;
          if (requestIdRef.current !== currentRequestId) return;
          if (remoteUrls.length === 0) return;

          setResults((prev) => mergeUnique(prev, remoteUrls));
        } catch (e: unknown) {
          if (controller.signal.aborted) return;
          if (e instanceof ApiError && e.status === 401) return;
          // 外部搜索增强失败不影响主流程；这里只做低噪日志，方便排查。
          console.debug("favicon server search failed:", e);
        }
      })();
    },
    [generateUrls, mergeUnique, onSearch, serverSearch?.enabled, serverSearch?.endpoint, serverSearch?.kind],
  );

  // 打开 popover 时：只在本轮打开的初始化阶段自动填充并搜索一次。
  // 用户把输入框删空后，不能再次被 autoQuery 回填。
  useEffect(() => {
    if (!open) return;
    if (autoQueryInitializedRef.current) return;

    autoQueryInitializedRef.current = true;
    if (!autoQuery?.trim()) return;

    setQuery(autoQuery);
    searchWithQuery(autoQuery);
  }, [autoQuery, open, searchWithQuery]);

  useEffect(() => {
    return () => {
      abortActiveSearch();
      clearCloseResetTimer();
      autoQueryInitializedRef.current = false;
    };
  }, [abortActiveSearch, clearCloseResetTimer]);

  const onOpenChange = useCallback((nextOpen: boolean) => {
    clearCloseResetTimer();
    setOpen(nextOpen);
    if (nextOpen) {
      resetVisibleSearchState();
      autoQueryInitializedRef.current = false;
      return;
    }

    if (!nextOpen) {
      // 关闭弹窗：终止远端请求，避免关闭后仍然 setState 导致闪动/警告
      abortActiveSearch();

      // 关闭动画结束后再清理可见状态，避免内容高度突变导致 Popover 关闭前跳位。
      if (closeResetDelayMs > 0) {
        closeResetTimerRef.current = setTimeout(() => {
          closeResetTimerRef.current = null;
          resetVisibleSearchState();
        }, closeResetDelayMs);
        return;
      }

      resetVisibleSearchState();
    }
  }, [abortActiveSearch, clearCloseResetTimer, closeResetDelayMs, resetVisibleSearchState]);

  const search = useCallback(() => {
    searchWithQuery(query);
  }, [query, searchWithQuery]);

  const removeResult = useCallback((url: string) => {
    blockedUrlsRef.current.add(url);
    setResults((prev) => prev.filter((u) => u !== url));
  }, []);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  return {
    open,
    onOpenChange,
    query,
    setQuery,
    isSearching,
    results,
    hasSearched,
    search,
    removeResult,
    close,
  };
}
