/**
 * 认证适配层。
 *
 * UI 只消费稳定的 `SessionData`；PocketBase 与 Cloudflare Worker 的 token 恢复、
 * 失效广播和响应 shape 都收敛在这里。
 *
 * 状态链路：
 *   Cloudflare localStorage token -> shared query 校验 /session -> useSession -> AuthSync 路由/query 刷新
 *   PocketBase authStore token -> authRefresh 校验 -> toSessionData -> useSession -> AuthSync 路由/query 刷新
 *
 * 注意： `SessionData.session.id` 使用 token 作为变化标识，只用于前端缓存失效；
 * 不要把它当成可展示或可持久化的业务 session id。
 */
import { useEffect, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { pb, type RecordModel } from "@/lib/pocketbase";
import { getLocaleHeaders } from "@/i18n/api-locale";
import { clearAuthSession } from "@/lib/auth-session";
import {
  getCloudflareAuthHeader,
  isCloudflareSessionFresh,
  readCloudflareSession,
  readCloudflareSessionRecord,
  subscribeCloudflareSession,
  writeCloudflareSession,
} from "@/services/cloudflare-session";
import { isCloudflareRuntime } from "@/services/runtime";
import { sessionResponseSchema, type SessionResponse } from "@renewlet/shared/schemas/auth";

/** 前端内部会话视图，只暴露路由守卫和用户菜单需要的字段。 */
export type SessionData = SessionResponse;
export interface UseSessionResult {
  data: SessionData | null;
  isPending: boolean;
}

const CLOUDFLARE_SESSION_QUERY_KEY = ["auth-session"] as const;
const CLOUDFLARE_SESSION_STALE_TIME_MS = 60_000;
const POCKETBASE_SESSION_FRESH_TIME_MS = 60_000;
const CLOUDFLARE_PASSWORD_RESET_DISABLED = "Email password reset is not enabled for this deployment.";
// Cloudflare 页面会被 ProtectedRoute、AuthSync 和业务 hook 同时消费会话；同 token 只允许一条 /session 在途，防止线上切页时 session 风暴。
let cloudflareSessionRefreshToken: string | null = null;
let cloudflareSessionRefreshPromise: Promise<SessionData | null> | null = null;
// PocketBase authStore 是本地缓存；恢复窗口只允许一条 authRefresh，服务端确认前不能放行私有页面。
let pocketBaseSessionRefreshToken: string | null = null;
let pocketBaseSessionRefreshPromise: Promise<SessionData | null> | null = null;
let pocketBaseSessionVerifiedToken: string | null = null;
let pocketBaseSessionVerifiedRecord: RecordModel | null = null;
let pocketBaseSessionVerifiedAt = 0;
let pocketBaseAuthEpoch = 0;

function clearPocketBaseVerifiedSession() {
  pocketBaseSessionVerifiedToken = null;
  pocketBaseSessionVerifiedRecord = null;
  pocketBaseSessionVerifiedAt = 0;
}

function rememberPocketBaseVerifiedSession(session: SessionData) {
  pocketBaseSessionVerifiedToken = session.session.id;
  pocketBaseSessionVerifiedRecord = pb.authStore.record;
  pocketBaseSessionVerifiedAt = Date.now();
}

function restorePocketBaseVerifiedSession() {
  if (pocketBaseSessionVerifiedToken && pocketBaseSessionVerifiedRecord) {
    pb.authStore.save(pocketBaseSessionVerifiedToken, pocketBaseSessionVerifiedRecord);
    return;
  }
  clearAuthSession(pb.authStore.token);
}
// 多个 useSession 共享一个 QueryClient；引用计数保证同 tab 只注册一条 localStorage 广播链。
const cloudflareQueryClientSubscriptions = new WeakMap<QueryClient, {
  count: number;
  unsubscribe: () => void;
}>();

async function fetchCloudflareSession(input: RequestInfo, init?: RequestInit): Promise<SessionData> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json");
  for (const [key, value] of Object.entries(getLocaleHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  const response = await fetch(input, { ...init, headers, credentials: "include" });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : response.statusText;
    throw new Error(message || "Request failed");
  }
  const parsed = sessionResponseSchema.safeParse(payload);
  // 登录/session 响应是路由守卫根状态；失败必须清晰中断，不能把未知 JSON 当已登录态。
  if (!parsed.success) throw new Error("Invalid session response");
  return parsed.data;
}

async function refreshCloudflareSession(): Promise<SessionData | null> {
  const token = readCloudflareSession()?.session.id;
  if (!token) return null;
  if (cloudflareSessionRefreshPromise && cloudflareSessionRefreshToken === token) {
    return cloudflareSessionRefreshPromise;
  }

  cloudflareSessionRefreshToken = token;
  cloudflareSessionRefreshPromise = (async () => {
    try {
      const session = await fetchCloudflareSession("/api/app/auth/session", {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 旧请求返回时不能覆盖新登录态；只有当前本地 token 仍一致才刷新缓存时间戳。
      if (readCloudflareSession()?.session.id === token) {
        writeCloudflareSession(session);
      }
      return session;
    } catch {
      // session 失效只清理发起该校验的 token，避免慢失败把后续登录成功的会话抹掉。
      if (readCloudflareSession()?.session.id === token) {
        writeCloudflareSession(null);
      }
      return null;
    }
  })().finally(() => {
    if (cloudflareSessionRefreshToken === token) {
      cloudflareSessionRefreshToken = null;
      cloudflareSessionRefreshPromise = null;
    }
  });

  return cloudflareSessionRefreshPromise;
}

async function refreshPocketBaseSession(): Promise<SessionData | null> {
  const token = pb.authStore.token;
  if (!token) {
    clearPocketBaseVerifiedSession();
    return null;
  }
  if (pocketBaseSessionRefreshPromise) {
    return pocketBaseSessionRefreshPromise;
  }

  pocketBaseSessionRefreshToken = token;
  const authEpoch = pocketBaseAuthEpoch;
  pocketBaseSessionRefreshPromise = (async () => {
    try {
      await pb.collection("users").authRefresh();
      if (authEpoch !== pocketBaseAuthEpoch) {
        restorePocketBaseVerifiedSession();
        return null;
      }
      const session = getCurrentSession();
      if (session) {
        rememberPocketBaseVerifiedSession(session);
      }
      return session;
    } catch {
      // PocketBase token 是无状态 bearer；数据目录重置、用户删除或禁用后必须清本地缓存，不能继续信 authStore 快照。
      clearAuthSession(token);
      if (!pb.authStore.token || pb.authStore.token === token) {
        clearPocketBaseVerifiedSession();
      }
      return null;
    }
  })().finally(() => {
    if (pocketBaseSessionRefreshToken === token) {
      pocketBaseSessionRefreshToken = null;
      pocketBaseSessionRefreshPromise = null;
    }
  });

  return pocketBaseSessionRefreshPromise;
}

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

function hasFreshPocketBaseSession() {
  const token = pb.authStore.token;
  return Boolean(token) &&
    token === pocketBaseSessionVerifiedToken &&
    Date.now() - pocketBaseSessionVerifiedAt < POCKETBASE_SESSION_FRESH_TIME_MS;
}

function subscribeQueryClientToCloudflareSession(queryClient: QueryClient): () => void {
  const current = cloudflareQueryClientSubscriptions.get(queryClient);
  if (current) {
    current.count += 1;
    return () => {
      current.count -= 1;
      if (current.count <= 0) {
        current.unsubscribe();
        cloudflareQueryClientSubscriptions.delete(queryClient);
      }
    };
  }

  const sync = () => {
    const record = readCloudflareSessionRecord();
    queryClient.setQueryData(
      CLOUDFLARE_SESSION_QUERY_KEY,
      record?.value ?? null,
      record ? { updatedAt: record.verifiedAt } : undefined,
    );
  };
  const unsubscribe = subscribeCloudflareSession(sync);
  cloudflareQueryClientSubscriptions.set(queryClient, { count: 1, unsubscribe });
  return () => {
    const state = cloudflareQueryClientSubscriptions.get(queryClient);
    if (!state) return;
    state.count -= 1;
    if (state.count <= 0) {
      state.unsubscribe();
      cloudflareQueryClientSubscriptions.delete(queryClient);
    }
  };
}

export const authClient = {
  useSession(): UseSessionResult {
    const queryClient: QueryClient = useQueryClient();
    const cloudflareSessionRecord = isCloudflareRuntime ? readCloudflareSessionRecord() : null;
    const cloudflareSessionQuery: UseQueryResult<SessionData | null, Error> = useQuery<
      SessionData | null,
      Error,
      SessionData | null,
      typeof CLOUDFLARE_SESSION_QUERY_KEY
    >({
      queryKey: CLOUDFLARE_SESSION_QUERY_KEY,
      queryFn: refreshCloudflareSession,
      initialData: () => cloudflareSessionRecord?.value ?? null,
      // verifiedAt 是本地缓存的可信新鲜度边界；60 秒内切页复用，避免每个守卫重新打 /session。
      initialDataUpdatedAt: () => cloudflareSessionRecord?.verifiedAt ?? 0,
      enabled: isCloudflareRuntime && Boolean(cloudflareSessionRecord),
      retry: false,
      staleTime: CLOUDFLARE_SESSION_STALE_TIME_MS,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    });
    const [pocketBaseData, setPocketBaseData] = useState<SessionData | null>(() =>
      hasFreshPocketBaseSession() ? getCurrentSession() : null
    );
    const [isPocketBasePending, setIsPocketBasePending] = useState(!isCloudflareRuntime);

    useEffect(() => {
      if (!isCloudflareRuntime) return;
      return subscribeQueryClientToCloudflareSession(queryClient);
    }, [queryClient]);

    useEffect(() => {
      if (isCloudflareRuntime) return;
      const verify = () => {
        if (!pb.authStore.token) {
          if (pocketBaseSessionRefreshPromise) pocketBaseAuthEpoch += 1;
          clearPocketBaseVerifiedSession();
          setPocketBaseData(null);
          setIsPocketBasePending(false);
          return;
        }
        if (hasFreshPocketBaseSession()) {
          setPocketBaseData(getCurrentSession());
          setIsPocketBasePending(false);
          return;
        }
        setPocketBaseData(null);
        setIsPocketBasePending(true);
        void refreshPocketBaseSession().then((session) => {
          setPocketBaseData(session);
          setIsPocketBasePending(false);
        });
      };
      // `fireImmediately=true` 可覆盖刷新后 authStore 异步恢复的首帧状态；但必须先 authRefresh 才能放行私有页面。
      const unsubscribe = pb.authStore.onChange(() => {
        verify();
      }, true);
      return unsubscribe;
    }, []);

    if (isCloudflareRuntime) {
      const isInitialValidation =
        cloudflareSessionQuery.fetchStatus === "fetching" &&
        !isCloudflareSessionFresh(cloudflareSessionRecord, CLOUDFLARE_SESSION_STALE_TIME_MS);
      return {
        data: cloudflareSessionQuery.data ?? null,
        isPending: isInitialValidation,
      };
    }

    return { data: pocketBaseData, isPending: isPocketBasePending };
  },

  signIn: {
    async email({ email, password }: { email: string; password: string }) {
      try {
        if (isCloudflareRuntime) {
          const data = await fetchCloudflareSession("/api/app/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          writeCloudflareSession(data);
          return { data, error: null };
        }
        pocketBaseAuthEpoch += 1;
        await pb.collection("users").authWithPassword(email, password);
        const session = getCurrentSession();
        if (session) rememberPocketBaseVerifiedSession(session);
        return { data: session, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  },

  async signOut() {
    if (isCloudflareRuntime) {
      try {
        await fetch("/api/app/auth/logout", { method: "POST", headers: getCloudflareAuthHeader() });
      } finally {
        // 即使网络登出失败，也要先清本地 token；服务端过期会由 session TTL 兜底。
        writeCloudflareSession(null);
      }
      return;
    }
    pocketBaseAuthEpoch += 1;
    clearAuthSession();
  },

  async requestPasswordReset(email: string) {
    if (isCloudflareRuntime) {
      void email;
      throw new Error(CLOUDFLARE_PASSWORD_RESET_DISABLED);
    }
    await pb.collection("users").requestPasswordReset(email);
  },

  async confirmPasswordReset(token: string, password: string) {
    if (isCloudflareRuntime) {
      void token;
      void password;
      throw new Error(CLOUDFLARE_PASSWORD_RESET_DISABLED);
    }
    await pb.collection("users").confirmPasswordReset(token, password, password);
  },
};
