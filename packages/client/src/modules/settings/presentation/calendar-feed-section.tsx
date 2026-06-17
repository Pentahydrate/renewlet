import { useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { ClipboardCopyTarget } from "@/shared/browser/clipboard";
import { LoadingButtonContent } from "./settings-shared-controls";

interface CalendarFeedSectionProps {
  id?: string;
  className?: string;
  /** 是否已有可用 feed；公开 ICS route 只认 URL 中的高熵 token，不读取登录态。 */
  enabled: boolean;
  /** 当前用户可复制的订阅 URL；为 null 时表示尚未生成或已撤销。 */
  feedUrl: string | null;
  /** 首次读取 feed 状态中，用于统一禁用会改 token 的操作。 */
  isLoading: boolean;
  /** 创建或重新生成 token 中；这两个动作都会让旧 URL 失效。 */
  isCreating: boolean;
  /** 撤销 token 中；完成后公开 ICS URL 应返回同类 404。 */
  isDeleting: boolean;
  onCreate: () => void | Promise<void>;
  onCopy: (target?: ClipboardCopyTarget | null) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onOpenSystem: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
}

/**
 * 展示并管理全局日历订阅 URL。
 *
 * 注意：feed URL 是低权限 bearer secret；UI 只能复制/打开/撤销，不应把 token 拆出来展示或缓存到其它状态。
 */
export function CalendarFeedSection({
  id,
  className,
  enabled,
  feedUrl,
  isLoading,
  isCreating,
  isDeleting,
  onCreate,
  onCopy,
  onDelete,
  onOpenSystem,
  onRegenerate,
}: CalendarFeedSectionProps) {
  const { t } = useI18n();
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const feedUrlInputRef = useRef<HTMLInputElement>(null);
  const busy = isLoading || isCreating || isDeleting;
  return (
    <section id={id} className={cn("rounded-xl border border-border bg-card p-6", className)}>
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
              <Input ref={feedUrlInputRef} value={feedUrl} readOnly className="border-border bg-secondary font-mono text-xs" aria-label={t("settings.calendarFeedUrl")} />
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  void onCopy(feedUrlInputRef.current);
                }}
                disabled={busy}
                className="justify-center gap-2"
              >
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
          {feedUrl ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenSystem} disabled={busy} className="justify-center gap-2 border-border">
              <CalendarPlus className="h-4 w-4" />
              {t("settings.calendarFeedOpenSystem")}
            </Button>
          ) : null}
          <Button
            type="button"
            size={feedUrl ? "sm" : "default"}
            variant={feedUrl ? "outline" : "default"}
            onClick={feedUrl ? () => setConfirmRegenerateOpen(true) : onCreate}
            disabled={busy}
            aria-busy={isCreating ? true : undefined}
            className="justify-center gap-2 border-border"
          >
            <LoadingButtonContent loading={isCreating} loadingLabel={t("common.saving")}>
              <RefreshCw className="h-4 w-4" />
              {enabled ? t("settings.calendarFeedRegenerate") : t("settings.calendarFeedGenerate")}
            </LoadingButtonContent>
          </Button>
          {enabled ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy} aria-busy={isDeleting ? true : undefined} className="justify-center gap-2 text-destructive hover:text-destructive">
              <LoadingButtonContent loading={isDeleting} loadingLabel={t("common.saving")}>
                <Trash2 className="h-4 w-4" />
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
