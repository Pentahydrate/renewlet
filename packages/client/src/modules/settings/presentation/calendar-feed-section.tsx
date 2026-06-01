import { useState } from "react";
import { CalendarDays, CalendarPlus, Clipboard, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { useI18n } from "@/i18n/I18nProvider";
import { toWebcalUrl } from "@/shared/browser/calendar-links";
import { LoadingButtonContent } from "./settings-shared-controls";

interface CalendarFeedSectionProps {
  enabled: boolean;
  feedUrl: string | null;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  onCreate: () => void | Promise<void>;
  onCopy: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
}

export function CalendarFeedSection({
  enabled,
  feedUrl,
  isLoading,
  isCreating,
  isDeleting,
  onCreate,
  onCopy,
  onDelete,
  onRegenerate,
}: CalendarFeedSectionProps) {
  const { t } = useI18n();
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const busy = isLoading || isCreating || isDeleting;
  const webcalUrl = feedUrl ? toWebcalUrl(feedUrl) : null;
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{t("settings.calendarFeed")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.calendarFeedHelp")}</p>
          </div>
        </div>
        <Badge variant={enabled ? "default" : "secondary"} className="w-fit shrink-0">
          {enabled ? t("settings.calendarFeedEnabled") : t("settings.calendarFeedDisabled")}
        </Badge>
      </div>

      <div className="grid gap-4">
        {feedUrl ? (
          <div className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input value={feedUrl} readOnly className="border-border bg-secondary font-mono text-xs" aria-label={t("settings.calendarFeedUrl")} />
              <Button type="button" variant="default" onClick={onCopy} disabled={busy} className="justify-center gap-2">
                <Clipboard className="h-4 w-4" />
                {t("settings.calendarFeedCopy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.calendarFeedOneTimeHelp")}</p>
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">{t("settings.calendarFeedDisabledHelp")}</p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {webcalUrl ? (
            <Button variant="outline" size="sm" asChild className="justify-center gap-2 border-border">
              {/* webcal 只交给系统/浏览器协议处理器；Google 和 Outlook 仍需要用户复制 HTTPS URL 去订阅。 */}
              <a href={webcalUrl}>
                <CalendarPlus className="h-4 w-4" />
                {t("settings.calendarFeedOpenSystem")}
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            size={feedUrl ? "sm" : "default"}
            variant={feedUrl ? "outline" : "default"}
            onClick={feedUrl ? () => setConfirmRegenerateOpen(true) : onCreate}
            disabled={busy}
            className="justify-center gap-2 border-border"
          >
            <RefreshCw className="h-4 w-4" />
            <LoadingButtonContent loading={isCreating} loadingLabel={t("common.saving")}>
              {enabled ? t("settings.calendarFeedRegenerate") : t("settings.calendarFeedGenerate")}
            </LoadingButtonContent>
          </Button>
          {enabled ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy} className="justify-center gap-2 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
              <LoadingButtonContent loading={isDeleting} loadingLabel={t("common.saving")}>
                {t("settings.calendarFeedRevoke")}
              </LoadingButtonContent>
            </Button>
          ) : null}
        </div>
      </div>
      <AlertDialog open={confirmRegenerateOpen} onOpenChange={setConfirmRegenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.calendarFeedRegenerateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.calendarFeedRegenerateDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onRegenerate();
              }}
            >
              {t("settings.calendarFeedRegenerate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
