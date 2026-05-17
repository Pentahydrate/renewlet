/**
 * i18n 文案聚合入口。
 *
 * 架构位置：业务分片位于 `./messages/*`，本文件只组合 zh/en map 并提供 translate，
 * 避免调用方感知拆分后的文件结构。
 *
 * 注意： 不要在这里新增具体文案；新增 key 应放入对应领域分片并保持双语对齐。
 */
import type { Locale } from "@/i18n/locales";
import type { MessageValue } from "./messages/types";
import { zhCN as commonZhCN, enUS as commonEnUS } from "./messages/common";
import { zhCN as legalZhCN, enUS as legalEnUS } from "./messages/legal";
import { zhCN as customConfigZhCN, enUS as customConfigEnUS } from "./messages/custom-config";
import { zhCN as subscriptionZhCN, enUS as subscriptionEnUS } from "./messages/subscription";
import { zhCN as authZhCN, enUS as authEnUS } from "./messages/auth";
import { zhCN as settingsZhCN, enUS as settingsEnUS } from "./messages/settings";
import { zhCN as notificationZhCN, enUS as notificationEnUS } from "./messages/notification";
import { zhCN as labelsZhCN, enUS as labelsEnUS } from "./messages/labels";
import { zhCN as adminZhCN, enUS as adminEnUS } from "./messages/admin";
import { zhCN as errorZhCN, enUS as errorEnUS } from "./messages/error";

const zhCN = {
  ...commonZhCN,
  ...legalZhCN,
  ...customConfigZhCN,
  ...subscriptionZhCN,
  ...authZhCN,
  ...settingsZhCN,
  ...notificationZhCN,
  ...labelsZhCN,
  ...adminZhCN,
  ...errorZhCN,
} satisfies Record<string, MessageValue>;

const enUS = {
  ...commonEnUS,
  ...legalEnUS,
  ...customConfigEnUS,
  ...subscriptionEnUS,
  ...authEnUS,
  ...settingsEnUS,
  ...notificationEnUS,
  ...labelsEnUS,
  ...adminEnUS,
  ...errorEnUS,
} satisfies Record<keyof typeof zhCN, MessageValue>;

export type MessageKey = keyof typeof zhCN;

const MESSAGES: Record<Locale, Record<MessageKey, MessageValue>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export function translate(locale: Locale, key: MessageKey, params: Record<string, string | number> = {}): string {
  const value = MESSAGES[locale][key];
  if (typeof value === "function") return value(params);
  return value;
}
