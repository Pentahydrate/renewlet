/**
 * 媒体与图标搜索 API 的响应契约。
 *
 * 架构位置：
 * - LogoPicker/IconPicker 通过 favicon、The SVG 和上传接口获得可持久化的图片 URL。
 * - schema 只接收后端已经清洗过的 URL/索引字段，组件层不再直接信任外部搜索结果。
 *
 * 注意： 上传响应里的 `url` 必须是后端资产地址或受控远端 URL；不要允许 data URL 通过本契约进入表单持久化链路。
 */
import { z } from "zod";

export const uploadKindSchema = z
  .enum(["logo", "icon"])
  .describe("上传用途：logo=订阅 Logo；icon=配置项图标（如支付方式 icon）。");

export const uploadImageResponseSchema = z.object({
  url: z.string().min(1),
}).strict();

export const faviconSearchKindSchema = z.enum(["logo", "icon"]);

export const faviconSearchResponseSchema = z.object({
  imageUrls: z.array(z.string()),
  kind: faviconSearchKindSchema,
}).strict();

export const theSvgIconSchema = z.object({
  slug: z.string(),
  title: z.string(),
  iconUrl: z.string(),
  aliases: z.array(z.string()),
  categories: z.array(z.string()),
  hex: z.string().optional(),
  license: z.string().optional(),
  url: z.string().optional(),
  guidelines: z.string().optional(),
}).strict();

export const theSvgIconsResponseSchema = z.object({
  icons: z.array(theSvgIconSchema),
}).strict();

export type UploadKind = z.infer<typeof uploadKindSchema>;
export type ApiUploadImageResponse = z.infer<typeof uploadImageResponseSchema>;
export type FaviconSearchKind = z.infer<typeof faviconSearchKindSchema>;
export type ApiFaviconSearchResponse = z.infer<typeof faviconSearchResponseSchema>;
export type ApiTheSvgIcon = z.infer<typeof theSvgIconSchema>;
export type ApiTheSvgIconsResponse = z.infer<typeof theSvgIconsResponseSchema>;
