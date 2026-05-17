/**
 * 自定义配置管理文案分片。
 *
 * 架构位置：服务分类、状态、支付方式和货币配置 UI；配置结构本身由 config domain 约束。
 *
 * 注意： 删除提示文案要跟 controller 的禁用/引用判断保持一致。
 */
import type { MessageMap, MessageValue } from "./types";

export const zhCN = {
  "customConfig.iconLabel": "图标：",
  "customConfig.valuePlaceholder": "键值",
  "customConfig.labelZhPlaceholder": "中文名称",
  "customConfig.labelEnPlaceholder": "英文名称",
  "customConfig.customColorPlaceholder": "自定义颜色",
  "customConfig.empty": "暂无配置项",
  "customConfig.enabledCount": ({ enabled, total }) => `${enabled}/${total} 已启用`,
  "customConfig.srDescription": ({ title }) => `管理${title}的选项、排序和启用状态。`,
  "customConfig.dragSortEnabled": ({ enabled, total }) => `拖拽排序 · ${enabled}/${total} 已启用`,
  "customConfig.dragSortOnly": "仅支持拖拽排序",
  "customConfig.dragSort": "拖拽排序",
  "customConfig.totalItems": ({ count }) => `共 ${count} 项`,
  "customConfig.addOption": "添加选项",
  "customConfig.confirmDeleteTitle": "确认删除",
  "customConfig.confirmDeleteDescription": ({ label }) => `确定要删除「${label}」吗？删除后不会影响已有订阅数据，但该选项将不再可选，且可能影响展示/筛选。`,
} satisfies MessageMap;

export const enUS = {
  "customConfig.iconLabel": "Icon:",
  "customConfig.valuePlaceholder": "Value",
  "customConfig.labelZhPlaceholder": "Chinese name",
  "customConfig.labelEnPlaceholder": "English name",
  "customConfig.customColorPlaceholder": "Custom color",
  "customConfig.empty": "No configuration items",
  "customConfig.enabledCount": ({ enabled, total }) => `${enabled}/${total} enabled`,
  "customConfig.srDescription": ({ title }) => `Manage options, order, and enabled state for ${title}.`,
  "customConfig.dragSortEnabled": ({ enabled, total }) => `Drag to sort · ${enabled}/${total} enabled`,
  "customConfig.dragSortOnly": "Drag sorting only",
  "customConfig.dragSort": "Drag to sort",
  "customConfig.totalItems": ({ count }) => `${count} items total`,
  "customConfig.addOption": "Add option",
  "customConfig.confirmDeleteTitle": "Confirm deletion",
  "customConfig.confirmDeleteDescription": ({ label }) => `Delete "${label}"? Existing subscription data will remain, but this option will no longer be selectable and may affect display or filters.`,
} satisfies Record<keyof typeof zhCN, MessageValue>;
