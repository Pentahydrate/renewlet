/**
 * 订阅卡片组件。
 *
 * 用途：
 * - 在仪表盘与订阅列表展示订阅概览
 * - 提供编辑/删除入口
 * - 根据续费/试用到期情况做提示（颜色/动画）
 *
 * 注意： 卡片直接读取自定义配置来显示分类颜色。若未来支持服务端渲染卡片，
 * 需要把 label/color view model 从上层传入。
 */

import { useEffect, useState } from 'react';
import { Subscription, STATUS_LABELS, CYCLE_LABELS } from '@/types/subscription';
import { useCustomConfig } from '@/contexts/CustomConfigContext';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { colorWithAlpha } from '@/lib/color';
import { Calendar, MoreHorizontal, CalendarClock, Bell, CreditCard } from 'lucide-react';
import {
  daysBetweenDateOnly,
  todayDateOnlyInTimeZone,
} from '@/lib/time/date-only';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { TruncatedTooltipText } from '@/components/ui/truncated-tooltip-text';
import { AuthorizedImage } from '@/components/authorized-image';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useI18n } from '@/i18n/I18nProvider';
import { localizedLabel } from '@/i18n/locales';

interface SubscriptionCardProps {
  /** 订阅数据（前端 domain 类型）。 */
  subscription: Subscription;
  /** 展示模式：grid（卡片）/ list（列表行）。 */
  viewMode?: 'grid' | 'list';
  /** 点击“编辑”回调（传订阅 id）。 */
  onEdit?: (id: string) => void;
  /** 点击“删除确认”回调（传订阅 id）。 */
  onDelete?: (id: string) => void;
  /** 用户 IANA 时区，用于续费/试用提示窗口。 */
  timeZone: string;
}

/** 状态配色：用于 trial/active 等视觉提示。 */
const statusStyles: Record<string, string> = {
  trial: 'bg-warning/10 text-warning border-warning/20',
  active: 'bg-success/10 text-success border-success/20',
  paused: 'bg-muted text-muted-foreground border-muted',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
};

const DEFAULT_BADGE_COLOR = "hsl(var(--primary))";

