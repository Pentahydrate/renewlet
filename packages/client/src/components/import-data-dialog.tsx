import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, CheckCircle2, Database, FileJson, FileUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportPreviewList, recomputePreviewForConflictMode, type PreviewFilter } from "@/components/import-preview-list";
import { ImportFileDropZone, ImportPastePanel, ImportStep, SummaryBadge } from "@/components/import-data-dialog-parts";
import { ImportWallosSourceGuide } from "@/components/import-wallos-source-guide";
import type { DeferredLogoAsset } from "@/components/import-logo-editor";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import type { CustomConfig } from "@/types/config";
import type { AppSettings } from "@/types/subscription";
import {
  MAX_IMPORT_FILE_BYTES,
  type ImportLogoAutoMatch,
  type PreparedImport,
  type WallosImportUser,
} from "@/modules/import-export/domain/import-export-model";
import {
  parseImportFile,
  parseJsonText,
  resolveImportAssets,
  updatePreparedSubscriptionLogo,
  updatePreparedSubscriptionLogos,
} from "@/modules/import-export/domain/wallos-import";
import { formatImportMessage } from "@/modules/import-export/domain/import-message-format";
import { importExportService } from "@/services/import-export-service";
import { invalidateSubscriptionsQueries } from "@/hooks/use-subscriptions";
import { SETTINGS_QUERY_KEY } from "@/hooks/use-settings";
import { mediaCandidateService } from "@/services/media-candidate-service";
import { getDisplayErrorMessage } from "@/lib/display-error";
import {
  importApplyResponseSchema,
  importPayloadSchema,
  type ImportApplyResponse,
  type ImportConflictMode,
  type ImportPayload,
  type ImportPreviewResponse,
} from "@/lib/api/schemas/import-export";
import type { MediaCandidate } from "@/lib/api/schemas/media";

interface ImportDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 导入解析使用当前设置里的 timezone/defaultCurrency/reminder 默认值，不自行读取全局 query。 */
  settings: AppSettings;
  /** Wallos/Renewlet 导入会映射分类、状态、支付方式和货币，必须使用当前已规范化配置。 */
  config: CustomConfig;
}

function parseApplyPayload(value: unknown): ImportPayload {
  return importPayloadSchema.parse(value) as ImportPayload;
}

function parseApplyResult(value: unknown): ImportApplyResponse {
  return importApplyResponseSchema.parse(value) as ImportApplyResponse;
}

class ImportAssetUploadError extends Error {
  constructor(readonly cause: unknown) {
    super("IMPORT_ASSET_UPLOAD_FAILED");
    this.name = "ImportAssetUploadError";
  }
}

const AUTO_LOGO_RESOLVE_BATCH_SIZE = 100;

