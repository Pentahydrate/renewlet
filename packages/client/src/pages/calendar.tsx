/**
 * 续费日历页（/calendar）。
 *
 * 功能：
 * - 以日历方式展示订阅的 nextBillingDate
 * - 支持从日历点击订阅并进入编辑
 */

import { useMemo, useState } from 'react';
import type { Subscription, SubscriptionDraft } from '@/types/subscription';
import { Header } from '@/components/header';
import { BackToTopFloatButton } from '@/components/back-to-top-float-button';
import { SubscriptionCalendar } from '@/components/subscription-calendar';
import { EditSubscriptionDialog } from '@/components/edit-subscription-dialog';
import { CalendarPageSkeleton } from '@/components/loading-skeleton';
import { useCreateSubscription, useSubscriptions, useUpdateSubscription } from '@/hooks/use-subscriptions';
import { collectSubscriptionTags } from '@/modules/subscriptions/domain/subscription-filters';
import { useI18n } from '@/i18n/I18nProvider';
import { useMediaQuery } from '@/hooks/use-media-query';

const EMPTY_SUBSCRIPTIONS: Subscription[] = [];

/** 日历页组件。 */
const Calendar = () => {
  const subscriptionsQuery = useSubscriptions();
  const subscriptions = subscriptionsQuery.data ?? EMPTY_SUBSCRIPTIONS;
  const createSubscription = useCreateSubscription();
  const updateSubscription = useUpdateSubscription();
  const { t } = useI18n();
  const isMobileCalendarPage = useMediaQuery("(max-width: 639px)");
  const availableTags = useMemo(() => collectSubscriptionTags(subscriptions), [subscriptions]);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  /** 从 Header 的新增弹窗提交订阅。 */
  const handleAddSubscription = (newSub: SubscriptionDraft) => {
    createSubscription.mutate(newSub);
  };

  /** 从日历中选择一条订阅进入编辑。 */
  const handleEditSubscription = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setEditDialogOpen(true);
  };

  /** 保存编辑后的订阅。 */
  const handleSaveSubscription = (updated: Subscription) => {
    updateSubscription.mutate(updated);
    setEditDialogOpen(false);
    setEditingSubscription(null);
  };

  // 与参考项目保持一致：订阅数据未加载完成前展示日历骨架屏。
  if (subscriptionsQuery.isPending) {
    return (
      <div className="app-page bg-background">
        <Header onAddSubscription={handleAddSubscription} availableTags={availableTags} />
        <main className="app-main mx-auto max-w-7xl">
          <CalendarPageSkeleton withPageShell={false} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-page bg-background">
      <Header onAddSubscription={handleAddSubscription} availableTags={availableTags} />

      <main className="app-main mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">{t("calendar.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("calendar.pageSubtitle")}</p>
        </div>

        <SubscriptionCalendar 
          subscriptions={subscriptions} 
          onEditSubscription={handleEditSubscription}
        />
      </main>

      <EditSubscriptionDialog
        subscription={editingSubscription}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSave={handleSaveSubscription}
        availableTags={availableTags}
      />
      {/* 按需求日历页只在 H5 端启用，桌面端保持现有页面密度和视觉重心不变。 */}
      <BackToTopFloatButton enabled={isMobileCalendarPage} />
    </div>
  );
};

export default Calendar;
