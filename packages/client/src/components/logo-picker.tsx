/**
 * 订阅 Logo 选择器（用于新增/编辑订阅的 logo）。
 *
 * 支持：
 * - 搜索 theSVG 内置品牌图标（testingcf.jsdelivr.net CDN）
 * - 根据服务名生成候选 Logo（网站 Favicon / 第三方 Favicon 服务）
 * - 上传本地图片并裁剪（ImageCropDialog）
 *
 * 注意：
 * - Logo 自动搜索依赖外部资源（网站 favicon / 第三方 favicon 服务），网络不通时可能加载失败（UI 有降级处理）
 *
 * 状态链路：
 * ```
 * serviceName -> useFaviconSearch -> 选择 URL
 * 文件上传 -> 裁剪 -> useCroppedImageUpload -> /api/app/assets/{id}
 * ```
 *
 * 注意： 外层表单必须关注 uploadStatus，上传中不允许保存订阅，避免 data URL 被持久化。
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Upload, Search, X, Loader2, Image as ImageIcon, Images, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FaviconResultImage } from '@/components/favicon-result-image';
import { MediaThumbnailButton } from '@/components/media-thumbnail-button';
import { generateFaviconUrls } from '@/lib/favicon';
import { SERVICE_DOMAINS } from '@/lib/favicon-known-domains';
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/upload-constraints';
import { useFaviconSearch } from '@/hooks/use-favicon-search';
import { useCroppedImageUpload, type UploadStatus } from '@/hooks/use-cropped-image-upload';
import { useTheSvgIconSearch } from '@/hooks/use-thesvg-icon-search';
import { useUploadedLogoAssets } from '@/hooks/use-uploaded-logo-assets';
import { useI18n } from '@/i18n/I18nProvider';

/** 透出上传状态类型，方便表单弹窗阻止上传中的保存。 */
export type { UploadStatus };

const SEARCH_POPOVER_CLOSE_RESET_DELAY_MS = 200;

const loadImageCropDialog = () => import('@/components/image-crop-dialog');
const LazyImageCropDialog = lazy(() =>
  loadImageCropDialog().then((mod) => ({ default: mod.ImageCropDialog })),
);

const preloadImageCropDialog = () => {
  void loadImageCropDialog();
};

interface LogoPickerProps {
  /** 当前 logo（URL 或 data URL）。 */
  value?: string | undefined;
  /** logo 变更回调（传 undefined 表示清空）。 */
  onChange: (logo: string | undefined) => void;
  /**
   * 上传状态变更回调（可选）。
   *
   * 用途：
   * - 外层表单/弹窗在上传未完成时禁用“保存/确认”，彻底杜绝把临时 data URL 写入数据库。
   */
  onUploadStatusChange?: ((status: UploadStatus) => void) | undefined;
  /** 服务名提示：打开弹窗时可自动填入并触发搜索。 */
  serviceName?: string | undefined;
}

/** 常见订阅服务关键词 → 域名映射（用于更准确地取 Logo/Favicon）。 */
// 映射已抽到 `src/lib/favicon-known-domains.ts`，避免与 IconPicker/服务端重复。

/** 根据服务名生成候选 Logo URL 列表（去重）。 */
const generateLogoUrls = (name: string): string[] =>
  generateFaviconUrls({
    name,
    knownDomains: SERVICE_DOMAINS,
    fallbackTlds: ["com", "io", "co", "app", "org"],
  });

