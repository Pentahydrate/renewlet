/**
 * 裁剪后上传图片 Hook（LogoPicker / IconPicker 共用）。
 *
 * 目标：
 * - 位图：选择本地文件 -> 打开裁剪弹窗 -> 先用 dataURL 预览 -> 后台上传 -> 用 `/api/app/assets/...` 替换
 * - SVG/ICO：选择本地文件 -> 先用 dataURL 预览 -> 后台上传原始文件 -> 用 `/api/app/assets/...` 替换
 * - 同时需要“取消旧上传结果回写”（用户在上传期间又改选了新的图片）
 *
 * 状态链路：
 * ```
 * 文件输入 -> FileReader(dataURL) -> 裁剪弹窗或直接上传 SVG
 * 裁剪完成/直接 SVG -> 预览(dataURL) -> 上传 -> /api/assets URL -> onChange
 * 选择远端/清空 -> token++ -> 忽略过期上传
 * ```
 *
 * 注意： dataURL 只允许作为临时预览，不能写入上层表单或数据库。
 * 注意： token 计数是本 Hook 的轻量状态机；不要替换成单个 boolean，否则无法区分“旧上传完成”和“当前上传完成”。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { uploadImageDataUrl, uploadImageFile, validateImageFileForUpload } from "@/lib/upload-image";
import { imageExtensionForMime, isIcoImageMime, isSvgImageMime, uploadMimeTypeForFile } from "@/lib/upload-constraints";
import { getDisplayErrorMessage } from "@/lib/display-error";
import type { UploadKind } from "@/lib/api/schemas/media";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";

/** 裁剪上传流程的状态机状态。 */
export type UploadStatus = "idle" | "uploading" | "error";

/** 裁剪上传 Hook 的调用参数。 */
export interface UseCroppedImageUploadOptions {
  /** 上传用途：决定存储路径与后端校验逻辑。 */
  kind: UploadKind;
  /** 上传时用的文件名（仅用于 multipart filename；最终对象名由后端生成）。 */
  filename: string;
  /** 成功后（或用户选择/清空）输出到上层的最终 URL。 */
  onChange: (url: string | undefined) => void;
  /** 可选：把上传状态同步到外层（用于禁用“保存/确认”按钮等）。 */
  onUploadStatusChange?: ((status: UploadStatus) => void) | undefined;
}

export interface UseCroppedImageUploadResult {
  /** 文件输入框 ref。 */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 裁剪弹窗开关。 */
  cropDialogOpen: boolean;
  /** 设置裁剪弹窗开关。 */
  setCropDialogOpen: (open: boolean) => void;
  /** 待裁剪图片 data URL（给 ImageCropDialog 用）。 */
  uploadedImage: string;
  /** 当前上传状态。 */
  uploadStatus: UploadStatus;
  /** 上传完成前的预览（data URL）；成功后会清空并由外层 value 接管。 */
  previewUrl: string | undefined;
  /** 最近一次上传/读取失败原因。 */
  uploadError: string | null;
  /** `<input type=file>` 的 onChange。 */
  handleFileUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  /** ImageCropDialog 的 onCropComplete。 */
  handleCropComplete: (croppedImage: string) => Promise<void>;
  /**
   * 用户从“搜索结果”选择 URL 或点击“清空”时调用：
   * - 会取消旧上传结果回写
   * - 会把 uploadStatus 重置为 idle
   */
  applyValue: (value: string | undefined) => void;
}