/** 订阅卡片。 */
export function SubscriptionCard({ subscription, viewMode = 'grid', onEdit, onDelete, timeZone }: SubscriptionCardProps) {
  const { config } = useCustomConfig();
  const { t, locale, label, formatCurrency, formatDateOnly } = useI18n();
  const categoryConfig = config.categories.find((c) => c.value === subscription.category);
  const categoryLabel = categoryConfig ? label(categoryConfig.labels) : subscription.category;
  const categoryColor = categoryConfig?.color ?? DEFAULT_BADGE_COLOR;
  const categoryBadgeStyle = {
    backgroundColor: colorWithAlpha(categoryColor, 0.1) ?? undefined,
    borderColor: colorWithAlpha(categoryColor, 0.2) ?? undefined,
    color: categoryColor,
  };

  const logoBackgroundFrom = colorWithAlpha(categoryColor, 0.2) ?? categoryColor;
  const logoBackgroundTo = colorWithAlpha(categoryColor, 0.05) ?? categoryColor;
  const logoBackgroundStyle = {
    backgroundImage: `linear-gradient(135deg, ${logoBackgroundFrom}, ${logoBackgroundTo})`,
  };

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const today = todayDateOnlyInTimeZone(new Date(), timeZone);
  const daysUntilRenewal = daysBetweenDateOnly(today, subscription.nextBillingDate);
  const daysUntilTrialEnd = subscription.trialEndDate ? daysBetweenDateOnly(today, subscription.trialEndDate) : null;
  // 这里是展示提示窗口，不等同于 Cron 通知窗口；不要把两者的阈值混用。
  const isRenewingSoon = daysUntilRenewal <= 7 && daysUntilRenewal >= 0;
  const isTrialEndingSoon = subscription.status === 'trial' && daysUntilTrialEnd !== null &&
    daysUntilTrialEnd <= 3 && daysUntilTrialEnd >= 0;

  // 当 logo 变化时重置错误状态（例如用户从无效 URL 换成了有效 URL）
  useEffect(() => {
    setLogoLoadFailed(false);
  }, [subscription.logo]);

  /** 删除确认：触发回调并关闭弹窗。 */
  const handleDeleteConfirm = () => {
    onDelete?.(subscription.id);
    setShowDeleteDialog(false);
  };

  return (
    <>
    <div className={cn(
      "group relative h-full overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-300 hover:bg-card-hover",
      isRenewingSoon && "border-warning/40",
      isTrialEndingSoon && "animate-pulse-glow"
    )}>
      <div className="flex items-start gap-4">
        {/* Logo（有则显示图片，否则显示订阅名称前 2 个字符作为占位） */}
        <div className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br text-lg font-bold",
        )} style={logoBackgroundStyle}>
          {subscription.logo && !logoLoadFailed ? (
            <AuthorizedImage
              src={subscription.logo}
              alt={subscription.name}
              className="h-full w-full object-contain p-1"
              onError={() => setLogoLoadFailed(true)}
            />
          ) : (
            subscription.name.slice(0, 2).toUpperCase()
          )}
        </div>

        {/* 内容 */}
        <div className="min-w-0 flex-1 grid gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2">
            <TruncatedTooltipText
              as="h3"
              text={subscription.name}
              className="min-w-0 font-semibold text-foreground"
            />

            <div className="shrink-0 text-right">
              <p className="whitespace-nowrap text-xl font-bold text-foreground">
                {formatCurrency(subscription.price, subscription.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {localizedLabel(CYCLE_LABELS[subscription.billingCycle], locale)}
              </p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t("subscription.moreActions")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit?.(subscription.id)}>
                  {t("common.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive"
                >
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="col-span-full flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="max-w-full shrink-0 overflow-hidden whitespace-nowrap text-xs"
                style={categoryBadgeStyle}
              >
                <TruncatedTooltipText text={categoryLabel} className="block max-w-full" />
              </Badge>
              <Badge
                variant="outline"
                className={cn("shrink-0 whitespace-nowrap text-xs", statusStyles[subscription.status])}
              >
                {localizedLabel(STATUS_LABELS[subscription.status], locale)}
              </Badge>
            </div>
          </div>

          {/* 日期信息 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {/* 开始日期 */}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              <span className="text-xs">
                {t("subscription.card.startPrefix")} {formatDateOnly(subscription.startDate)}
              </span>
            </div>
            
            {/* 下次账单信息 */}
            <div className={cn(
              "flex items-center gap-1.5",
              isRenewingSoon ? "text-warning" : "text-muted-foreground"
            )}>
              <Calendar className="h-3.5 w-3.5" />
              <span className="text-xs">
                {isRenewingSoon ? (
                  daysUntilRenewal === 0 ? t("subscription.card.renewsToday") : t("subscription.card.renewsInDays", { days: daysUntilRenewal })
                ) : (
                  t("subscription.card.duePrefix", { date: formatDateOnly(subscription.nextBillingDate) })
                )}
              </span>
            </div>

            {/* 带图标的付款方式 */}
            {subscription.paymentMethod && (() => {
              const paymentConfig = config.paymentMethods.find(
                m => m.value === subscription.paymentMethod
              );
              return (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  {paymentConfig?.icon ? (
                    <AuthorizedImage src={paymentConfig.icon} alt="" className="h-3.5 w-3.5 object-contain" />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5" />
                  )}
                  <span className="text-xs">{paymentConfig ? label(paymentConfig.labels) : subscription.paymentMethod}</span>
                </div>
              );
            })()}

            {/* 提醒设置，仅列表模式展示 */}
            {viewMode === 'list' && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Bell className="h-3.5 w-3.5" />
                <span className="text-xs">
                  {t("subscription.card.reminderDays", { days: subscription.reminderDays })}
                </span>
              </div>
            )}
          </div>

          {/* 试用提醒 */}
          {isTrialEndingSoon && subscription.trialEndDate && (
            <div className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              <span className="font-medium">
                {t("subscription.card.trialEnds", { date: formatDateOnly(subscription.trialEndDate, "monthDay") })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>

    <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("subscription.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("subscription.deleteDescription", { name: subscription.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
