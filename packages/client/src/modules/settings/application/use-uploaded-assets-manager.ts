import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import type { UploadedAsset, UploadedAssetsPage, UploadKind } from "@/lib/api/schemas/media";
import { useToast } from "@/hooks/use-toast";
import { assetService } from "@/services/asset-service";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { useI18n } from "@/i18n/I18nProvider";

interface UploadedAssetKindState {
  assets: UploadedAsset[];
  error: Error | null;
  hasLoaded: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
}

interface UploadedAssetKindController extends UploadedAssetKindState {
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

interface AssetDeleteError {
  assetId: string;
  message: string;
}

export interface UploadedAssetsManagerController {
  logo: UploadedAssetKindController;
  icon: UploadedAssetKindController;
  deleteError: AssetDeleteError | null;
  deletingAssetId: string | null;
  deleteAsset: (asset: UploadedAsset) => Promise<boolean>;
}

type InternalKindState = Omit<UploadedAssetKindState, "hasMore"> & {
  page: number;
  totalPages: number;
};

const EMPTY_KIND_STATE: InternalKindState = {
  assets: [],
  error: null,
  hasLoaded: false,
  isLoading: false,
  isLoadingMore: false,
  page: 0,
  totalPages: 0,
};

const ASSET_KINDS: UploadKind[] = ["logo", "icon"];

export function useUploadedAssetsManager(): UploadedAssetsManagerController {
  const { t } = useI18n();
  const { toast } = useToast();
  const requestTokensRef = useRef<Record<UploadKind, number>>({ logo: 0, icon: 0 });
  const mountedRef = useRef(true);
  const [stateByKind, setStateByKind] = useState<Record<UploadKind, InternalKindState>>({
    logo: EMPTY_KIND_STATE,
    icon: EMPTY_KIND_STATE,
  });
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<AssetDeleteError | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokensRef.current.logo += 1;
      requestTokensRef.current.icon += 1;
    };
  }, []);

  const loadPage = useCallback(async (kind: UploadKind, page: number) => {
    const isFirstPage = page === 1;
    const token = requestTokensRef.current[kind] + 1;
    requestTokensRef.current[kind] = token;
    const isCurrentRequest = () => mountedRef.current && requestTokensRef.current[kind] === token;

    setStateByKind((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        error: null,
        isLoading: isFirstPage,
        isLoadingMore: !isFirstPage,
      },
    }));

    try {
      const result = await assetService.list(kind, page);
      if (!isCurrentRequest()) return;
      setStateByKind((current) => ({
        ...current,
        [kind]: nextKindState(current[kind], result, isFirstPage),
      }));
    } catch (error: unknown) {
      if (!isCurrentRequest()) return;
      setStateByKind((current) => ({
        ...current,
        [kind]: {
          ...current[kind],
          error: error instanceof Error ? error : new Error("Uploaded assets load failed"),
          hasLoaded: true,
          isLoading: false,
          isLoadingMore: false,
        },
      }));
    }
  }, []);

  useEffect(() => {
    // 设置页管理区是上传资产的审计入口；进入页面即加载两类资产，删除后再本地收敛列表。
    for (const kind of ASSET_KINDS) {
      void loadPage(kind, 1);
    }
  }, [loadPage]);

  const deleteAsset = useCallback(async (asset: UploadedAsset) => {
    if (deletingAssetId) return false;
    setDeletingAssetId(asset.id);
    setDeleteError(null);
    try {
      await assetService.delete(asset.id);
      setStateByKind((current) => removeAssetFromState(current, asset));
      toast({
        title: t("settings.uploadedIconsDeleteSuccess"),
        description: t("settings.uploadedIconsDeleteSuccessDescription", { name: assetLabel(asset, t("settings.uploadedIconsUnnamedAsset")) }),
      });
      return true;
    } catch (error: unknown) {
      const fallback = t("settings.uploadedIconsDeleteFailedDescription");
      const message = assetDeleteErrorMessage(error, fallback, t);
      setDeleteError({ assetId: asset.id, message });
      toast({
        title: t("settings.uploadedIconsDeleteFailed"),
        description: message,
        variant: "destructive",
      });
      return false;
    } finally {
      setDeletingAssetId(null);
    }
  }, [deletingAssetId, t, toast]);

  const makeKindController = useCallback((kind: UploadKind): UploadedAssetKindController => {
    const state = stateByKind[kind];
    return {
      assets: state.assets,
      error: state.error,
      hasLoaded: state.hasLoaded,
      hasMore: state.hasLoaded && state.page < state.totalPages,
      isLoading: state.isLoading,
      isLoadingMore: state.isLoadingMore,
      refresh: () => loadPage(kind, 1),
      loadMore: () => {
        if (!state.hasLoaded || state.page >= state.totalPages || state.isLoading || state.isLoadingMore) {
          return Promise.resolve();
        }
        return loadPage(kind, state.page + 1);
      },
    };
  }, [loadPage, stateByKind]);

  const logo = useMemo(() => makeKindController("logo"), [makeKindController]);
  const icon = useMemo(() => makeKindController("icon"), [makeKindController]);

  return {
    logo,
    icon,
    deleteError,
    deletingAssetId,
    deleteAsset,
  };
}

function nextKindState(current: InternalKindState, result: UploadedAssetsPage, isFirstPage: boolean): InternalKindState {
  return {
    assets: isFirstPage ? result.items : mergeAssets(current.assets, result.items),
    error: null,
    hasLoaded: true,
    isLoading: false,
    isLoadingMore: false,
    page: result.page,
    totalPages: result.totalPages,
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

function removeAssetFromState(
  current: Record<UploadKind, InternalKindState>,
  deleted: UploadedAsset,
): Record<UploadKind, InternalKindState> {
  return {
    ...current,
    [deleted.kind]: {
      ...current[deleted.kind],
      assets: current[deleted.kind].assets.filter((asset) => asset.id !== deleted.id),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assetInUseCount(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== "ASSET_IN_USE") return null;
  const payload = error.details;
  if (!isRecord(payload) || !isRecord(payload["details"])) return null;
  const usageCount = payload["details"]["usageCount"];
  return typeof usageCount === "number" && Number.isInteger(usageCount) && usageCount > 0 ? usageCount : null;
}

function assetDeleteErrorMessage(
  error: unknown,
  fallback: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const usageCount = assetInUseCount(error);
  if (usageCount !== null) {
    return t("settings.uploadedIconsDeleteBlockedDescription", { count: usageCount });
  }
  return getDisplayErrorMessage(error, fallback);
}

function assetLabel(asset: UploadedAsset, fallback: string): string {
  return asset.originalName?.trim() || fallback;
}
