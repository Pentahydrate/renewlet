import { useCallback, useRef, useState } from "react";
import { useBuiltInIconIndexStatus, useCheckBuiltInIconIndexProvider, useRefreshBuiltInIconIndexProvider } from "@/hooks/use-built-in-icon-index";
import { useToast } from "@/hooks/use-toast";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { createRawErrorResponseDetails, type RawErrorResponseDetails } from "@/lib/raw-error-response";
import type { BuiltInIconIndexStatus } from "@/lib/api/schemas/media";
import { useI18n } from "@/i18n/I18nProvider";
import { BUILT_IN_ICON_PROVIDERS, type BuiltInIconProvider } from "@renewlet/shared/built-in-icons";

export interface SettingsBuiltInIconIndexController {
  canManage: boolean;
  status: BuiltInIconIndexStatus | undefined;
  isLoading: boolean;
  checkingProvider: BuiltInIconProvider | null;
  refreshingProvider: BuiltInIconProvider | null;
  errorDetails: RawErrorResponseDetails | null;
  errorDetailsOpen: boolean;
  setErrorDetailsOpen: (open: boolean) => void;
  openProviderStatus: (provider: BuiltInIconProvider) => Promise<void>;
  closeProviderStatus: (provider: BuiltInIconProvider) => void;
  checkAllProviders: () => Promise<void>;
  checkProvider: (provider: BuiltInIconProvider) => Promise<void>;
  refreshProvider: (provider: BuiltInIconProvider) => Promise<void>;
}

// 内置图标索引是管理员级全局状态，不能和 settings 表单草稿混在一起，否则会制造未保存提示和普通用户可见状态。
export function useSettingsBuiltInIconIndexController(canManage: boolean): SettingsBuiltInIconIndexController {
  const { t } = useI18n();
  const { toast } = useToast();
  const status = useBuiltInIconIndexStatus(canManage);
  const checkProvider = useCheckBuiltInIconIndexProvider();
  const refreshProvider = useRefreshBuiltInIconIndexProvider();
  const [checkingProvider, setCheckingProvider] = useState<BuiltInIconProvider | null>(null);
  const [refreshingProvider, setRefreshingProvider] = useState<BuiltInIconProvider | null>(null);
  const [errorDetails, setErrorDetails] = useState<RawErrorResponseDetails | null>(null);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const openedProviderStatusChecksRef = useRef<Set<BuiltInIconProvider>>(new Set());
  const providerStatuses = status.data?.providers;

  const runProviderCheck = useCallback(async (provider: BuiltInIconProvider) => {
    setCheckingProvider(provider);
    try {
      await checkProvider.mutateAsync(provider);
    } catch (error) {
      // check 失败仍 refetch 后端状态，因为 GitHub 限流/上游错误会被记录为 provider 级摘要。
      const details = createRawErrorResponseDetails(error);
      setErrorDetails(details);
      setErrorDetailsOpen(true);
      await status.refetch();
    } finally {
      setCheckingProvider((current) => current === provider ? null : current);
    }
  }, [checkProvider, status]);

  const handleCheckProvider = useCallback(async (provider: BuiltInIconProvider) => {
    if (!canManage || checkProvider.isPending) return;
    await runProviderCheck(provider);
  }, [canManage, checkProvider.isPending, runProviderCheck]);

  const handleOpenProviderStatus = useCallback(async (provider: BuiltInIconProvider) => {
    if (!canManage) return;
    if (openedProviderStatusChecksRef.current.has(provider)) return;
    // Popover 打开只预检 GitHub metadata；先锁住本次打开周期，避免焦点重入或重渲染重复打共享出口。
    openedProviderStatusChecksRef.current.add(provider);
    const providerStatus = providerStatuses?.find((item) => item.provider === provider);
    if (
      checkProvider.isPending ||
      checkingProvider === provider ||
      refreshingProvider === provider ||
      Boolean(providerStatus?.refreshing)
    ) {
      return;
    }
    await runProviderCheck(provider);
  }, [canManage, checkProvider.isPending, checkingProvider, providerStatuses, refreshingProvider, runProviderCheck]);

  const handleCloseProviderStatus = useCallback((provider: BuiltInIconProvider) => {
    openedProviderStatusChecksRef.current.delete(provider);
  }, []);

  const handleCheckAllProviders = useCallback(async () => {
    if (!canManage || checkProvider.isPending) return;
    // 按 provider 串行检查，避免共享出口同时打 GitHub registry 触发 403/429。
    for (const provider of BUILT_IN_ICON_PROVIDERS) {
      await runProviderCheck(provider);
    }
  }, [canManage, checkProvider.isPending, runProviderCheck]);

  const handleRefreshProvider = useCallback(async (provider: BuiltInIconProvider) => {
    if (!canManage || refreshProvider.isPending) return;
    setRefreshingProvider(provider);
    try {
      const response = await refreshProvider.mutateAsync(provider);
      // 刷新成功只替换对应 provider 的聚合索引，用户已保存的 Logo URL 不会被批量改写。
      toast({
        title: t("settings.builtInIconIndexRefreshSuccess"),
        description: t("settings.builtInIconIndexRefreshSuccessDescription", {
          source: t(`settings.builtInIconSourceShort.${provider}`),
          count: response.provider.iconCount,
        }),
      });
    } catch (error) {
      const details = createRawErrorResponseDetails(error);
      setErrorDetails(details);
      setErrorDetailsOpen(true);
      await status.refetch();
      toast({
        title: t("settings.builtInIconIndexRefreshFailed"),
        description: getDisplayErrorMessage(error, t("settings.builtInIconIndexRefreshFailedDescription", {
          source: t(`settings.builtInIconSourceShort.${provider}`),
        })),
        variant: "destructive",
      });
    } finally {
      setRefreshingProvider((current) => current === provider ? null : current);
    }
  }, [canManage, refreshProvider, status, t, toast]);

  return {
    canManage,
    status: status.data,
    isLoading: status.isLoading,
    checkingProvider,
    refreshingProvider,
    errorDetails,
    errorDetailsOpen,
    setErrorDetailsOpen,
    openProviderStatus: handleOpenProviderStatus,
    closeProviderStatus: handleCloseProviderStatus,
    checkAllProviders: handleCheckAllProviders,
    checkProvider: handleCheckProvider,
    refreshProvider: handleRefreshProvider,
  };
}