/** 管理“本地文件 -> 裁剪 -> 临时预览 -> 上传资产 URL”的完整异步链路。 */
export function useCroppedImageUpload(options: UseCroppedImageUploadOptions): UseCroppedImageUploadResult {
  const { kind, filename, onChange, onUploadStatusChange } = options;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTokenRef = useRef(0);
  const fileReadTokenRef = useRef(0);
  const fileReaderRef = useRef<FileReader | null>(null);

  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [uploadedImage, setUploadedImage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const reportUploadStatus = useCallback(
    (status: UploadStatus) => {
      setUploadStatus(status);
      if (status !== "error") setUploadError(null);
      onUploadStatusChange?.(status);
    },
    [onUploadStatusChange],
  );

  // 组件卸载时“取消”可能仍在进行的上传，避免异步回调更新已卸载组件状态。
  useEffect(() => {
    return () => {
      uploadTokenRef.current += 1;
      fileReadTokenRef.current += 1;
      fileReaderRef.current?.abort();
      fileReaderRef.current = null;
    };
  }, []);

  const uploadOriginalFile = useCallback(
    async (file: File, previewDataUrl: string, mimeType: string) => {
      setPreviewUrl(previewDataUrl);
      setUploadedImage("");
      setCropDialogOpen(false);

      uploadTokenRef.current += 1;
      const token = uploadTokenRef.current;
      reportUploadStatus("uploading");

      try {
        const result = await uploadImageFile({
          file,
          kind,
          // 扩展名按 MIME 重新生成，避免 `.png` 文件名包着 SVG/ICO 时误导后端或下载端。
          filename: filename.replace(/\.[^.]*$/, `.${imageExtensionForMime(mimeType) ?? "png"}`),
        });

        if (uploadTokenRef.current !== token) return;

        setPreviewUrl(undefined);
        reportUploadStatus("idle");
        onChange(result.url);
      } catch (err: unknown) {
        console.error("Image upload failed:", err);
        if (uploadTokenRef.current !== token) return;
        setUploadError(getDisplayErrorMessage(err, translate(getApiLocale(), "media.uploadFailedRetry")));
        reportUploadStatus("error");
      }
    },
    [filename, kind, onChange, reportUploadStatus],
  );

  const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadTokenRef.current += 1;
      const validationError = validateImageFileForUpload(file);
      if (validationError) {
        console.warn(validationError);
        setUploadedImage("");
        setCropDialogOpen(false);
        setUploadError(validationError);
        reportUploadStatus("error");
        e.target.value = "";
        return;
      }

      const mimeType = uploadMimeTypeForFile(file);
      fileReaderRef.current?.abort();
      // 先递增读取 token，再创建 FileReader；这样旧 reader 的 onload 即便排队完成也不会打开裁剪框。
      const token = fileReadTokenRef.current + 1;
      fileReadTokenRef.current = token;
      const reader = new FileReader();
      fileReaderRef.current = reader;
      reader.onload = (event) => {
        // FileReader 无法与 React 生命周期天然绑定；token 保证用户快速重选文件时只打开最后一张图。
        if (fileReadTokenRef.current !== token) return;
        const result = event.target?.result;
        if (typeof result === "string") {
          if (isSvgImageMime(mimeType) || isIcoImageMime(mimeType)) {
            // SVG/ICO 保留原始文件上传，避免裁剪 canvas 把矢量图或多尺寸 ICO 退化成单张位图。
            void uploadOriginalFile(file, result, mimeType);
            return;
          }
          setUploadedImage(result);
          setCropDialogOpen(true);
          reportUploadStatus("idle");
        }
      };
      reader.onerror = () => {
        if (fileReadTokenRef.current !== token) return;
        setUploadError(translate(getApiLocale(), "media.readImageFailed"));
        reportUploadStatus("error");
      };
      reader.onloadend = () => {
        if (fileReaderRef.current === reader) fileReaderRef.current = null;
      };
      reader.readAsDataURL(file);
    }

    // 清空 input，允许用户选择同一个文件进行重试。
    e.target.value = "";
  }, [reportUploadStatus, uploadOriginalFile]);

  const handleCropComplete = useCallback(
    async (croppedImage: string) => {
      // 立即更新预览（仅 UI，不往外层写 data URL，避免被持久化）
      setPreviewUrl(croppedImage);
      setUploadedImage("");

      // 后台上传，成功后把 data URL 替换成 /api/assets/... URL
      uploadTokenRef.current += 1;
      const token = uploadTokenRef.current;
      reportUploadStatus("uploading");

      try {
        const result = await uploadImageDataUrl({
          dataUrl: croppedImage,
          kind,
          filename,
        });

        // 如果用户在上传期间又选了新的图片/清空，则忽略旧上传结果。
        // 这是乐观预览场景的核心竞态防御。
        // 为什么不能直接 abort 上传：底层 multipart 请求可能已经到达后端；前端至少要阻止旧 URL 回写表单。
        if (uploadTokenRef.current !== token) return;

        setPreviewUrl(undefined);
        reportUploadStatus("idle");
        onChange(result.url);
      } catch (err: unknown) {
        console.error("Image upload failed:", err);
        if (uploadTokenRef.current !== token) return;
        // 上传失败：继续展示预览，但禁止外层“保存/确认”，直到用户重试/改选/清空
        setUploadError(getDisplayErrorMessage(err, translate(getApiLocale(), "media.uploadFailedRetry")));
        reportUploadStatus("error");
      }
    },
    [filename, kind, onChange, reportUploadStatus],
  );

  const applyValue = useCallback(
    (value: string | undefined) => {
      // 选择远端 URL 或清空时，取消之前可能存在的上传结果回写
      uploadTokenRef.current += 1;
      fileReadTokenRef.current += 1;
      fileReaderRef.current?.abort();
      fileReaderRef.current = null;
      setPreviewUrl(undefined);
      reportUploadStatus("idle");
      onChange(value);
    },
    [onChange, reportUploadStatus],
  );

  return {
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
  };
}
