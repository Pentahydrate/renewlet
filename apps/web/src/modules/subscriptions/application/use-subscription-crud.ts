/**
 * 订阅 CRUD application hook。
 *
 * 架构位置：
 * - React Query hooks 负责远端写入和缓存失效。
 * - 这里只管理页面层的编辑弹窗上下文，避免列表页重复处理编辑态。
 */
import { useState } from "react";
import {
  useCreateSubscription,
  useDeleteSubscription,
  useRenewSubscription,
  useUpdateSubscription,
} from "@/hooks/use-subscriptions";
import { useDeferredDialogCleanup } from "@/hooks/use-deferred-dialog-cleanup";
import { buildClonedSubscriptionDraft } from "@/modules/subscriptions/domain/subscription-clone";
import type { Subscription, SubscriptionDraft } from "@/types/subscription";

/** 订阅 CRUD 的页面级交互控制器。 */
export function useSubscriptionCrud(subscriptions: readonly Subscription[]) {
  const createSubscription = useCreateSubscription();
  const updateSubscription = useUpdateSubscription();
  const renewSubscription = useRenewSubscription();
  const deleteSubscription = useDeleteSubscription();
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [cloningSubscription, setCloningSubscription] = useState<Subscription | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const { scheduleCleanup: scheduleEditCleanup, cancelCleanup: cancelEditCleanup } = useDeferredDialogCleanup(() => {
    // 关闭动画结束后再丢弃编辑对象，避免表单内容在 Dialog fade-out 中瞬间回到空态。
    setEditingSubscription(null);
  });
  const { scheduleCleanup: scheduleCloneCleanup, cancelCleanup: cancelCloneCleanup } = useDeferredDialogCleanup(() => {
    // 克隆弹窗 fade-out 期间保留源订阅快照，避免标题、Logo 和表单值在动画中闪空。
    setCloningSubscription(null);
  });

  const handleAddSubscription = (newSubscription: SubscriptionDraft) => {
    createSubscription.mutate(newSubscription);
  };

  const handleDeleteSubscription = (id: string) => {
    deleteSubscription.mutate(id);
  };

  const handleTogglePinnedSubscription = (id: string) => {
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) return;
    updateSubscription.mutate({ ...subscription, pinned: !subscription.pinned });
  };

  const handleTogglePublicHiddenSubscription = (id: string) => {
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) return;
    updateSubscription.mutate({ ...subscription, publicHidden: !subscription.publicHidden });
  };

  const handleRenewSubscription = (id: string) => {
    renewSubscription.mutate(id);
  };

  const handleEditSubscription = (id: string) => {
    // 编辑弹窗使用当前列表快照，避免额外请求；列表缓存由 mutations 成功后统一刷新。
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) return;
    cancelEditCleanup();
    setEditingSubscription(subscription);
    setEditDialogOpen(true);
  };

  const handleCloneSubscription = (id: string) => {
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) return;
    cancelCloneCleanup();
    setCloningSubscription(subscription);
    setCloneDialogOpen(true);
  };

  const handleSaveSubscription = (updatedSubscription: Subscription) => {
    updateSubscription.mutate(updatedSubscription);
  };

  const handleSaveClonedSubscription = (draft: SubscriptionDraft) => {
    if (!cloningSubscription) return;
    createSubscription.mutate(buildClonedSubscriptionDraft(cloningSubscription, draft));
  };

  const handleEditDialogOpenChange = (nextOpen: boolean) => {
    setEditDialogOpen(nextOpen);
    if (nextOpen) {
      // 用户在关闭动画未结束时重新打开同一弹窗时，要保留当前编辑上下文。
      cancelEditCleanup();
      return;
    }
    scheduleEditCleanup();
  };

  const handleCloneDialogOpenChange = (nextOpen: boolean) => {
    setCloneDialogOpen(nextOpen);
    if (nextOpen) {
      cancelCloneCleanup();
      return;
    }
    scheduleCloneCleanup();
  };

  return {
    editingSubscription,
    editDialogOpen,
    cloningSubscription,
    cloneDialogOpen,
    setEditDialogOpen,
    handleAddSubscription,
    handleDeleteSubscription,
    handleTogglePinnedSubscription,
    handleTogglePublicHiddenSubscription,
    handleRenewSubscription,
    handleEditSubscription,
    handleCloneSubscription,
    handleSaveSubscription,
    handleSaveClonedSubscription,
    handleEditDialogOpenChange,
    handleCloneDialogOpenChange,
  };
}
