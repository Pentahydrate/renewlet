/**
 * 查询当前部署是否还需要初始化管理员。
 *
 * 失败时按“无需展示初始化入口”处理，避免登录页出现误导性的首次部署提示。
 *
 * 架构位置：
 * - 登录页和 setup 页通过该 Hook 决定是否展示初始化流程。
 * - 这是认证前接口，不能依赖 PocketBase 会话状态。
 *
 * 注意： 保守隐藏 setup 入口是安全优先选择；真正的初始化允许性仍由后端校验。
 */
import { useEffect, useState } from "react";
import { setupStatusResponseSchema } from "@/lib/api/schemas/app";

type SetupStatus = {
  setupRequired: boolean;
  setupEnabled: boolean;
  isLoading: boolean;
};

const hiddenSetupStatus: SetupStatus = {
  setupRequired: false,
  setupEnabled: true,
  isLoading: false,
};

function normalizeSetupStatus(data: { setupRequired: boolean; setupEnabled: boolean }): Omit<SetupStatus, "isLoading"> {
  return {
    setupRequired: data.setupRequired,
    setupEnabled: data.setupEnabled,
  };
}

export function useSetupStatus(): SetupStatus {
  const [status, setStatus] = useState<SetupStatus>({
    ...hiddenSetupStatus,
    isLoading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch("/api/app/setup", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!cancelled) setStatus(hiddenSetupStatus);
          return;
        }

        const payload: unknown = await response.json();
        const parsed = setupStatusResponseSchema.safeParse(payload);
        if (!parsed.success) {
          // 初始化状态影响入口可见性；响应不符合契约时按关闭处理，避免误引导用户进入初始化。
          if (!cancelled) setStatus(hiddenSetupStatus);
          return;
        }
        if (!cancelled) {
          setStatus({
            ...normalizeSetupStatus(parsed.data),
            isLoading: false,
          });
        }
      } catch (error: unknown) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setStatus(hiddenSetupStatus);
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return status;
}
