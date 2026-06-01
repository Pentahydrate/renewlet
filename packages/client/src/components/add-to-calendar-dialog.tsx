import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildRenewalCalendarEvent, buildRenewalCalendarIcs, type RenewalCalendarEvent } from "@renewlet/shared/ics";
import { google, office365, outlook, yahoo, type CalendarEvent } from "calendar-link";
import { CalendarDays, CalendarPlus, Clipboard, Download, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useCustomConfig } from "@/contexts/CustomConfigContext";
import { useCreateSubscriptionCalendarFeed, useDeleteSubscriptionCalendarFeed, useSubscriptionCalendarFeedStatus } from "@/hooks/use-calendar-feed";
import { useSettings } from "@/hooks/use-settings";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/I18nProvider";
import { addDateOnly } from "@/lib/time/date-only";
import { buildAndroidCalendarIntentUrl, isAndroidChromeUserAgent, openWebcalUrl, toWebcalUrl } from "@/shared/browser/calendar-links";
import { downloadFile } from "@/shared/browser/download-file";
import {
  CYCLE_LABELS,
  DEFAULT_NOTIFICATION_REMINDER_DAYS,
  INHERIT_REMINDER_DAYS,
  type Subscription,
} from "@/types/subscription";

interface AddToCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription | null;
}

interface ResolvedAddToCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription;
}

interface CalendarProviderLink {
  href: string;
  label: string;
}

interface AddToCalendarContentProps {
  androidCalendarHref: string | undefined;
  androidCalendarLabel: string;
  copyFeedUrlLabel: string;
  downloadLabel: string;
  eventDate: string;
  eventDateLabel: string;
  eventTypeLabel: string;
  eventTypeValue: string;
  feedUrl: string | null;
  feedUrlLabel: string;
  isSubscribing: boolean;
  links: CalendarProviderLink[];
  notice: string;
  onCopyFeedUrl: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
  onSubscribe: () => void;
  regenerateLabel: string;
  servicesLabel: string;
  subscribeLabel: string;
  subscribeLoadingLabel: string;
  syncStatusLabel: string;
  syncStatusValue: string;
}

export function AddToCalendarDialog({ open, onOpenChange, subscription }: AddToCalendarDialogProps) {
  if (!subscription) return null;
  return (
    <ResolvedAddToCalendarDialog
      open={open}
      onOpenChange={onOpenChange}
      subscription={subscription}
    />
  );
}

