/**
 * 续费日历弹窗组合。
 *
 * 架构位置：SubscriptionCalendar 负责日期网格和事件聚合，本文件只展示选中日期/订阅详情，
 * 并把编辑动作交回上层订阅 CRUD 流程。
 *
 * 注意： 弹窗中的金额、周期和状态标签必须继续复用 subscription domain 常量，避免日历视图口径分叉。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Subscription, SubscriptionStatus } from '@/types/subscription';
import { DEFAULT_NOTIFICATION_REMINDER_DAYS, INHERIT_REMINDER_DAYS, STATUS_LABELS, CYCLE_LABELS } from '@/types/subscription';
import { Button } from '@/components/ui/button';
import { CalendarDays, CalendarPlus, ExternalLink, Edit2, X } from 'lucide-react';
import { Drawer } from 'vaul';
import { AuthorizedImage } from '@/components/authorized-image';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { TruncatedTooltipText } from '@/components/ui/truncated-tooltip-text';
import { useCustomConfig } from '@/contexts/CustomConfigContext';
import { useI18n } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import type { DateOnly } from '@/lib/time/date-only';
import { getEffectiveSubscriptionStatus } from '@/modules/subscriptions/domain/subscription-status';
import { useSettings } from '@/hooks/use-settings';
import { AddToCalendarDialog } from '@/components/add-to-calendar-dialog';

const DEFAULT_LOGO_FALLBACK_COLOR = "hsl(var(--primary))";

const statusBadgeClassNames = {
  trial: "border-warning/20 bg-warning/10 text-warning",
  active: "border-success/20 bg-success/10 text-success",
  expired: "border-destructive/20 bg-destructive/10 text-destructive",
  paused: "border-muted bg-muted text-muted-foreground",
  cancelled: "border-destructive/20 bg-destructive/10 text-destructive",
} satisfies Record<SubscriptionStatus, string>;

type LogoTileStyle = CSSProperties & {
  "--subscription-logo-fallback": string;
};

interface CalendarSubscriptionLogoProps {
  subscription: Subscription;
  categoryColor: string | undefined;
  className?: string | undefined;
}

function CalendarSubscriptionLogo({ subscription, categoryColor, className }: CalendarSubscriptionLogoProps) {
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [subscription.logo]);

  const logoTileStyle: LogoTileStyle = {
    "--subscription-logo-fallback": categoryColor ?? DEFAULT_LOGO_FALLBACK_COLOR,
  };

  return (
    <div
      className={cn(
        "subscription-logo-tile flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border text-sm font-bold",
        className,
      )}
      style={logoTileStyle}
    >
      {subscription.logo && !logoLoadFailed ? (
        <AuthorizedImage
          src={subscription.logo}
          alt={subscription.name}
          className="subscription-logo-image h-full w-full object-contain p-1"
          onError={() => setLogoLoadFailed(true)}
        />
      ) : (
        <span className="subscription-logo-fallback">{subscription.name.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

export interface CalendarDaySubscriptions {
  date: Date;
  subscriptions: Subscription[];
}

export interface SubscriptionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription | null;
  onEditSubscription: ((subscription: Subscription) => void) | undefined;
  today: DateOnly | string;
}

export function SubscriptionDetailDialog({
  open,
  onOpenChange,
  subscription,
  onEditSubscription,
  today,
}: SubscriptionDetailDialogProps) {
  const { config } = useCustomConfig();
  const { data: settings } = useSettings();
  const { t, label, formatDateOnly, formatCurrency } = useI18n();
  const [showAddToCalendarDialog, setShowAddToCalendarDialog] = useState(false);
  const category = subscription
    ? config.categories.find((item) => item.value === subscription.category)
    : undefined;
  const categoryColor = category?.color ?? DEFAULT_LOGO_FALLBACK_COLOR;
  // 详情弹窗可能被不同入口复用，状态标签也走有效状态，避免绕过日历筛选时退回原始 active/trial。
  const effectiveStatus = subscription ? getEffectiveSubscriptionStatus(subscription, today) : null;
  const inheritedReminderDays = settings?.notificationReminderDays ?? DEFAULT_NOTIFICATION_REMINDER_DAYS;

  const handleEdit = () => {
    if (subscription && onEditSubscription) {
      onOpenChange(false);
      onEditSubscription(subscription);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold flex items-center gap-3">
              {subscription ? (
                <CalendarSubscriptionLogo subscription={subscription} categoryColor={categoryColor} />
              ) : null}
              {subscription?.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {subscription
                ? t("calendar.detailDescription", { name: subscription.name })
                : t("calendar.detailFallbackDescription")}
            </DialogDescription>
          </DialogHeader>

          {subscription && (
            <div className="grid gap-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(subscription.price, subscription.currency)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {label(CYCLE_LABELS[subscription.billingCycle])}
                  </p>
                </div>
                <div className="text-right">
                  <Badge
                    variant="outline"
                    className={effectiveStatus ? statusBadgeClassNames[effectiveStatus] : undefined}
                  >
                    {effectiveStatus ? label(STATUS_LABELS[effectiveStatus]) : null}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("calendar.category")}</span>
                  <span>{category ? label(category.labels) : subscription.category}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("calendar.nextBilling")}</span>
                  <span>{formatDateOnly(subscription.nextBillingDate, "full")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("calendar.startDate")}</span>
                  <span>{formatDateOnly(subscription.startDate, "full")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("calendar.reminder")}</span>
                  <span>
                    {subscription.reminderDays === INHERIT_REMINDER_DAYS
                      ? t("subscription.card.reminderInherit", { days: inheritedReminderDays })
                      : t("reminder.days", { days: subscription.reminderDays })}
                  </span>
                </div>
                {subscription.tags && subscription.tags.length > 0 && (
                  <div className="flex justify-between text-sm items-start">
                    <span className="text-muted-foreground">{t("subscription.field.tags")}</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {subscription.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {subscription.website && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("subscription.field.website")}</span>
                    <a
                      href={subscription.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      {t("calendar.visit")} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                {subscription.notes && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-sm text-muted-foreground mb-1">{t("subscription.field.notes")}</p>
                    <p className="text-sm">{subscription.notes}</p>
                  </div>
                )}
              </div>

              <div className={cn("grid gap-2 pt-4", onEditSubscription ? "sm:grid-cols-[1fr_1.35fr_1fr]" : "sm:grid-cols-2")}>
                <Button
                  variant="outline"
                  className="border-border"
                  onClick={() => onOpenChange(false)}
                >
                  {t("common.close")}
                </Button>
                <Button
                  variant="outline"
                  className="border-border"
                  onClick={() => {
                    setShowAddToCalendarDialog(true);
                    onOpenChange(false);
                  }}
                >
                  <CalendarPlus className="h-4 w-4" />
                  {t("subscription.addToCalendar")}
                </Button>
                {onEditSubscription && (
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary-glow"
                    onClick={handleEdit}
                  >
                    <Edit2 className="h-4 w-4" />
                    {t("common.edit")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {showAddToCalendarDialog && (
        <AddToCalendarDialog
          open={showAddToCalendarDialog}
          onOpenChange={setShowAddToCalendarDialog}
          subscription={subscription}
        />
      )}
    </>
  );
}

export interface DaySubscriptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDaySubs: CalendarDaySubscriptions | null;
  onSelectSubscription: (subscription: Subscription) => void;
  today: DateOnly | string;
  isMobile?: boolean | undefined;
}

interface DaySubscriptionsListProps {
  subscriptions: Subscription[];
  onSelectSubscription: (subscription: Subscription) => void;
  today: DateOnly | string;
}

function DaySubscriptionsList({ subscriptions, onSelectSubscription, today }: DaySubscriptionsListProps) {
  const { config } = useCustomConfig();
  const { label, formatCurrency } = useI18n();

  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-2" data-testid="calendar-day-subscription-list">
      {subscriptions.map((sub) => {
        // 当天列表和详情弹窗保持同一口径，确保旧过期数据不会在同一个日历流程里显示成不同状态。
        const effectiveStatus = getEffectiveSubscriptionStatus(sub, today);

        return (
          <button
            key={sub.id}
            type="button"
            onClick={() => onSelectSubscription(sub)}
            className="group flex min-w-0 w-full max-w-full items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left transition-colors hover:bg-secondary/60"
            data-testid="calendar-day-subscription-item"
          >
            <CalendarSubscriptionLogo
              subscription={sub}
              categoryColor={
                config.categories.find((item) => item.value === sub.category)?.color ??
                DEFAULT_LOGO_FALLBACK_COLOR
              }
            />
            <div className="min-w-0 flex-1">
              <TruncatedTooltipText as="p" text={sub.name} className="text-sm font-medium" />
              <p className="text-xs text-muted-foreground">
                {label(CYCLE_LABELS[sub.billingCycle])}
              </p>
            </div>
            <div className="min-w-0 max-w-[42%] shrink-0 text-right">
              <p className="truncate font-semibold text-foreground">
                {formatCurrency(sub.price, sub.currency)}
              </p>
              <Badge
                variant="outline"
                className={cn("max-w-full truncate text-xs", statusBadgeClassNames[effectiveStatus])}
              >
                {label(STATUS_LABELS[effectiveStatus])}
              </Badge>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function DaySubscriptionsDialog({
  open,
  onOpenChange,
  selectedDaySubs,
  onSelectSubscription,
  today,
  isMobile = false,
}: DaySubscriptionsDialogProps) {
  const { t, formatDateTime } = useI18n();
  const selectedDayLabel = selectedDaySubs
    ? formatDateTime(selectedDaySubs.date, { month: "short", day: "numeric" })
    : "";

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
        {open && (
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <Drawer.Content className="h5-drawer-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex min-h-[42dvh] w-full max-w-lg flex-col rounded-t-lg border border-border bg-card text-card-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4">
              <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted" />

              <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
                <div>
                  <Drawer.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
                    <CalendarDays className="h-5 w-5 text-primary" />
                    {selectedDaySubs && t("calendar.dayRenewals", { date: selectedDayLabel })}
                  </Drawer.Title>
                  <Drawer.Description className="sr-only">
                    {selectedDaySubs
                      ? t("calendar.dayListDescription", { date: selectedDayLabel })
                      : t("calendar.dayListFallbackDescription")}
                  </Drawer.Description>
                </div>
                <Drawer.Close asChild>
                  <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-9 w-9 text-muted-foreground">
                    <X className="h-4 w-4" />
                    <span className="sr-only">{t("common.close")}</span>
                  </Button>
                </Drawer.Close>
              </div>

              {selectedDaySubs && (
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                  <DaySubscriptionsList
                    subscriptions={selectedDaySubs.subscriptions}
                    onSelectSubscription={onSelectSubscription}
                    today={today}
                  />
                </div>
              )}
            </Drawer.Content>
          </Drawer.Portal>
        )}
      </Drawer.Root>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {selectedDaySubs && t("calendar.dayRenewals", { date: selectedDayLabel })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {selectedDaySubs
              ? t("calendar.dayListDescription", { date: selectedDayLabel })
              : t("calendar.dayListFallbackDescription")}
          </DialogDescription>
        </DialogHeader>

        {selectedDaySubs && (
          <div className="grid max-h-[calc(var(--app-viewport-height)-8rem)] gap-2 overflow-y-auto">
            <DaySubscriptionsList
              subscriptions={selectedDaySubs.subscriptions}
              onSelectSubscription={onSelectSubscription}
              today={today}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
