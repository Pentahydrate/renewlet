import { useCallback, useState } from "react";
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
  checkAllProviders: () => Promise<void>;
  checkProvider: (provider: BuiltInIconProvider) => Promise<void>;
  refreshProvider: (provider: BuiltInIconProvider) => Promise<void>;
}

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

  const runProviderCheck = useCallback(async (provider: BuiltInIconProvider) => {
    setCheckingProvider(provider);
    try {
      await checkProvider.mutateAsync(provider);
    } catch (error) {
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

  const handleCheckAllProviders = useCallback(async () => {
    if (!canManage || checkProvider.isPending) return;
    for (const provider of BUILT_IN_ICON_PROVIDERS) {
      await runProviderCheck(provider);
    }
  }, [canManage, checkProvider.isPending, runProviderCheck]);

  const handleRefreshProvider = useCallback(async (provider: BuiltInIconProvider) => {
    if (!canManage || refreshProvider.isPending) return;
    setRefreshingProvider(provider);
    try {
      const response = await refreshProvider.mutateAsync(provider);
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
    checkAllProviders: handleCheckAllProviders,
    checkProvider: handleCheckProvider,
    refreshProvider: handleRefreshProvider,
  };
}
