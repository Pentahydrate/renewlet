/**
 * 共享值类型定义（types.ts），用于 i18n message map。
 *
 * 架构位置：所有 message 分片都使用同一 MessageValue，英文分片通过
 * Record<keyof typeof zhCN, MessageValue> 保证双语 key 对齐。
 *
 * 注意： 函数型 message 只接收 string/number 参数；如果扩展参数类型，
 * 需要同步 translate 调用点和所有动态文案测试。
 */
export type MessageValue = string | ((params: Record<string, string | number>) => string);
export type MessageMap = Record<string, MessageValue>;
