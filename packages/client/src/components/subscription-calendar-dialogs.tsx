/**
 * 续费日历弹窗组合。
 *
 * 架构位置：SubscriptionCalendar 负责日期网格和事件聚合，本文件只展示选中日期/订阅详情，
 * 并把编辑动作交回上层订阅 CRUD 流程。
 *
 * 注意： 弹窗中的金额、周期和状态标签必须继续复用 subscription domain 常量，避免日历视图口径分叉。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Subscription } from '@/types/subscription';
import { STATUS_LABELS, CYCLE_LABELS } from '@/types/subscription';
import { Button } from '@/components/ui/button';
import { CalendarDays, ExternalLink, Edit2, X } from 'lucide-react';
import { Drawer } from 'vaul';
import { AuthorizedImage } from '@/components/authorized-image';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { TruncatedTooltipText } from '@/components/ui/truncated-tooltip-text';
import { useCustomConfig } from '@/contexts/CustomConfigContext';
import { useI18n } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';

const DEFAULT_LOGO_FALLBACK_COLOR = "hsl(var(--primary))";

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
}

export function SubscriptionDetailDialog({
  open,
  onOpenChange,
  subscription,
  onEditSubscription,
}: SubscriptionDetailDialogProps) {
  const { config } = useCustomConfig();
  const { t, label, formatDateOnly, formatCurrency } = useI18n();
  const category = subscription
    ? config.categories.find((item) => item.value === subscription.category)
    : undefined;
  const categoryColor = category?.color ?? DEFAULT_LOGO_FALLBACK_COLOR;

  const handleEdit = () => {
    if (subscription && onEditSubscription) {
      onOpenChange(false);
      onEditSubscription(subscription);
    }
  };

  return (
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
                <Badge variant={subscription.status === 'active' ? 'default' : 'secondary'}>
                  {label(STATUS_LABELS[subscription.status])}
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
                <span>{t("reminder.days", { days: subscription.reminderDays })}</span>
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

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1 border-border"
                onClick={() => onOpenChange(false)}
              >
                {t("common.close")}
              </Button>
              {onEditSubscription && (
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary-glow"
                  onClick={handleEdit}
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  {t("common.edit")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface DaySubscriptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDaySubs: CalendarDaySubscriptions | null;
  onSelectSubscription: (subscription: Subscription) => void;
  isMobile?: boolean | undefined;
}

interface DaySubscriptionsListProps {
  subscriptions: Subscription[];
  onSelectSubscription: (subscription: Subscription) => void;
}

function DaySubscriptionsList({ subscriptions, onSelectSubscription }: DaySubscriptionsListProps) {
  const { config } = useCustomConfig();
  const { label, formatCurrency } = useI18n();

  return (
    <div className="grid gap-2">
      {subscriptions.map((sub) => (
        <button
          key={sub.id}
          type="button"
          onClick={() => onSelectSubscription(sub)}
          className="group flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left transition-colors hover:bg-secondary/60"
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
          <div className="text-right">
            <p className="font-semibold text-foreground">
              {formatCurrency(sub.price, sub.currency)}
            </p>
            <Badge variant={sub.status === 'active' ? 'default' : 'secondary'} className="text-xs">
              {label(STATUS_LABELS[sub.status])}
            </Badge>
          </div>
        </button>
      ))}
    </div>
  );
}

export function DaySubscriptionsDialog({
  open,
  onOpenChange,
  selectedDaySubs,
  onSelectSubscription,
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
            <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] min-h-[42dvh] w-full max-w-lg flex-col rounded-t-lg border border-border bg-card text-card-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4">
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
          <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
            <DaySubscriptionsList
              subscriptions={selectedDaySubs.subscriptions}
              onSelectSubscription={onSelectSubscription}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
