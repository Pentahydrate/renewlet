import { useCallback, useMemo } from "react";
import {
  useCreatePublicStatusPage,
  useDeletePublicStatusPage,
  usePublicStatusPageStatus,
  useUpdatePublicStatusPage,
} from "@/hooks/use-public-status-page";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { copyTextToClipboard, type ClipboardCopyTarget } from "@/shared/browser/clipboard";
import type { Subscription } from "@/types/subscription";

export interface SettingsPublicStatusPageController {
  enabled: boolean;
  pageUrl: string | null;
  showPrices: boolean;
  visibleCount: number;
  hiddenCount: number;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isUpdating: boolean;
  createOrRotate: () => Promise<void>;
  copyUrl: (target?: ClipboardCopyTarget | null) => Promise<void>;
  openPage: () => Promise<void>;
  regenerate: () => Promise<void>;
  revoke: () => Promise<void>;
  updateShowPrices: (checked: boolean) => Promise<void>;
}

export function usePublicStatusPageSettingsController(
  subscriptions: Subscription[] | undefined,
): SettingsPublicStatusPageController {
  const { toast } = useToast();
  const { t } = useI18n();
  const publicStatusPageStatus = usePublicStatusPageStatus();
  const createPublicStatusPage = useCreatePublicStatusPage();
  const updatePublicStatusPage = useUpdatePublicStatusPage();
  const deletePublicStatusPage = useDeletePublicStatusPage();
  const publicStatusCounts = useMemo(() => {
    const rows = subscriptions ?? [];
    return rows.reduce(
      (counts, subscription) => ({
        visible: counts.visible + (subscription.publicHidden ? 0 : 1),
        hidden: counts.hidden + (subscription.publicHidden ? 1 : 0),
      }),
      { visible: 0, hidden: 0 },
    );
  }, [subscriptions]);

  const handleCreatePublicStatusPage = useCallback(async () => {
    try {
      // 公开页 token 是 bearer secret；创建成功后立即更新缓存，避免复制到旧地址或空地址。
      await createPublicStatusPage.mutateAsync();
      toast({
        title: t("settings.publicStatusGenerated"),
        description: t("settings.publicStatusGeneratedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.publicStatusFailed"),
        description: getDisplayErrorMessage(error, t("settings.publicStatusFailedDescription")),
        variant: "destructive",
      });
    }
  }, [createPublicStatusPage, t, toast]);

  const handleCopyPublicStatusUrl = useCallback(async (target?: ClipboardCopyTarget | null) => {
    const pageUrl = publicStatusPageStatus.data?.pageUrl;
    if (!pageUrl) return;
    const copyResult = await copyTextToClipboard(pageUrl, { target });
    if (copyResult.ok) {
      toast({
        title: t("settings.publicStatusCopied"),
        description: t("settings.publicStatusCopiedDescription"),
      });
      return;
    }
    toast({
      title: t("settings.publicStatusCopyFailed"),
      description: t("settings.publicStatusCopyFailedDescription"),
      variant: "destructive",
    });
  }, [publicStatusPageStatus.data?.pageUrl, t, toast]);

  const handleOpenPublicStatusPage = useCallback(async () => {
    const pageUrl = publicStatusPageStatus.data?.pageUrl;
    if (!pageUrl) return;
    window.open(pageUrl, "_blank", "noopener,noreferrer");
  }, [publicStatusPageStatus.data?.pageUrl]);

  const handleRevokePublicStatusPage = useCallback(async () => {
    try {
      // 撤销的安全边界在服务端删除 token；前端缓存只是让设置页立刻停止显示旧 URL。
      await deletePublicStatusPage.mutateAsync();
      toast({
        title: t("settings.publicStatusRevoked"),
        description: t("settings.publicStatusRevokedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.publicStatusFailed"),
        description: getDisplayErrorMessage(error, t("settings.publicStatusRevokeFailedDescription")),
        variant: "destructive",
      });
    }
  }, [deletePublicStatusPage, t, toast]);

  const handleRegeneratePublicStatusPage = useCallback(async () => {
    try {
      // 轮换采用先撤销后创建；只有旧 token 已失效后，设置页才展示新公开页 URL。
      await deletePublicStatusPage.mutateAsync();
      await createPublicStatusPage.mutateAsync();
      toast({
        title: t("settings.publicStatusRegenerated"),
        description: t("settings.publicStatusRegeneratedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.publicStatusFailed"),
        description: getDisplayErrorMessage(error, t("settings.publicStatusFailedDescription")),
        variant: "destructive",
      });
    }
  }, [createPublicStatusPage, deletePublicStatusPage, t, toast]);

  const handleUpdatePublicStatusShowPrices = useCallback(async (checked: boolean) => {
    if (!publicStatusPageStatus.data?.enabled) return;
    try {
      await updatePublicStatusPage.mutateAsync(checked);
      toast({
        title: t("settings.publicStatusUpdated"),
        description: checked ? t("settings.publicStatusPricesEnabled") : t("settings.publicStatusPricesDisabled"),
      });
    } catch (error) {
      toast({
        title: t("settings.publicStatusFailed"),
        description: getDisplayErrorMessage(error, t("settings.publicStatusUpdateFailedDescription")),
        variant: "destructive",
      });
    }
  }, [publicStatusPageStatus.data?.enabled, t, toast, updatePublicStatusPage]);

  return {
    enabled: publicStatusPageStatus.data?.enabled ?? false,
    pageUrl: publicStatusPageStatus.data?.pageUrl ?? null,
    showPrices: publicStatusPageStatus.data?.showPrices ?? false,
    visibleCount: publicStatusCounts.visible,
    hiddenCount: publicStatusCounts.hidden,
    isLoading: publicStatusPageStatus.isLoading,
    isCreating: createPublicStatusPage.isPending,
    isDeleting: deletePublicStatusPage.isPending,
    isUpdating: updatePublicStatusPage.isPending,
    createOrRotate: handleCreatePublicStatusPage,
    copyUrl: handleCopyPublicStatusUrl,
    openPage: handleOpenPublicStatusPage,
    regenerate: handleRegeneratePublicStatusPage,
    revoke: handleRevokePublicStatusPage,
    updateShowPrices: handleUpdatePublicStatusShowPrices,
  };
}
