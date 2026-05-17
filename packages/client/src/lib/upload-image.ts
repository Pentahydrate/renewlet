/**
 * 浏览器端图片上传工具。
 *
 * 架构位置：
 * - ImageCropDialog 输出 data URL，SVG 上传保留原始 File。
 * - 本模块把 data URL 或原始 File 写入 PocketBase `assets` collection。
 *
 * 注意： 客户端校验只是体验优化；PocketBase collection 规则仍是最终安全边界。
 */
import { MAX_IMAGE_BYTES, imageExtensionForMime, isAllowedImageMime, uploadMimeTypeForFile } from "@/lib/upload-constraints";
import type { ApiUploadImageResponse, UploadKind } from "@/lib/api/schemas/media";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";

/**
 * 将 base64 data URL 转为 Blob（用于上传）。
 *
 * 说明：
 * - `ImageCropDialog` 的输出是 data URL（例如 data:image/png;base64,...）
 * - 上传时需要转换成二进制（Blob/File），再用 multipart/form-data 写入 PocketBase。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid data URL");
  }

  const header = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);

  // 只接受标准 base64 data URL；不支持 percent-encoded data URL，避免两套解码路径造成 MIME 校验差异。
  const mimeMatch = /^data:(.+);base64$/i.exec(header);
  const mimeType = (mimeMatch?.[1] ?? "application/octet-stream").trim().toLowerCase();
  if (!isAllowedImageMime(mimeType)) {
    throw new Error(translate(getApiLocale(), "media.imageTypeInvalid"));
  }
  if (!base64) {
    throw new Error("Invalid data URL");
  }

  let binary: string;
  try {
    binary = globalThis.atob(base64);
  } catch {
    throw new Error("Invalid base64 image data");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    // 浏览器 atob 返回 Latin-1 字符串；逐字节写入 Uint8Array 才能保持图片二进制不被 UTF-16 转码破坏。
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: mimeType });
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(translate(getApiLocale(), "media.imageTooLarge", { size: Math.floor(MAX_IMAGE_BYTES / 1024 / 1024) }));
  }
  return blob;
}

/** 客户端文件预检；服务端 collection 规则仍会做最终校验。 */
export function validateImageFileForUpload(file: File): string | null {
  if (!isAllowedImageMime(uploadMimeTypeForFile(file))) return translate(getApiLocale(), "media.imageTypeInvalid");
  if (file.size > MAX_IMAGE_BYTES) {
    return translate(getApiLocale(), "media.imageTooLarge", { size: Math.floor(MAX_IMAGE_BYTES / 1024 / 1024) });
  }
  return null;
}

interface UploadImageDataUrlOptions {
  /** `ImageCropDialog` 输出的 data URL（data:image/*;base64,...）。 */
  dataUrl: string;
  /** 上传用途：logo/icon（决定保存目录）。 */
  kind: UploadKind;
  /** 可选：文件名（只用于上传时的 filename；最终对象名由后端生成）。 */
  filename?: string;
}

interface UploadImageFileOptions {
  /** 原始上传文件（SVG 会走这里以保留矢量内容）。 */
  file: File;
  /** 上传用途：logo/icon（决定保存目录）。 */
  kind: UploadKind;
  /** 可选：文件名（只用于上传时的 filename；最终对象名由后端生成）。 */
  filename?: string;
}

function getDefaultFilename(mimeType: string): string {
  const extension = imageExtensionForMime(mimeType) ?? "png";
  return `image.${extension}`;
}

async function createAssetFromFile(file: Blob, kind: UploadKind, filename: string): Promise<ApiUploadImageResponse> {
  const form = new FormData();
  const userId = getCurrentUserId();
  if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));

  form.append("user", userId);
  form.append("kind", kind);
  form.append("file", file, filename);

  const record = await pb.collection("assets").create<RecordModel>(form);
  const storedFile = typeof record["file"] === "string" ? record["file"] : "";
  // 返回受控读取 API，而不是 PocketBase 直链；这样私有资产继续走统一鉴权和缓存策略。
  if (!storedFile) throw new Error(translate(getApiLocale(), "media.uploadFailed"));
  return { url: `/api/app/assets/${record.id}` };
}

/**
 * 上传裁剪后的图片（data URL）到 PocketBase 文件存储。
 *
 * 返回：
 * - `{ url }`，指向需要 Authorization 读取的 `/api/app/assets/{id}` 受控资产。
 */
export async function uploadImageDataUrl(
  options: UploadImageDataUrlOptions,
): Promise<ApiUploadImageResponse> {
  const blob = dataUrlToBlob(options.dataUrl);
  const filename = options.filename ?? getDefaultFilename(blob.type);

  return createAssetFromFile(blob, options.kind, filename);
}

/** 上传原始图片文件（当前用于 SVG，避免裁剪流程把矢量图转成 PNG）。 */
export async function uploadImageFile(
  options: UploadImageFileOptions,
): Promise<ApiUploadImageResponse> {
  const validationError = validateImageFileForUpload(options.file);
  if (validationError) throw new Error(validationError);

  const mimeType = uploadMimeTypeForFile(options.file);
  const providedFilename = options.filename?.trim();
  const originalFilename = options.file.name.trim();
  const filename = providedFilename || originalFilename || getDefaultFilename(mimeType);

  return createAssetFromFile(options.file, options.kind, filename);
}
