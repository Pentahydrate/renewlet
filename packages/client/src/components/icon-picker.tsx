/**
 * 图标选择器（用于“支付方式”等配置项的 icon）。
 *
 * 支持：
 * - 搜索 theSVG 内置品牌图标（testingcf.jsdelivr.net CDN）
 * - 通过关键词生成候选图标 URL（网站 Favicon / 第三方 Favicon 服务）
 * - 上传本地图片并裁剪（ImageCropDialog）
 *
 * 注意：
 * - 图标自动搜索依赖外部资源（网站 favicon / 第三方 favicon 服务），网络不通时可能加载失败（UI 有降级处理）
 *
 * 注意： 该组件被 Custom Config 弹窗用于支付方式图标。上传中/失败状态必须传回 controller，
 * 否则配置可能保存临时 data URL 或失效图片。
 */

import { lazy, Suspense, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Upload, Search, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FaviconResultImage } from '@/components/favicon-result-image';
import { MediaThumbnailButton } from '@/components/media-thumbnail-button';
import { generateFaviconUrls } from '@/lib/favicon';
import { PAYMENT_DOMAINS } from '@/lib/favicon-known-domains';
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/upload-constraints';
import { useFaviconSearch } from '@/hooks/use-favicon-search';
import { useCroppedImageUpload, type UploadStatus } from '@/hooks/use-cropped-image-upload';
import { useTheSvgIconSearch } from '@/hooks/use-thesvg-icon-search';
import { useI18n } from '@/i18n/I18nProvider';

/** 透出上传状态类型，方便配置管理弹窗阻止上传中的保存。 */
export type { UploadStatus };

const SEARCH_POPOVER_CLOSE_RESET_DELAY_MS = 200;

const loadImageCropDialog = () => import('@/components/image-crop-dialog');
const LazyImageCropDialog = lazy(() =>
  loadImageCropDialog().then((mod) => ({ default: mod.ImageCropDialog })),
);

const preloadImageCropDialog = () => {
  void loadImageCropDialog();
};

interface IconPickerProps {
  /** 当前选中的图标 URL/dataURL（可选）。 */
  value?: string | undefined;
  /** 图标变更回调（传入 URL/dataURL；传 undefined 表示清空）。 */
  onChange: (icon: string | undefined) => void;
  /**
   * 上传状态变更回调（可选）。
   *
   * 用途：
   * - 外层表单/弹窗在上传未完成时禁用“保存/确认”，彻底杜绝把临时 data URL 写入数据库/配置。
   */
  onUploadStatusChange?: ((status: UploadStatus) => void) | undefined;
  /** 搜索提示：打开弹窗时可自动填入并触发搜索。 */
  searchHint?: string | undefined;
  /** 尺寸：影响按钮与预览大小。 */
  size?: 'sm' | 'md';
}

/** 常见支付/服务关键词 → 域名映射（用于更准确地取 Logo/Favicon）。 */
// 映射已抽到 `src/lib/favicon-known-domains.ts`，避免与 LogoPicker/服务端重复。

/** 根据名称生成候选图标 URL 列表（去重）。 */
const generateIconUrls = (name: string): string[] =>
  generateFaviconUrls({
    name,
    knownDomains: PAYMENT_DOMAINS,
    fallbackTlds: ["com", "io", "co"],
  });

