/**
 * 认证适配层（PocketBase）。
 *
 * 架构位置：UI 层使用轻量 `authClient`，底层仍由 PocketBase authStore 负责 token
 * 持久化和恢复。这样可以把会话 shape 固定在应用内部，避免组件直接依赖 SDK record。
 *
 * 状态链路：
 *   authStore 的 restore/login/logout -> toSessionData -> useSession state -> AuthSync 路由/query 刷新
 *
 * 注意： `SessionData.session.id` 使用 token 作为变化标识，只用于前端缓存失效；
 * 不要把它当成可展示或可持久化的业务 session id。
 */
import { useEffect, useState } from "react";
import { pb, type RecordModel } from "@/lib/pocketbase";

/** 前端内部会话视图，只暴露路由守卫和用户菜单需要的字段。 */
export type SessionData = {
  session: { id: string };
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    banned: boolean;
  };
};

function toSessionData(record: RecordModel | null | undefined): SessionData | null {
  // SDK record 是运行时宽类型；这里用保守默认值阻断脏字段继续向组件树扩散。
  if (!pb.authStore.isValid || !record) return null;
  return {
    session: { id: pb.authStore.token },
    user: {
      id: record.id,
      email: typeof record["email"] === "string" ? record["email"] : "",
      name: typeof record["name"] === "string" ? record["name"] : "",
      role: typeof record["role"] === "string" ? record["role"] : "user",
      banned: Boolean(record["banned"]),
    },
  };
}

function getCurrentSession(): SessionData | null {
  return toSessionData(pb.authStore.record);
}

export const authClient = {
  /** 订阅 PocketBase authStore，并转换成 React 可消费的 session 状态。 */
  useSession() {
    const [data, setData] = useState<SessionData | null>(() => getCurrentSession());
    const [isPending, setIsPending] = useState(false);

    useEffect(() => {
      // `fireImmediately=true` 可覆盖刷新后 authStore 异步恢复的首帧状态。
      const unsubscribe = pb.authStore.onChange(() => {
        setData(getCurrentSession());
        setIsPending(false);
      }, true);
      return unsubscribe;
    }, []);

    return { data, isPending };
  },

  signIn: {
    /** 使用邮箱密码登录，并把 SDK 错误保留给调用方做本地化展示。 */
    async email({ email, password }: { email: string; password: string }) {
      try {
        await pb.collection("users").authWithPassword(email, password);
        return { data: getCurrentSession(), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  },

  /** 清空本地 token；后续路由跳转和 query 失效由 AuthSync 统一处理。 */
  async signOut() {
    pb.authStore.clear();
  },
};
