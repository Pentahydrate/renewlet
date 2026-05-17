/**
 * 认证状态同步（客户端）。
 *
 * 背景：
 * - 登录/退出会影响当前用户的数据：订阅列表、设置、自定义配置
 * - React Query 需要在认证状态变化时刷新缓存，避免“旧用户数据残留”
 *
 * 额外说明（路由保护）：
 * - SPA 没有服务端页面守卫；这里负责纯客户端跳转和会话过期后的路由保护。
 *
 * 状态链路：
 * ```
 * PocketBase authStore 恢复中 -> 不做跳转
 * 会话已解析 -> 未登录且非公开页 -> /login?next=...
 * 会话已解析 -> 已登录访问 /login -> sanitize(next)
 * session id 变化 -> invalidate 用户相关 query
 * ```
 *
 * 注意： 必须等待 `isPending=false` 再判断未登录，否则刷新首帧可能误判。
 */

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "@/lib/router";
import { useQueryClient } from "@tanstack/react-query";
import { isPublicRoutePath } from "@/lib/public-routes";
import { authClient } from "@/lib/auth-client";
import { sanitizeNextPath } from "@/lib/redirect";

/** 监听 Auth 状态变化，并主动刷新相关 Query 缓存。 */
export function AuthSync() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: sessionData, isPending } = authClient.useSession();

  // 这里做兜底，避免路由初始化期间影响登录跳转逻辑。
  const isPublicRoute = (() => {
    if (!pathname) return true;
    return isPublicRoutePath(pathname);
  })();

  useEffect(() => {
    // 等待首轮 session 加载完成；pending 阶段不能把空 data 当成未登录。
    if (isPending) return;

    const hasSession = Boolean(sessionData?.session);
    if (!hasSession && !isPublicRoute && pathname) {
      const qs = searchParams?.toString() ?? "";
      const next = qs ? `${pathname}?${qs}` : pathname;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (hasSession && pathname === "/login") {
      router.replace(sanitizeNextPath(searchParams?.get("next"), "/"));
    }
  }, [isPending, isPublicRoute, pathname, router, searchParams, sessionData?.session]);

  useEffect(() => {
    // 认证态变化后刷新用户私有数据，避免退出/切换账号后残留旧用户缓存。
    if (isPending) return;

    queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({ queryKey: ["custom-config"] });
  }, [isPending, queryClient, sessionData?.session?.id]);

  return null;
}
