/**
 * 图标搜索 hook（The SVG）。
 *
 * 架构位置：
 * - LogoPicker/IconPicker 通过它搜索内置品牌图标索引。
 * - 请求 `/api/app/thesvg-icons`，避免客户端下载完整索引。
 *
 * 状态链路：
 * ```
 * 执行 search(query) -> abort 旧请求 -> apiFetch(schema parse) -> requestId 命中才写入 icons
 * 取消/重置/卸载 -> abort + requestId++ -> 旧响应失效
 * ```
 *
 * 注意： 使用 requestId + AbortController 防止旧搜索结果覆盖新输入。
 * PERF： 若品牌索引继续增长，可在后端增加 query 归一缓存，前端保持本 Hook 的取消语义不变。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { theSvgIconsResponseSchema, type ApiTheSvgIcon } from "@/lib/api/schemas/media";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";

/** The SVG 搜索 Hook 返回状态。 */
export interface UseTheSvgIconSearchResult {
  icons: ApiTheSvgIcon[];
  isSearching: boolean;
  hasSearched: boolean;
  error: string | null;
  search: (query: string) => void;
  cancel: () => void;
  reset: () => void;
}

/** 搜索内置 The SVG 图标索引，并管理取消/重置状态。 */
export function useTheSvgIconSearch(limit = 32): UseTheSvgIconSearchResult {
  const [icons, setIcons] = useState<ApiTheSvgIcon[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setIcons([]);
    setIsSearching(false);
    setHasSearched(false);
    setError(null);
  }, [cancel]);

  useEffect(() => {
    return reset;
  }, [reset]);

  const search = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const currentRequestId = requestIdRef.current + 1;
      requestIdRef.current = currentRequestId;
      setHasSearched(true);
      setIsSearching(true);
      setError(null);

      void (async () => {
        try {
          const url = `/api/app/thesvg-icons?search=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`;
          const res = await apiFetch(url, theSvgIconsResponseSchema, { signal: controller.signal });
          // AbortController 只能取消 fetch；schema parse 或微任务阶段仍可能晚返回。
          // requestId 是第二道防线，确保快速输入时只展示最后一次搜索结果。
          if (controller.signal.aborted) return;
          if (requestIdRef.current !== currentRequestId) return;
          setIcons(res.icons);
          setError(null);
        } catch (error: unknown) {
          if (controller.signal.aborted) return;
          if (requestIdRef.current !== currentRequestId) return;
          console.debug("theSVG icon search failed:", error);
          setIcons([]);
          setError(translate(getApiLocale(), "media.builtInSearchFailed"));
        } finally {
          if (!controller.signal.aborted && requestIdRef.current === currentRequestId) {
            setIsSearching(false);
          }
        }
      })();
    },
    [limit],
  );

  return {
    icons,
    isSearching,
    hasSearched,
    error,
    search,
    cancel,
    reset,
  };
}
