/**
 * 通知 hook（Sonner 兼容适配器）。
 *
 * 架构位置：
 * - 新 UI 统一由 components/ui/sonner.tsx 渲染。
 * - 这里保留 shadcn 风格 useToast()/toast({ title, description }) 调用形状，
 *   让设置页等旧调用点不用大范围改动。
 */
import type { ReactNode } from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";

import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

type ToasterToast = ToastProps & {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ToastActionElement | ReactNode;
};

type Toast = Omit<ToasterToast, "id">;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

function toSonnerOptions(id: string, props: Toast): ExternalToast {
  const options: ExternalToast = { id };

  if (props.description !== undefined) options.description = props.description;
  if (props.action !== undefined) options.action = props.action as ExternalToast["action"];
  if (props.duration !== undefined) options.duration = props.duration;
  if (props.className !== undefined) options.className = props.className;

  return options;
}

function showSonnerToast(id: string, props: Toast) {
  const options = toSonnerOptions(id, props);

  if (props.variant === "destructive") {
    sonnerToast.error(props.title, options);
    return;
  }

  sonnerToast.success(props.title, options);
}

function toast(props: Toast) {
  const id = genId();
  let currentProps = props;

  showSonnerToast(id, currentProps);

  const dismiss = () => sonnerToast.dismiss(id);
  const update = (nextProps: ToasterToast) => {
    const { id: _ignoredId, ...rest } = nextProps;
    currentProps = { ...currentProps, ...rest };
    showSonnerToast(id, currentProps);
  };

  return {
    id,
    dismiss,
    update,
  };
}

function dismiss(toastId?: string) {
  sonnerToast.dismiss(toastId);
}

function useToast() {
  return {
    toasts: [] as ToasterToast[],
    toast,
    dismiss,
  };
}

/** 导出 Hook 和命令式 toast 调用入口，匹配 shadcn/ui 使用方式。 */
export { useToast, toast };
