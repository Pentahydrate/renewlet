/**
 * 通知渲染出口。
 *
 * 架构位置：读取 `useToast` 队列并渲染 Radix Toast，和 Providers 中的 Sonner 可以并存支持过渡期调用。
 *
 * 注意： 如果迁移到单一 toast 实现，需要先清点 `useToast` 与 sonner 的调用方，避免消息丢失。
 */
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
