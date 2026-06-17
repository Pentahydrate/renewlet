import { useRef, useState, type ReactNode } from "react";
import { Clipboard, ExternalLink, Globe2, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
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

interface PublicStatusPageSectionProps {
  id?: string;
  className?: string;
  enabled: boolean;
  pageUrl: string | null;
  showPrices: boolean;
  publicStatusCurrency: string;
  effectivePublicStatusCurrency: string;
  publicStatusCurrencyOptions: SearchableSelectOption[];
  visibleCount: number;
  hiddenCount: number;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isUpdating: boolean;
  onCreate: () => void | Promise<void>;
  onCopy: (target?: ClipboardCopyTarget | null) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onOpenPage: () => void | Promise<void>;
  onRegenerate: () => void | Promise<void>;
  onShowPricesChange: (checked: boolean) => void | Promise<void>;
  onPublicStatusCurrencyChange: (value: string) => void | Promise<void>;
}

interface PublicStatusLinkRowProps {
  pageUrl: string;
  busy: boolean;
  urlLabel: string;
  copyLabel: string;
  openLabel: string;
  helpText: string;
  onCopy: (target?: ClipboardCopyTarget | null) => void | Promise<void>;
  onOpenPage: () => void | Promise<void>;
}

function PublicStatusLinkRow({
  pageUrl,
  busy,
  urlLabel,
  copyLabel,
  openLabel,
  helpText,
  onCopy,
  onOpenPage,
}: PublicStatusLinkRowProps) {
  const pageUrlInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <Input ref={pageUrlInputRef} value={pageUrl} readOnly className="h-9 border-border bg-secondary font-mono text-xs" aria-label={urlLabel} />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void onCopy(pageUrlInputRef.current);
            }}
            disabled={busy}
            className="justify-center gap-2 border-border"
          >
            <Clipboard className="h-4 w-4" />
            {copyLabel}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onOpenPage} disabled={busy} className="justify-center gap-2 border-border">
            <ExternalLink className="h-4 w-4" />
            {openLabel}
          </Button>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{helpText}</p>
    </div>
  );
}

interface PublicStatusSettingRowProps {
  label: ReactNode;
  description: ReactNode;
  control: ReactNode;
}

function PublicStatusSettingRow({
  label,
  description,
  control,
}: PublicStatusSettingRowProps) {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          {label}
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center pt-0.5">
          {control}
        </div>
      </div>
    </div>
  );
}

/**
 * 管理公开展示页的私密 URL。
 *
 * 公开页 token 是可撤销 bearer secret；UI 只展示完整链接和开关，不把 token 拆到其它状态里。
 */
export function PublicStatusPageSection({
  id,
  className,
  enabled,
  pageUrl,
  showPrices,
  publicStatusCurrency,
  effectivePublicStatusCurrency,
  publicStatusCurrencyOptions,
  visibleCount,
  hiddenCount,
  isLoading,
  isCreating,
  isDeleting,
  isUpdating,
  onCreate,
  onCopy,
  onDelete,
  onOpenPage,
  onRegenerate,
  onShowPricesChange,
  onPublicStatusCurrencyChange,
}: PublicStatusPageSectionProps) {
  const { t } = useI18n();
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const busy = isLoading || isCreating || isDeleting || isUpdating;

  return (
    <section id={id} className={cn("rounded-xl border border-border bg-card p-6", className)}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{t("settings.publicStatus")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.publicStatusHelp")}</p>
          </div>
        </div>
        <Badge variant={enabled ? "default" : "secondary"} className="w-fit shrink-0">
          {enabled ? t("settings.publicStatusEnabled") : t("settings.publicStatusDisabled")}
        </Badge>
      </div>

      {pageUrl ? (
        <div className="grid gap-4">
          <PublicStatusLinkRow
            pageUrl={pageUrl}
            busy={busy}
            urlLabel={t("settings.publicStatusUrl")}
            copyLabel={t("settings.publicStatusCopy")}
            openLabel={t("settings.publicStatusOpen")}
            helpText={t("settings.publicStatusOneTimeHelp")}
            onCopy={onCopy}
            onOpenPage={onOpenPage}
          />

          <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2 lg:gap-6">
            <PublicStatusSettingRow
              label={(
                <Label htmlFor="publicStatusShowPrices" className="cursor-pointer text-sm font-medium">
                  {t("settings.publicStatusShowPrices")}
                </Label>
              )}
              description={t("settings.publicStatusShowPricesHelp")}
              control={(
                <Switch
                  id="publicStatusShowPrices"
                  checked={showPrices}
                  disabled={busy}
                  onCheckedChange={onShowPricesChange}
                  aria-label={t("settings.publicStatusShowPrices")}
                />
              )}
            />

            <div className="grid min-w-0 gap-2">
              <div className="min-w-0">
                <Label className="text-sm font-medium">{t("settings.publicStatusCurrency")}</Label>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("settings.publicStatusCurrencyHelp", { currency: effectivePublicStatusCurrency })}
                </p>
              </div>
              <SearchableSelect
                value={publicStatusCurrency}
                onValueChange={onPublicStatusCurrencyChange}
                options={publicStatusCurrencyOptions}
                placeholder={t("settings.currencyPlaceholder")}
                searchPlaceholder={t("settings.currencySearch")}
                emptyMessage={t("settings.currencyEmpty")}
                disabled={busy}
                className="h-9 w-full border-border bg-background"
                contentClassName="max-w-md"
                aria-label={t("settings.publicStatusCurrency")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {t("settings.publicStatusSummary", { visible: visibleCount, hidden: hiddenCount })}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirmRegenerateOpen(true)}
                disabled={busy}
                aria-busy={isCreating ? true : undefined}
                className="justify-center gap-2 border-border"
              >
                <LoadingButtonContent loading={isCreating} loadingLabel={t("common.saving")}>
                  <RefreshCw className="h-4 w-4" />
                  {t("settings.publicStatusRegenerate")}
                </LoadingButtonContent>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy} aria-busy={isDeleting ? true : undefined} className="justify-center gap-2 text-destructive hover:text-destructive">
                <LoadingButtonContent loading={isDeleting} loadingLabel={t("common.saving")}>
                  <Trash2 className="h-4 w-4" />
                  {t("settings.publicStatusRevoke")}
                </LoadingButtonContent>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.publicStatusDisabledHelp")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.publicStatusSummary", { visible: visibleCount, hidden: hiddenCount })}
            </p>
          </div>
          <Button type="button" size="sm" variant="default" onClick={onCreate} disabled={busy} aria-busy={isCreating ? true : undefined} className="justify-center gap-2 sm:shrink-0">
            <LoadingButtonContent loading={isCreating} loadingLabel={t("common.saving")}>
              <RefreshCw className="h-4 w-4" />
              {t("settings.publicStatusGenerate")}
            </LoadingButtonContent>
          </Button>
          {enabled ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy} aria-busy={isDeleting ? true : undefined} className="justify-center gap-2 text-destructive hover:text-destructive">
              <LoadingButtonContent loading={isDeleting} loadingLabel={t("common.saving")}>
                <Trash2 className="h-4 w-4" />
                {t("settings.publicStatusRevoke")}
              </LoadingButtonContent>
            </Button>
          ) : null}
        </div>
      )}

      <AlertDialog open={confirmRegenerateOpen} onOpenChange={setConfirmRegenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.publicStatusRegenerateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.publicStatusRegenerateDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onRegenerate();
              }}
            >
              {t("settings.publicStatusRegenerate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
