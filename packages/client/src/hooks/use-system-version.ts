import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { systemService } from "@/services/system-service";

export const systemVersionQueryKey = ["system-version"] as const;

/**
 * 读取管理员版本状态。
 *
 * `force=true` 会绕过后端缓存；小弹窗打开时使用它，后台 badge 保持普通缓存，
 * 避免每次页面渲染都请求 GitHub Release Atom feed。
 */
export function useSystemVersion(enabled: boolean, force = false) {
  return useQuery({
    queryKey: [...systemVersionQueryKey, force],
    queryFn: ({ signal }) => systemService.version(force, signal),
    enabled,
    retry: false,
    staleTime: 20 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** 触发 Docker 页面内更新；成功后只代表二进制已替换，还需要管理员显式 restart。 */
export function useSystemUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => systemService.update(),
    onSuccess: () => {
      // 更新完成只代表二进制已替换；重启由小弹窗显式触发，缓存必须先失效以免继续展示旧 Release 状态。
      void queryClient.invalidateQueries({ queryKey: systemVersionQueryKey });
    },
  });
}

/** 单次确认后端 restart pending；Cloudflare/source runtime 会在 service 层返回不支持。 */
export function useSystemRestart() {
  return useMutation({
    mutationFn: () => systemService.restart(),
  });
}
