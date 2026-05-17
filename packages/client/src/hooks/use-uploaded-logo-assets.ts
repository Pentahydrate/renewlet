/**
 * 已上传 Logo 资产列表 Hook。
 *
 * 架构位置：
 * - LogoPicker 通过它读取当前用户已上传的 `assets.kind=logo` 私有资产。
 * - 读取仍走 PocketBase collection list rule；后端 ownerRules 会限制只能看到当前用户资产。
 *
 * 状态链路：
 * ```
 * 打开选择器 -> getList(kind=logo, -updated) -> /api/app/assets/{id} -> AuthorizedImage
 * 加载更多 -> 追加下一页并按 id 去重
 * 过期请求 -> token 不匹配 -> 忽略
 * ```
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pb, type RecordModel } from "@/lib/pocketbase";

const UPLOADED_LOGOS_PAGE_SIZE = 48;
const UPLOADED_LOGOS_FIELDS = "id,kind,originalName,mimeType,sizeBytes,created,updated";

/** 当前用户上传过、可复用的 Logo 资产。 */
export interface UploadedAsset {
  id: string;
  url: string;
  kind: "logo";
  originalName?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  created?: string | undefined;
  updated?: string | undefined;
}

export interface UseUploadedLogoAssetsResult {
  assets: UploadedAsset[];
  error: Error | null;
  hasLoaded: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

function stringField(record: RecordModel, key: string): string | undefined {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberField(record: RecordModel, key: string): number | undefined {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAsset(record: RecordModel): UploadedAsset | null {
  if (!record.id) return null;
  return {
    id: record.id,
    url: `/api/app/assets/${record.id}`,
    kind: "logo",
    originalName: stringField(record, "originalName"),
    mimeType: stringField(record, "mimeType"),
    sizeBytes: numberField(record, "sizeBytes"),
    created: stringField(record, "created"),
    updated: stringField(record, "updated"),
  };
}

function mergeAssets(current: UploadedAsset[], next: UploadedAsset[]): UploadedAsset[] {
  const seen = new Set(current.map((asset) => asset.id));
  const merged = [...current];
  for (const asset of next) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    merged.push(asset);
  }
  return merged;
}

/** 读取当前用户所有可复用 Logo 上传资产。 */
export function useUploadedLogoAssets(): UseUploadedLogoAssetsResult {
  const requestTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // React StrictMode 会在开发环境额外执行一次 setup -> cleanup -> setup；
    // setup 必须恢复 mounted 标记，否则后续真实请求结果会被当成卸载后的过期响应丢弃。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
    };
  }, []);

  const loadPage = useCallback(async (nextPage: number) => {
    const isFirstPage = nextPage === 1;
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    const isCurrentRequest = () => mountedRef.current && requestTokenRef.current === token;

    if (isFirstPage) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    setError(null);

    try {
      const result = await pb.collection("assets").getList<RecordModel>(nextPage, UPLOADED_LOGOS_PAGE_SIZE, {
        filter: pb.filter("kind = {:kind}", { kind: "logo" }),
        sort: "-updated",
        fields: UPLOADED_LOGOS_FIELDS,
      });
      if (!isCurrentRequest()) return;

      const nextAssets = result.items
        .map(normalizeAsset)
        .filter((asset): asset is UploadedAsset => asset !== null);

      setAssets((current) => (isFirstPage ? nextAssets : mergeAssets(current, nextAssets)));
      setPage(result.page);
      setTotalPages(result.totalPages);
      setHasLoaded(true);
    } catch (err: unknown) {
      if (isCurrentRequest()) {
        setError(err instanceof Error ? err : new Error("Uploaded logo assets load failed"));
        setHasLoaded(true);
      }
    } finally {
      if (isCurrentRequest()) {
        if (isFirstPage) {
          setIsLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    }
  }, []);

  const loadInitial = useCallback(() => loadPage(1), [loadPage]);

  const hasMore = hasLoaded && page < totalPages;

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    await loadPage(page + 1);
  }, [hasMore, isLoading, isLoadingMore, loadPage, page]);

  const reset = useCallback(() => {
    requestTokenRef.current += 1;
    setAssets([]);
    setPage(0);
    setTotalPages(0);
    setHasLoaded(false);
    setIsLoading(false);
    setIsLoadingMore(false);
    setError(null);
  }, []);

  return {
    assets,
    error,
    hasLoaded,
    hasMore,
    isLoading,
    isLoadingMore,
    loadInitial,
    loadMore,
    reset,
  };
}
