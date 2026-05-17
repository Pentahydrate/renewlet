/**
 * 自定义配置 React Context。
 *
 * 架构位置：
 * - Provider 只负责把 application hook 的结果暴露给组件树。
 * - API/localStorage/防抖保存都在 `useCustomConfigState` 内，不在 Context 中实现。
 *
 * 注意： 不要在这里重新加入持久化逻辑，否则 Context 会再次变成“状态 + IO + 规范化”的混合层。
 */
import { createContext, useContext, type ReactNode } from "react";
import { useCustomConfigState } from "@/modules/custom-config/application/use-custom-config-state";
import type { ConfigItem, CustomConfig } from "@/types/config";

interface CustomConfigContextType {
  /** 当前配置（分类/状态/支付方式/货币）。 */
  config: CustomConfig;
  /** 更新分类配置（会写入 localStorage，并尝试持久化到 SQLite）。 */
  updateCategories: (items: ConfigItem[]) => void;
  /** 更新状态配置（会写入 localStorage，并尝试持久化到 SQLite）。 */
  updateStatuses: (items: ConfigItem[]) => void;
  /** 更新支付方式配置（会写入 localStorage，并尝试持久化到 SQLite）。 */
  updatePaymentMethods: (items: ConfigItem[]) => void;
  /** 更新货币配置（会写入 localStorage，并尝试持久化到 SQLite）。 */
  updateCurrencies: (items: ConfigItem[]) => void;
  /** 显式保存整份配置（供 Settings 页统一保存草稿）。 */
  saveConfig: (config: CustomConfig) => Promise<CustomConfig>;
}

const CustomConfigContext = createContext<CustomConfigContextType | null>(null);

/** 自定义配置 Provider：只负责向 React 树暴露自定义配置数据能力。 */
export function CustomConfigProvider({ children }: { children: ReactNode }) {
  const value = useCustomConfigState();

  return (
    <CustomConfigContext.Provider value={value}>
      {children}
    </CustomConfigContext.Provider>
  );
}

/** 获取自定义配置上下文。 */
export function useCustomConfig() {
  const context = useContext(CustomConfigContext);
  if (!context) {
    throw new Error("useCustomConfig must be used within a CustomConfigProvider");
  }
  return context;
}