/** LogoPicker 组件。 */
export function LogoPicker({
  value,
  onChange,
  onUploadStatusChange,
  serviceName = '',
}: LogoPickerProps) {
  const { t } = useI18n();
  const builtInSearch = useTheSvgIconSearch(32);
  const uploadedLogos = useUploadedLogoAssets();
  const [uploadedLogosOpen, setUploadedLogosOpen] = useState(false);
  const builtInCloseResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = useFaviconSearch({
    autoQuery: serviceName,
    generateUrls: generateLogoUrls,
    serverSearch: { kind: "logo" },
    onSearch: builtInSearch.search,
    closeResetDelayMs: SEARCH_POPOVER_CLOSE_RESET_DELAY_MS,
  });

  const {
    fileInputRef,
    cropDialogOpen,
    setCropDialogOpen,
    uploadedImage,
    uploadStatus,
    uploadError,
    previewUrl,
    handleFileUpload,
    handleCropComplete,
    applyValue,
  } = useCroppedImageUpload({
    kind: "logo",
    filename: "logo.png",
    onChange,
    onUploadStatusChange,
  });

  const displayedLogo = previewUrl ?? value;
  const isAnySearching = search.isSearching || builtInSearch.isSearching;
  const hasAnySearched = search.hasSearched || builtInSearch.hasSearched;
  const hasAnyResults = builtInSearch.icons.length > 0 || search.results.length > 0;
  const shouldShowResultsArea = hasAnyResults || (!isAnySearching && hasAnySearched);
  const shouldShowBuiltInSection = builtInSearch.hasSearched || builtInSearch.icons.length > 0;

  const clearBuiltInCloseResetTimer = () => {
    if (builtInCloseResetTimerRef.current === null) return;
    clearTimeout(builtInCloseResetTimerRef.current);
    builtInCloseResetTimerRef.current = null;
  };

  const handleSearchOpenChange = (nextOpen: boolean) => {
    clearBuiltInCloseResetTimer();
    search.onOpenChange(nextOpen);
    if (nextOpen) {
      builtInSearch.reset();
      return;
    }

    builtInSearch.cancel();
    builtInCloseResetTimerRef.current = setTimeout(() => {
      builtInCloseResetTimerRef.current = null;
      builtInSearch.reset();
    }, SEARCH_POPOVER_CLOSE_RESET_DELAY_MS);
  };

  const handleUploadedLogosOpenChange = (nextOpen: boolean) => {
    setUploadedLogosOpen(nextOpen);
    if (nextOpen) {
      void uploadedLogos.loadInitial();
    }
  };

  const retryUploadedLogos = () => {
    void uploadedLogos.loadInitial();
  };

  const loadMoreUploadedLogos = () => {
    void uploadedLogos.loadMore();
  };

  useEffect(() => {
    return () => {
      if (builtInCloseResetTimerRef.current === null) return;
      clearTimeout(builtInCloseResetTimerRef.current);
      builtInCloseResetTimerRef.current = null;
    };
  }, []);

  return (
    <>
    <div className="grid gap-2">
      <Label>{t("media.logo")}</Label>
      <div className="flex items-center gap-3">
        {/* Logo 预览/上传区域 */}
        <div
          className={cn(
            "relative w-16 h-16 rounded-xl border-2 border-border",
            "flex items-center justify-center cursor-pointer",
            "transition-colors",
            displayedLogo ? "media-thumbnail-canvas hover:border-primary" : "border-dashed bg-secondary/50 hover:bg-secondary/80",
            "overflow-hidden group"
          )}
          onClick={() => fileInputRef.current?.click()}
          onFocus={preloadImageCropDialog}
          onPointerEnter={preloadImageCropDialog}
        >
          {displayedLogo ? (
            <>
              <div className="relative z-10 h-full w-full p-1">
                <FaviconResultImage
                  src={displayedLogo}
                  alt="Logo"
                  className="media-thumbnail-image"
                  onError={() => applyValue(undefined)}
                />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  applyValue(undefined);
                }}
                className="absolute -top-1 -right-1 z-20 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <ImageIcon className="w-6 h-6 text-muted-foreground" />
          )}
          {uploadStatus === "uploading" && (
            <div className="absolute inset-0 z-30 bg-background/60 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_UPLOAD_ACCEPT}
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {/* 操作按钮 */}
        <div className="grid min-w-0 flex-1 max-w-52 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 text-primary border-primary/30 hover:border-primary hover:bg-primary/10"
            onClick={() => fileInputRef.current?.click()}
            onFocus={preloadImageCropDialog}
            onPointerEnter={preloadImageCropDialog}
          >
            {uploadStatus === "uploading" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {t("media.uploadLogo")}
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Popover open={uploadedLogosOpen} onOpenChange={handleUploadedLogosOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full gap-1.5 border-border px-2 text-xs"
                >
                  <Images className="w-3.5 h-3.5" />
                  {t("media.uploaded")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3 border-border bg-card" align="start" sideOffset={8}>
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("media.uploadedLogo")}</span>
                    <button
                      type="button"
                      onClick={() => handleUploadedLogosOpenChange(false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {uploadedLogos.isLoading && uploadedLogos.assets.length === 0 && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span className="ml-2 text-sm text-muted-foreground">{t("media.loadingUploadedLogo")}</span>
                    </div>
                  )}

                  {uploadedLogos.error && uploadedLogos.assets.length === 0 && (
                    <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                      <p className="text-sm text-destructive">{t("media.uploadedLogoLoadFailed")}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 border-border"
                        onClick={retryUploadedLogos}
                        disabled={uploadedLogos.isLoading}
                      >
                        {uploadedLogos.isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        {t("media.retryUploadedLogo")}
                      </Button>
                    </div>
                  )}

                  {!uploadedLogos.isLoading && !uploadedLogos.error && uploadedLogos.hasLoaded && uploadedLogos.assets.length === 0 && (
                    <div className="text-center py-3">
                      <ImageIcon className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                      <p className="text-sm text-muted-foreground">{t("media.noUploadedLogo")}</p>
                    </div>
                  )}

                  {uploadedLogos.assets.length > 0 && (
                    <div className="max-h-72 grid gap-3 overflow-y-auto pr-1">
                      <div className="grid grid-cols-4 gap-2 p-1">
                        {uploadedLogos.assets.map((asset, index) => {
                          const label = asset.originalName ?? t("media.uploadedLogoOption", { index: index + 1 });
                          return (
                            <MediaThumbnailButton
                              key={asset.id}
                              src={asset.url}
                              alt={label}
                              title={label}
                              selected={value === asset.url}
                              onClick={() => {
                                applyValue(asset.url);
                                handleUploadedLogosOpenChange(false);
                              }}
                            />
                          );
                        })}
                      </div>

                      {uploadedLogos.error && (
                        <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                          <p className="text-xs text-destructive">{t("media.uploadedLogoLoadFailed")}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-2 border-border"
                            onClick={retryUploadedLogos}
                            disabled={uploadedLogos.isLoading}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            {t("media.retryUploadedLogo")}
                          </Button>
                        </div>
                      )}

                      {uploadedLogos.hasMore && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full gap-2 border-border"
                          onClick={loadMoreUploadedLogos}
                          disabled={uploadedLogos.isLoadingMore}
                        >
                          {uploadedLogos.isLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                          {t("media.loadMoreUploadedLogo")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Popover open={search.open} onOpenChange={handleSearchOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full gap-1.5 border-border px-2 text-xs"
                >
                  <Search className="w-3.5 h-3.5" />
                  {t("media.search")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 border-border bg-card" align="start" sideOffset={8}>
                <div className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("media.searchLogo")}</span>
                    <button
                      type="button"
                      onClick={() => handleSearchOpenChange(false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={t("media.searchLogoPlaceholder")}
                      value={search.query}
                      onChange={(e) => search.setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && search.search()}
                      className="flex-1 border-border bg-secondary"
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={search.search}
                      disabled={isAnySearching || !search.query.trim()}
                      className="bg-primary text-primary-foreground"
                    >
                      {isAnySearching ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                    </Button>
                  </div>

                  {isAnySearching && !hasAnyResults && (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span className="ml-2 text-sm text-muted-foreground">{t("media.searching")}</span>
                    </div>
                  )}

                  {shouldShowResultsArea && (
                    <div className="max-h-72 grid gap-4 overflow-y-auto pr-1">
                      {shouldShowBuiltInSection && (
                        <div className="grid gap-2">
                          <p className="text-xs text-muted-foreground">{t("media.builtInIcons")}</p>
                          {builtInSearch.icons.length > 0 ? (
                            <div className="grid grid-cols-4 gap-2 p-1">
                              {builtInSearch.icons.map((icon) => (
                                <MediaThumbnailButton
                                  key={icon.slug}
                                  src={icon.iconUrl}
                                  alt={icon.title}
                                  title={icon.title}
                                  selected={value === icon.iconUrl}
                                  onClick={() => {
                                    applyValue(icon.iconUrl);
                                    handleSearchOpenChange(false);
                                  }}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="rounded-md border border-dashed border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                              {builtInSearch.isSearching
                                ? t("media.searchingBuiltIn")
                                : builtInSearch.error ?? t("media.noBuiltInMatch")}
                            </p>
                          )}
                        </div>
                      )}

                      {search.results.length > 0 && (
                        <div className="grid gap-2">
                          <p className="text-xs text-muted-foreground">{t("media.faviconFallback")}</p>
                          <div className="grid grid-cols-4 gap-2 p-1">
                            {search.results.map((url, index) => (
                              <MediaThumbnailButton
                                key={url}
                                src={url}
                                alt={`Logo option ${index + 1}`}
                                selected={value === url}
                                onClick={() => {
                                  applyValue(url);
                                  handleSearchOpenChange(false);
                                }}
                                onError={() => search.removeResult(url)}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {isAnySearching && (
                        <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary" />
                          {t("media.loadingMore")}
                        </div>
                      )}

                      {!isAnySearching && hasAnySearched && !hasAnyResults && (
                        <div className="text-center py-2">
                          <ImageIcon className="w-10 h-10 mx-auto text-muted-foreground/50 mb-2" />
                          <p className="text-sm text-muted-foreground">
                            {t("media.logoNotFound")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("media.logoNotFoundHint")}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {!isAnySearching && !hasAnySearched && (
                    <p className="text-xs text-center text-muted-foreground py-2">
                      {t("media.searchLogoPrompt")}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {uploadStatus === "error" && (
            <p className="max-w-64 text-xs text-destructive">
              {uploadError ?? t("media.logoUploadFailed")}
            </p>
          )}
        </div>
      </div>
    </div>

    {/* 图片裁剪弹窗 */}
    {cropDialogOpen ? (
      <Suspense fallback={null}>
        <LazyImageCropDialog
          open={cropDialogOpen}
          onOpenChange={setCropDialogOpen}
          imageSrc={uploadedImage}
          onCropComplete={handleCropComplete}
          aspectRatio={1}
          // Logo 在 UI 中展示尺寸很小，限制最大导出尺寸可避免生成超大图片导致上传失败
          maxOutputSize={256}
        />
      </Suspense>
    ) : null}
    </>
  );
}
