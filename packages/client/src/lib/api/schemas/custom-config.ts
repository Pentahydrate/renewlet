/**
 * 用户自定义配置 API 的 Zod 契约。
 *
 * 架构位置：
 * - 配置项驱动分类、状态、支付方式、货币下拉与统计筛选。
 * - route 校验通过后仍会调用 normalize，保证内置项和货币范围不能被绕过。
 *
 * 注意： 这里只描述结构；“哪些项不可删除/必须启用”属于 domain normalize 规则。
 */
import { z } from "zod";
import type { CustomConfig } from "@/types/config";

/**
 * 配置项（用于分类/状态/支付方式/货币等）。
 *
 * 注意：
 * - `value` 是写入订阅数据的业务值
 * - `labels` 是 UI 展示文案（中英文双语）
 */
export const configItemSchema = z.object({
  id: z.string().trim().min(1).max(120).describe("唯一 ID（拖拽排序/编辑 key）。"),
  value: z.string().trim().min(1).max(80).describe("业务值（写入订阅数据的 value）。"),
  labels: z.object({
    "zh-CN": z.string().trim().min(1).max(80).describe("中文展示文案。"),
    "en-US": z.string().trim().min(1).max(80).describe("英文展示文案。"),
  }).describe("展示文案。"),
  color: z.string().trim().max(80).optional().describe("颜色（可选）。"),
  icon: z.string().trim().max(2048).optional().describe("图标（可选，URL）。"),
  enabled: z.boolean().optional().describe("是否启用（可选）。"),
}).strict();

/** 自定义配置（PUT /api/custom-config）。 */
export const customConfigSchema = z.object({
  categories: z.array(configItemSchema).max(200).describe("分类配置列表。"),
  statuses: z.array(configItemSchema).max(50).describe("状态配置列表。"),
  paymentMethods: z.array(configItemSchema).max(200).describe("支付方式配置列表。"),
  currencies: z.array(configItemSchema).max(300).describe("货币配置列表。"),
}).strict() satisfies z.ZodType<CustomConfig>;

/** GET /api/custom-config 响应。 */
export const customConfigResponseSchema = z.object({
  config: customConfigSchema.describe("自定义配置对象。"),
}).strict();