function ResolvedAddToCalendarDialog({ open, onOpenChange, subscription }: ResolvedAddToCalendarDialogProps) {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const { t, label, formatCurrency, formatDateOnly } = useI18n();
  const { config } = useCustomConfig();
  const { data: settings } = useSettings();
  const subscriptionFeedStatus = useSubscriptionCalendarFeedStatus(subscription.id, open);
  const createSubscriptionFeed = useCreateSubscriptionCalendarFeed();
  const deleteSubscriptionFeed = useDeleteSubscriptionCalendarFeed();
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const visibleFeedUrl = feedUrl ?? subscriptionFeedStatus.data?.feedUrl ?? null;
  useEffect(() => {
    setFeedUrl(null);
  }, [subscription.id]);
  const category = config.categories.find((item) => item.value === subscription.category);
  const paymentMethod = subscription.paymentMethod
    ? config.paymentMethods.find((item) => item.value === subscription.paymentMethod)
    : undefined;
  const categoryLabel = category ? label(category.labels) : subscription.category;
  const paymentMethodLabel = paymentMethod ? label(paymentMethod.labels) : subscription.paymentMethod;
  const billingCycleLabel = label(CYCLE_LABELS[subscription.billingCycle]);
  const globalReminderDays = settings?.notificationReminderDays ?? DEFAULT_NOTIFICATION_REMINDER_DAYS;
  const reminderDays = subscription.reminderDays === INHERIT_REMINDER_DAYS
    ? globalReminderDays
    : subscription.reminderDays;

  const renewalEvent = useMemo<RenewalCalendarEvent>(() => buildRenewalCalendarEvent({
    subscription,
    labels: {
      amount: formatCurrency(subscription.price, subscription.currency),
      billingCycle: billingCycleLabel,
      category: categoryLabel,
      paymentMethod: paymentMethodLabel,
    },
    reminderDays,
    text: {
      amount: ({ amount }) => t("subscription.addToCalendar.description.amount", { amount }),
      billingCycle: (cycle) => t("subscription.addToCalendar.description.billingCycle", { cycle }),
      category: (category) => t("subscription.addToCalendar.description.category", { category }),
      paymentMethod: (paymentMethod) => t("subscription.addToCalendar.description.paymentMethod", { paymentMethod }),
      notes: (notes) => t("subscription.addToCalendar.description.notes", { notes }),
    },
  }), [
    billingCycleLabel,
    categoryLabel,
    formatCurrency,
    paymentMethodLabel,
    reminderDays,
    subscription,
    t,
  ]);

  const calendarEvent = useMemo<CalendarEvent>(() => {
    const event: CalendarEvent = {
      allDay: true,
      busy: false,
      description: renewalEvent.description,
      end: addDateOnly(subscription.nextBillingDate, { days: 1 }),
      start: subscription.nextBillingDate,
      title: subscription.name,
      uid: renewalEvent.uid,
    };
    if (subscription.website) {
      event.url = subscription.website;
    }
    return event;
  }, [
    renewalEvent.description,
    renewalEvent.uid,
    subscription.name,
    subscription.nextBillingDate,
    subscription.website,
  ]);

  const links = useMemo<CalendarProviderLink[]>(() => [
    { href: google(calendarEvent), label: t("subscription.addToCalendarGoogle") },
    { href: outlook(calendarEvent), label: t("subscription.addToCalendarOutlook") },
    { href: office365(calendarEvent), label: t("subscription.addToCalendarOffice365") },
    { href: yahoo(calendarEvent), label: t("subscription.addToCalendarYahoo") },
  ], [calendarEvent, t]);

  const ics = useMemo(() => buildRenewalCalendarIcs({
    name: t("subscription.addToCalendarCalendarName", { name: subscription.name }),
    generatedAt: new Date(),
    events: [renewalEvent],
  }), [renewalEvent, subscription.name, t]);
  const isAndroidChrome = isAndroidChromeUserAgent();
  const androidSystemCalendarHref = useMemo(() => buildAndroidCalendarIntentUrl({
    title: subscription.name,
    description: renewalEvent.description,
    startDate: subscription.nextBillingDate,
    endDate: addDateOnly(subscription.nextBillingDate, { days: 1 }),
    fallbackUrl: links[0]?.href,
  }), [links, renewalEvent.description, subscription.name, subscription.nextBillingDate]);

  const handleSubscribe = useCallback(async () => {
    try {
      const created = await createSubscriptionFeed.mutateAsync(subscription.id);
      setFeedUrl(created.feedUrl);
      openWebcalUrl(created.feedUrl);
      toast.success(t("subscription.addToCalendarSubscribed"), {
        description: t("subscription.addToCalendarSubscribedDescription"),
      });
    } catch {
      toast.error(t("subscription.addToCalendarSubscribeFailed"));
    }
  }, [createSubscriptionFeed, subscription.id, t]);

  const handleRegenerate = useCallback(async () => {
    try {
      await deleteSubscriptionFeed.mutateAsync(subscription.id);
      const created = await createSubscriptionFeed.mutateAsync(subscription.id);
      setFeedUrl(created.feedUrl);
      setConfirmRegenerateOpen(false);
      toast.success(t("subscription.addToCalendarRegenerated"), {
        description: t("subscription.addToCalendarRegeneratedDescription"),
      });
    } catch {
      toast.error(t("subscription.addToCalendarRegenerateFailed"));
    }
  }, [createSubscriptionFeed, deleteSubscriptionFeed, subscription.id, t]);

  const handleCopyFeedUrl = useCallback(async () => {
    if (!visibleFeedUrl) return;
    try {
      await navigator.clipboard.writeText(visibleFeedUrl);
      toast.success(t("subscription.addToCalendarFeedUrlCopied"));
    } catch {
      toast.error(t("subscription.addToCalendarFeedUrlCopyFailed"));
    }
  }, [visibleFeedUrl, t]);

  const handleDownload = useCallback(() => {
    try {
      downloadFile(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `renewlet-${safeCalendarFilename(subscription.id)}.ics`);
      toast.success(t("subscription.addToCalendarDownloaded"));
    } catch {
      toast.error(t("subscription.addToCalendarDownloadFailed"));
    }
  }, [ics, subscription.id, t]);

  const title = t("subscription.addToCalendarTitle");
  const description = t("subscription.addToCalendarDescription", { name: subscription.name });
  const content = (
    <AddToCalendarContent
      androidCalendarHref={isAndroidChrome ? androidSystemCalendarHref : undefined}
      androidCalendarLabel={t("subscription.addToCalendarAndroidSingleEvent")}
      copyFeedUrlLabel={t("subscription.addToCalendarCopyFeedUrl")}
      downloadLabel={t("subscription.addToCalendarDownloadIcs")}
      eventDate={formatDateOnly(subscription.nextBillingDate, "full")}
      eventDateLabel={t("subscription.addToCalendarEventDate")}
      eventTypeLabel={t("subscription.addToCalendarEventType")}
      eventTypeValue={t("subscription.addToCalendarSubscriptionFeed")}
      feedUrl={visibleFeedUrl}
      feedUrlLabel={t("subscription.addToCalendarFeedUrl")}
      isSubscribing={createSubscriptionFeed.isPending || deleteSubscriptionFeed.isPending || subscriptionFeedStatus.isLoading}
      links={links}
      notice={t("subscription.addToCalendarSingleEventNotice")}
      onCopyFeedUrl={handleCopyFeedUrl}
      onDownload={handleDownload}
      onRegenerate={() => setConfirmRegenerateOpen(true)}
      onSubscribe={handleSubscribe}
      regenerateLabel={t("subscription.addToCalendarRegenerate")}
      servicesLabel={t("subscription.addToCalendarOnlineServices")}
      subscribeLabel={visibleFeedUrl ? t("subscription.addToCalendarSubscribeSystem") : t("subscription.addToCalendarGenerateFeed")}
      subscribeLoadingLabel={t("subscription.addToCalendarSubscribeLoading")}
      syncStatusLabel={t("subscription.addToCalendarSyncStatus")}
      syncStatusValue={t("subscription.addToCalendarSubscriptionSync")}
    />
  );

  if (isMobile) {
    return (
      <>
        <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
          {open && (
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
              <Drawer.Content className="h5-drawer-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-border bg-card text-card-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4">
                <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted" />
                <div className="flex items-start justify-between gap-4 border-b border-border px-5 pb-4 pt-4">
                  <div className="min-w-0">
                    <Drawer.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
                      <CalendarPlus className="h-5 w-5 text-primary" />
                      <span className="min-w-0 break-words">{title}</span>
                    </Drawer.Title>
                    <Drawer.Description className="mt-1 text-sm leading-5 text-muted-foreground">
                      {description}
                    </Drawer.Description>
                  </div>
                  <Drawer.Close asChild>
                    <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-9 w-9 text-muted-foreground">
                      <X className="h-4 w-4" />
                      <span className="sr-only">{t("common.close")}</span>
                    </Button>
                  </Drawer.Close>
                </div>
                <div className="min-h-0 overflow-y-auto px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                  {content}
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          )}
        </Drawer.Root>
        <CalendarFeedRegenerateDialog
          open={confirmRegenerateOpen}
          onOpenChange={setConfirmRegenerateOpen}
          onConfirm={handleRegenerate}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="overflow-hidden border-border bg-card p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-base leading-6">
              <CalendarPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 break-words">{title}</span>
            </DialogTitle>
            <DialogDescription className="text-left leading-5">{description}</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            {content}
          </div>
        </DialogContent>
      </Dialog>
      <CalendarFeedRegenerateDialog
        open={confirmRegenerateOpen}
        onOpenChange={setConfirmRegenerateOpen}
        onConfirm={handleRegenerate}
      />
    </>
  );
}

function AddToCalendarContent({
  androidCalendarHref,
  androidCalendarLabel,
  copyFeedUrlLabel,
  downloadLabel,
  eventDate,
  eventDateLabel,
  eventTypeLabel,
  eventTypeValue,
  feedUrl,
  feedUrlLabel,
  isSubscribing,
  links,
  notice,
  onCopyFeedUrl,
  onDownload,
  onRegenerate,
  onSubscribe,
  regenerateLabel,
  servicesLabel,
  subscribeLabel,
  subscribeLoadingLabel,
  syncStatusLabel,
  syncStatusValue,
}: AddToCalendarContentProps) {
  const feedWebcalUrl = feedUrl ? toWebcalUrl(feedUrl) : null;
  return (
    <div className="grid gap-5">
      <dl className="grid divide-y divide-border rounded-md border border-border bg-background/50 text-sm">
        <CalendarMetaRow icon={<CalendarDays className="h-4 w-4 text-primary" />} label={eventDateLabel} value={eventDate} strong />
        <CalendarMetaRow label={eventTypeLabel} value={eventTypeValue} />
        <CalendarMetaRow label={syncStatusLabel} value={syncStatusValue} />
      </dl>

      <div className="grid gap-3">
        {feedWebcalUrl ? (
          <Button variant="default" className="h-10 w-full justify-center" asChild>
            <a href={feedWebcalUrl}>
              <CalendarPlus className="h-4 w-4" />
              {subscribeLabel}
            </a>
          </Button>
        ) : (
          <Button type="button" variant="default" className="h-10 w-full justify-center" onClick={onSubscribe} disabled={isSubscribing}>
            {isSubscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
            {isSubscribing ? subscribeLoadingLabel : subscribeLabel}
          </Button>
        )}
        {feedUrl ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input value={feedUrl} readOnly className="border-border bg-secondary font-mono text-xs" aria-label={feedUrlLabel} />
            <Button type="button" variant="outline" size="sm" className="justify-center border-border" onClick={onCopyFeedUrl}>
              <Clipboard className="h-4 w-4" />
              {copyFeedUrlLabel}
            </Button>
            <div className="sm:col-span-2">
              <Button type="button" variant="ghost" size="sm" className="h-8 justify-center gap-2 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={onRegenerate}>
                <RefreshCw className="h-3.5 w-3.5" />
                {regenerateLabel}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {androidCalendarHref ? (
            <Button variant="outline" size="sm" asChild className="justify-center border-border">
              <a href={androidCalendarHref} rel="noopener noreferrer">
                <CalendarPlus className="h-4 w-4" />
                {androidCalendarLabel}
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" className="justify-center border-border" onClick={onDownload}>
            <Download className="h-4 w-4" />
            {downloadLabel}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{notice}</p>
      </div>

      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">{servicesLabel}</p>
        <div className="overflow-hidden rounded-md border border-border bg-background/50">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-10 items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm text-foreground transition-colors last:border-b-0 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="truncate">{link.label}</span>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarMetaRow({
  icon,
  label,
  strong = false,
  value,
}: {
  icon?: ReactNode;
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
      <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className={strong ? "min-w-0 text-right font-medium text-foreground" : "min-w-0 text-right text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

function safeCalendarFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "subscription";
}

function CalendarFeedRegenerateDialog({
  onConfirm,
  onOpenChange,
  open,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("subscription.addToCalendarRegenerateTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("subscription.addToCalendarRegenerateDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("subscription.addToCalendarRegenerate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