export function ImportDataDialog({ open, onOpenChange, settings, config }: ImportDataDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [pasteValue, setPasteValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [conflictMode, setConflictMode] = useState<ImportConflictMode>("skip");
  const [wallosUsers, setWallosUsers] = useState<WallosImportUser[]>([]);
  const [selectedWallosUser, setSelectedWallosUser] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [skippedIndexes, setSkippedIndexes] = useState<Set<number>>(new Set());
  const [assetProgress, setAssetProgress] = useState<{ done: number; total: number } | null>(null);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const today = todayDateOnlyInTimeZone(new Date(), settings.timezone);

  const reset = () => {
    setMode("file");
    setPasteValue("");
    setFile(null);
    setPrepared(null);
    setPreview(null);
    setWallosUsers([]);
    setSelectedWallosUser("");
    setError(null);
    setParsing(false);
    setApplying(false);
    setDragActive(false);
    setPreviewFilter("all");
    setSkippedIndexes(new Set());
    setAssetProgress(null);
    setApplyProgress(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    // 导入弹窗关闭即丢弃本地预览、skip 状态和 staged Logo；真正写入只发生在 apply 阶段。
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const resolveAutoLogos = async (nextPrepared: PreparedImport): Promise<PreparedImport> => {
    const assetIndexes = new Set(nextPrepared.assets.map((asset) => asset.subscriptionIndex));
    const items = nextPrepared.payload.subscriptions.flatMap((subscription, index) => {
      if (subscription.logo || assetIndexes.has(index)) return [];
      return [{ id: String(index), name: subscription.name, ...(subscription.website ? { website: subscription.website } : {}) }];
    });
    if (items.length === 0) return nextPrepared;

    const logoOverrides = new Map<number, string | null>();
    const autoMatches: ImportLogoAutoMatch[] = [];
    try {
      // 自动 Logo 只在预览前写入高置信内置候选；favicon 仍留在“修改 Logo”里手动选择，避免弱候选污染导入 payload。
      for (let index = 0; index < items.length; index += AUTO_LOGO_RESOLVE_BATCH_SIZE) {
        const chunk = items.slice(index, index + AUTO_LOGO_RESOLVE_BATCH_SIZE);
        const response = await mediaCandidateService.resolve({
          kind: "logo",
          mode: "auto",
          items: chunk,
          limit: 1,
        });
        for (const item of response.items) {
          const candidate = item.autoCandidate;
          const subscriptionIndex = Number.parseInt(item.id, 10);
          if (!isAutoAssignableImportLogo(candidate) || !Number.isInteger(subscriptionIndex)) continue;
          logoOverrides.set(subscriptionIndex, candidate.url);
          autoMatches.push({
            subscriptionIndex,
            label: candidate.label,
            provider: candidate.provider,
            url: candidate.url,
          });
        }
      }
    } catch (err) {
      console.debug("import auto logo resolve failed:", err);
      return nextPrepared;
    }
    return updatePreparedSubscriptionLogos(nextPrepared, logoOverrides, autoMatches);
  };

  const previewPrepared = async (nextPrepared: PreparedImport, nextConflictMode: ImportConflictMode) => {
    const preparedWithAutoLogos = await resolveAutoLogos(nextPrepared);
    const result = await importExportService.preview(preparedWithAutoLogos.payload, nextConflictMode);
    setPrepared(preparedWithAutoLogos);
    setPreview(result);
    setPreviewFilter("all");
    setSkippedIndexes(new Set());
  };

  const parseFile = async (nextFile: File, wallosUserId?: string) => {
    if (nextFile.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(t("import.fileTooLarge"));
    }
    // 文件类型只做入口提示，真实识别按内容探测；zip/db 解析器只在导入弹窗内动态加载。
    const parsed = await parseImportFile(nextFile, { config, settings, today }, wallosUserId);
    setWallosUsers(parsed.wallosUsers ?? []);
    if (parsed.wallosUsers?.length && !wallosUserId) {
      setSelectedWallosUser(parsed.wallosUsers[0]?.id ?? "");
    }
    await previewPrepared(parsed, conflictMode);
  };

  const handleFileSelected = async (nextFile: File | null) => {
    if (!nextFile) return;
    // 文件对象只保存在弹窗生命周期内；预览失败时清掉 PreparedImport，避免应用上一次成功解析的包。
    setFile(nextFile);
    setParsing(true);
    setError(null);
    try {
      await parseFile(nextFile);
    } catch (err) {
      setPrepared(null);
      setPreview(null);
      setError(err instanceof Error ? formatImportMessage(err.message, t) : t("import.parseFailed"));
    } finally {
      setParsing(false);
    }
  };

  const handleFileDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragActive(false);
    await handleFileSelected(event.dataTransfer.files?.[0] ?? null);
  };

  const handlePastePreview = async () => {
    setFile(null);
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseJsonText(pasteValue, { config, settings, today });
      setWallosUsers(parsed.wallosUsers ?? []);
      if (parsed.wallosUsers?.length) {
        setSelectedWallosUser(parsed.wallosUsers[0]?.id ?? "");
      }
      await previewPrepared(parsed, conflictMode);
    } catch (err) {
      setPrepared(null);
      setPreview(null);
      setError(err instanceof Error ? formatImportMessage(err.message, t) : t("import.parseFailed"));
    } finally {
      setParsing(false);
    }
  };

  const handleConflictModeChange = (value: ImportConflictMode) => {
    setConflictMode(value);
    // 冲突模式只影响已有同源项的 action/summary；预览结果本地重算，执行时服务端仍会重新校验整包。
    setPreview((current) => current ? recomputePreviewForConflictMode(current, value, skippedIndexes) : current);
  };

  const handleWallosUserChange = async (value: string) => {
    setSelectedWallosUser(value);
    setParsing(true);
    setError(null);
    try {
      if (file) {
        await parseFile(file, value);
      } else if (pasteValue.trim()) {
        const parsed = await parseJsonText(pasteValue, { config, settings, today }, value);
        await previewPrepared(parsed, conflictMode);
      }
    } catch (err) {
      setError(err instanceof Error ? formatImportMessage(err.message, t) : t("import.parseFailed"));
    } finally {
      setParsing(false);
    }
  };

  const handleLogoChange = (index: number, value: string | null, asset?: DeferredLogoAsset) => {
    if (!prepared) return;
    setPrepared(updatePreparedSubscriptionLogo(
      prepared,
      index,
      value,
      asset ? { blob: asset.blob, filename: asset.filename, previewUrl: asset.previewUrl } : undefined,
    ));
  };

  const handleSkipChange = (index: number, skipped: boolean) => {
    const nextSkippedIndexes = new Set(skippedIndexes);
    if (skipped) {
      nextSkippedIndexes.add(index);
    } else {
      nextSkippedIndexes.delete(index);
    }
    // 单条跳过只改本地预览 action；apply 会携带 skipIndexes 让服务端重新预览，避免前端 action 被当成事实。
    setSkippedIndexes(nextSkippedIndexes);
    setPreview((current) => current ? recomputePreviewForConflictMode(current, conflictMode, nextSkippedIndexes) : current);
  };

  const handleApply = async () => {
    if (!prepared || !preview || preview.summary.errors > 0) return;
    setApplying(true);
    setError(null);
    setAssetProgress(null);
    setApplyProgress(null);
    try {
      const skipIndexList = [...skippedIndexes].sort((a, b) => a - b);
      const effectivePreview = recomputePreviewForConflictMode(preview, conflictMode, skippedIndexes);
      // 资产上传属于 apply 阶段：预览不产生写入，且 skip 行不会上传 staged/zip Logo。
      let resolvedPayload: unknown;
      try {
        resolvedPayload = await resolveImportAssets(prepared, effectivePreview.items, (done, total) => setAssetProgress({ done, total }));
      } catch (assetError) {
        throw new ImportAssetUploadError(assetError);
      }
      const payload = parseApplyPayload(resolvedPayload);
      const result = parseApplyResult(await importExportService.applyChunked(payload, conflictMode, skipIndexList, (done, total) => setApplyProgress({ done, total })));
      // 导入可能同时写订阅、设置和自定义配置；成功后统一失效，避免页面继续展示导入前缓存。
      await Promise.all([
        invalidateSubscriptionsQueries(queryClient),
        queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["custom-config"] }),
      ]);
      toast({
        title: t("import.successTitle"),
        description: t("import.successDescription", {
          creates: result.summary.creates,
          replaces: result.summary.replaces,
          skips: result.summary.skips,
        }),
      });
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof ImportAssetUploadError
        ? t("import.assetUploadFailed")
        : getDisplayErrorMessage(err, t("import.applyFailed"));
      setError(message);
      toast({ title: message, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        layout="frame"
        className="h5-dialog-frame h5-import-dialog-panel overflow-hidden border-border bg-card p-0 sm:max-w-5xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          uploadButtonRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border bg-secondary/20 px-4 py-5 pr-12 sm:px-6 sm:pr-14">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
              <FileUp className="h-5 w-5" />
            </div>
            <div className="min-w-0 text-left">
              <DialogTitle className="text-xl">{t("import.title")}</DialogTitle>
              <DialogDescription className="mt-1 text-left">{t("import.description")}</DialogDescription>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-background/70 text-xs">
            <ImportStep active done label={t("import.stepSelect")} />
            <ImportStep active={Boolean(preview)} done={Boolean(preview)} label={t("import.stepPreview")} />
            <ImportStep active={Boolean(preview && preview.summary.errors === 0)} label={t("import.stepApply")} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          <Tabs value={mode} onValueChange={(value) => setMode(value as "file" | "paste")} className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:min-w-80">
              <TabsTrigger value="file" className="gap-2">
                <Archive className="h-4 w-4" />
                {t("import.tabFile")}
              </TabsTrigger>
              <TabsTrigger value="paste" className="gap-2">
                <FileJson className="h-4 w-4" />
                {t("import.tabPaste")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="mt-0 space-y-3">
              <ImportFileDropZone
                file={file}
                dragActive={dragActive}
                fileInputRef={fileInputRef}
                uploadButtonRef={uploadButtonRef}
                onFileSelected={(nextFile) => void handleFileSelected(nextFile)}
                onFileDrop={(event) => void handleFileDrop(event)}
                onDragActiveChange={setDragActive}
                chooseFileLabel={t("import.chooseFile")}
                fileEmptyLabel={t("import.fileEmpty")}
                fileHintLabel={t("import.fileHint")}
              />
            </TabsContent>

            <TabsContent value="paste" className="mt-0 space-y-3">
              <ImportPastePanel
                value={pasteValue}
                parsing={parsing}
                onChange={setPasteValue}
                onPreview={() => void handlePastePreview()}
                placeholder={t("import.pastePlaceholder")}
                previewLabel={t("import.preview")}
              />
            </TabsContent>
          </Tabs>

          {error && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {parsing && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {t("import.loading")}
            </div>
          )}

          {preview && (
            <section className="space-y-3" aria-label={t("import.previewTitle")}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{t("import.previewTitle")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t("import.previewCount", { count: preview.summary.total })}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={preview.summary.errors > 0 ? "destructive" : "secondary"}>
                    {preview.summary.errors > 0 ? t("import.summaryError") : t("import.ready")}
                  </Badge>
                  {assetProgress && assetProgress.total > 0 ? (
                    <Badge variant="outline">{t("import.assetProgress", assetProgress)}</Badge>
                  ) : null}
                  {applyProgress && applyProgress.total > 0 ? (
                    <Badge variant="outline">{t("import.applyProgress", applyProgress)}</Badge>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <SummaryBadge label={t("import.summaryCreate")} value={preview.summary.creates} />
                <SummaryBadge label={t("import.summaryReplace")} value={preview.summary.replaces} />
                <SummaryBadge label={t("import.summarySkip")} value={preview.summary.skips} />
                <SummaryBadge label={t("import.summaryWarning")} value={preview.summary.warnings} />
                <SummaryBadge label={t("import.summaryError")} value={preview.summary.errors} danger={preview.summary.errors > 0} />
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/20 p-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium text-foreground">{t("import.optionsTitle")}</p>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("import.conflictDescription")}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {wallosUsers.length > 1 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{t("import.wallosUser")}</label>
                      <Select value={selectedWallosUser} onValueChange={(value) => void handleWallosUserChange(value)}>
                        <SelectTrigger className="h-9 min-w-44 border-border bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {wallosUsers.map((user) => (
                            <SelectItem key={user.id} value={user.id}>{user.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t("import.conflictMode")}</label>
                    <Select value={conflictMode} onValueChange={(value) => void handleConflictModeChange(value as ImportConflictMode)}>
                      <SelectTrigger className="h-9 min-w-44 border-border bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">{t("import.conflictSkip")}</SelectItem>
                        <SelectItem value="replace">{t("import.conflictReplace")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              {prepared?.payload.source === "wallos" ? <ImportWallosSourceGuide /> : null}
              {prepared ? (
                <ImportPreviewList
                  prepared={prepared}
                  preview={preview}
                  filter={previewFilter}
                  skippedIndexes={skippedIndexes}
                  onFilterChange={setPreviewFilter}
                  onLogoChange={handleLogoChange}
                  onSkipChange={handleSkipChange}
                />
              ) : null}
              {prepared?.warnings.length ? (
                <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
                  {prepared.warnings.slice(0, 6).map((warning, warningIndex) => <p key={`${warning}:${warningIndex}`}>{formatImportMessage(warning, t)}</p>)}
                </div>
              ) : null}
            </section>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-card px-4 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t("common.cancel")}</Button>
          <Button type="button" onClick={() => void handleApply()} disabled={!preview || preview.summary.errors > 0 || applying}>
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {t("import.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isAutoAssignableImportLogo(candidate: MediaCandidate | null | undefined): candidate is MediaCandidate {
  return Boolean(
    candidate?.autoAssignable
      && candidate.source === "builtIn"
      && (candidate.confidence === "exact" || candidate.confidence === "strong"),
  );
}