export function IconPicker({
  value,
  onChange,
  onUploadStatusChange,
  searchHint = '',
  size = 'md',
}: IconPickerProps) {
  const { t } = useI18n();
  const builtInSearch = useTheSvgIconSearch(32);
  const builtInCloseResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = useFaviconSearch({
    autoQuery: searchHint,
    generateUrls: generateIconUrls,
    serverSearch: { kind: "icon" },
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
    kind: "icon",
    filename: "icon.png",
    onChange,
    onUploadStatusChange,
  });

  const iconSize = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const buttonSize = size === 'sm' ? 'h-6 text-xs px-2' : 'h-7 text-xs px-2';
  const displayedIcon = previewUrl ?? value;
  const isAnySearching = search.isSearching || builtInSearch.isSearching;
  const hasAnySearched = search.hasSearched || builtInSearch.hasSearched;
  const hasAnyResults = builtInSearch.icons.length > 0 || search.results.length > 0;

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

  useEffect(() => {
    return () => {
      if (builtInCloseResetTimerRef.current === null) return;
      clearTimeout(builtInCloseResetTimerRef.current);
      builtInCloseResetTimerRef.current = null;
    };
  }, []);

  return (
    <>
      <div className="flex items-center gap-2">
        {/* 图标预览 */}
        <div 
          className={cn(
            "relative rounded-lg border border-border",
            "flex items-center justify-center cursor-pointer",
            "transition-colors",
            displayedIcon ? "media-thumbnail-canvas hover:border-primary" : "bg-secondary/50 hover:bg-secondary/80",
            "overflow-hidden group shrink-0",
            iconSize,
            uploadStatus === "error" && "ring-1 ring-destructive/40"
          )}
          onClick={() => fileInputRef.current?.click()}
          onFocus={preloadImageCropDialog}
          onPointerEnter={preloadImageCropDialog}
        >
          {displayedIcon ? (
            <>
              <div className="relative z-10 h-full w-full p-1">
                <FaviconResultImage
                  src={displayedIcon}
                  alt="Icon"
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
                className="absolute -top-1 -right-1 z-20 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </>
          ) : (
            <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
          )}
          {uploadStatus === "uploading" && (
            <div className="absolute inset-0 z-30 bg-background/60 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
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
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("gap-1", buttonSize)}
              onClick={() => fileInputRef.current?.click()}
              onFocus={preloadImageCropDialog}
              onPointerEnter={preloadImageCropDialog}
            >
              {uploadStatus === "uploading" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {t("media.upload")}
            </Button>

            <Popover open={search.open} onOpenChange={handleSearchOpenChange}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn("gap-1", buttonSize)}
              >
                <Search className="w-3 h-3" />
                {t("media.search")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 border-border bg-card z-50" align="start" sideOffset={8}>
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t("media.searchIcon")}</span>
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
                    placeholder={t("media.searchIconPlaceholder")}
                    value={search.query}
                    onChange={(e) => search.setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && search.search()}
                    className="flex-1 h-8 text-sm border-border bg-secondary"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={search.search}
                    disabled={isAnySearching || !search.query.trim()}
                  >
                    {isAnySearching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>

                {isAnySearching && !hasAnyResults && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  </div>
                )}

                {hasAnyResults && (
                  <div className="max-h-48 grid gap-3 overflow-y-auto pr-1">
                    {builtInSearch.icons.length > 0 && (
                      <div className="grid gap-1.5">
                        <p className="text-xs text-muted-foreground">{t("media.builtInIcons")}</p>
                        <div className="grid grid-cols-4 gap-1.5 p-0.5">
                          {builtInSearch.icons.map((icon) => (
                            <MediaThumbnailButton
                              key={icon.slug}
                              src={icon.iconUrl}
                              alt={icon.title}
                              title={icon.title}
                              size="sm"
                              selected={value === icon.iconUrl}
                              onClick={() => {
                                applyValue(icon.iconUrl);
                                handleSearchOpenChange(false);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {search.results.length > 0 && (
                      <div className="grid gap-1.5">
                        <p className="text-xs text-muted-foreground">{t("media.faviconFallback")}</p>
                        <div className="grid grid-cols-4 gap-1.5 p-0.5">
                          {search.results.map((url, index) => (
                            <MediaThumbnailButton
                              key={url}
                              src={url}
                              alt={`Icon ${index + 1}`}
                              size="sm"
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
                      <div className="flex items-center justify-center py-1 text-xs text-muted-foreground">
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary" />
                        {t("media.loadingMore")}
                      </div>
                    )}
                  </div>
                )}

                {!isAnySearching && hasAnySearched && !hasAnyResults && (
                  <div className="text-center py-4">
                    <p className="text-xs text-muted-foreground">{t("media.iconNotFound")}</p>
                  </div>
                )}

                {uploadStatus === "error" && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <p className="text-xs text-destructive">
                      {uploadError ?? t("media.iconUploadFailed")}
                    </p>
                  </div>
                )}
              </div>
            </PopoverContent>
            </Popover>
          </div>
          {uploadStatus === "error" && (
            <p className="max-w-48 text-xs text-destructive">
              {uploadError ?? t("media.iconUploadFailed")}
            </p>
          )}
        </div>
      </div>

      {cropDialogOpen ? (
        <Suspense fallback={null}>
          <LazyImageCropDialog
            open={cropDialogOpen}
            onOpenChange={setCropDialogOpen}
            imageSrc={uploadedImage}
            onCropComplete={handleCropComplete}
            aspectRatio={1}
            // Icon 在 UI 中展示尺寸很小，限制最大导出尺寸可避免生成超大图片导致上传失败
            maxOutputSize={256}
          />
        </Suspense>
      ) : null}
    </>
  );
}
