import { healthResponseSchema } from "@renewlet/shared/schemas/app";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminPatchUser,
  changePassword,
  createInitialAdmin,
  login,
  logout,
  passwordResetStatus,
  session,
  setupStatus,
} from "./auth";
import { listUploadedAssets, readAsset, uploadAsset } from "./assets";
import {
  calendarFeedIcs,
  createCalendarFeed,
  createSubscriptionCalendarFeed,
  deleteCalendarFeed,
  deleteSubscriptionCalendarFeed,
  readCalendarFeed,
  readSubscriptionCalendarFeed,
} from "./calendar-feed";
import { readCustomConfig, readSettings, updateCustomConfig, updateSettings } from "./settings";
import { createSubscription, deleteSubscription, readSubscriptions, updateSubscription } from "./subscriptions";
import { applyImport, previewImport } from "./import-export";
import { mediaCandidates } from "./search";
import { notificationHistory, notificationRun, notificationTest, runScheduledNotifications } from "./notifications";
import { systemUpdate, systemVersion } from "./system";
import { errorResponse, methodNotAllowed, pathSegments, requestLocale, toResponse } from "./http";
import { serverText } from "./server-i18n";
import type { Env } from "./types";

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return toResponse(error);
    }
  },

  async scheduled(_controller, env, ctx) {
    // Cron 只负责触发；每个用户的幂等窗口在 notification_jobs 唯一键里兑现。
    ctx.waitUntil(runScheduledNotifications(env));
  },
};

export default worker;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const locale = requestLocale(request);
  if (url.pathname === "/calendar/renewals.ics") return routeMethods(request, { GET: () => calendarFeedIcs(request, env) });
  // wrangler assets 只把 /api/* 交给 Worker；这里再次拒绝非 API，避免静态资源请求误进产品 API。
  if (!url.pathname.startsWith("/api/")) return errorResponse(404, serverText(locale, "common.notFound"), "NOT_FOUND");
  if (url.pathname === "/api/app/health") return health();
  if (url.pathname === "/api/app/setup") return routeMethods(request, {
    GET: () => setupStatus(request, env),
    POST: () => createInitialAdmin(request, env),
  });
  if (url.pathname.startsWith("/api/app/")) return routeApp(request, env, url);
  return errorResponse(404, serverText(locale, "common.notFound"), "NOT_FOUND");
}

async function routeApp(request: Request, env: Env, url: URL): Promise<Response> {
  const segments = pathSegments(url);
  const [head, second, third] = segments;

  // Worker 只实现 Renewlet 产品 API，不模拟 PocketBase REST；路由表越显式，运行面漂移越早暴露。
  if (head === "auth" && second === "login") return routeMethods(request, { POST: () => login(request, env) });
  if (head === "auth" && second === "session") return routeMethods(request, { GET: () => session(request, env) });
  if (head === "auth" && second === "logout") return routeMethods(request, { POST: () => logout(request, env) });

  if (head === "account" && second === "password") return routeMethods(request, { PUT: () => changePassword(request, env) });
  if (head === "account" && second === "password-reset" && third === "status") {
    return routeMethods(request, { GET: () => passwordResetStatus() });
  }

  if (head === "admin" && second === "users" && !third) {
    return routeMethods(request, {
      GET: () => adminListUsers(request, env),
      POST: () => adminCreateUser(request, env),
    });
  }
  if (head === "admin" && second === "users" && third) {
    return routeMethods(request, {
      PATCH: () => adminPatchUser(request, env, third),
      DELETE: () => adminDeleteUser(request, env, third),
    });
  }
  if (head === "admin" && second === "system" && third === "version") {
    return routeMethods(request, { GET: () => systemVersion(request, env) });
  }
  if (head === "admin" && second === "system" && third === "update") {
    return routeMethods(request, { POST: () => systemUpdate(request, env) });
  }

  if (head === "settings") return routeMethods(request, {
    GET: () => readSettings(request, env),
    PUT: () => updateSettings(request, env),
  });
  if (head === "custom-config") return routeMethods(request, {
    GET: () => readCustomConfig(request, env),
    PUT: () => updateCustomConfig(request, env),
  });

  if (head === "subscriptions" && !second) return routeMethods(request, {
    GET: () => readSubscriptions(request, env),
    POST: () => createSubscription(request, env),
  });
  if (head === "subscriptions" && second && third === "calendar-feed") {
    return routeMethods(request, {
      GET: () => readSubscriptionCalendarFeed(request, env, second),
      POST: () => createSubscriptionCalendarFeed(request, env, second),
      DELETE: () => deleteSubscriptionCalendarFeed(request, env, second),
    });
  }
  if (head === "subscriptions" && second) return routeMethods(request, {
    PATCH: () => updateSubscription(request, env, second),
    DELETE: () => deleteSubscription(request, env, second),
  });

  if (head === "import" && second === "preview") return routeMethods(request, { POST: () => previewImport(request, env) });
  if (head === "import" && second === "apply") return routeMethods(request, { POST: () => applyImport(request, env) });

  if (head === "assets" && !second) return routeMethods(request, {
    GET: () => listUploadedAssets(request, env),
    POST: () => uploadAsset(request, env),
  });
  if (head === "assets" && second) return routeMethods(request, { GET: () => readAsset(request, env, second) });

  if (head === "calendar-feed" && !second) return routeMethods(request, {
    GET: () => readCalendarFeed(request, env),
    POST: () => createCalendarFeed(request, env),
    DELETE: () => deleteCalendarFeed(request, env),
  });

  if (head === "notifications" && second === "history") return routeMethods(request, { GET: () => notificationHistory(request, env) });
  if (head === "notifications" && second === "test") return routeMethods(request, { POST: () => notificationTest(request, env) });
  if (head === "notifications" && second === "run") return routeMethods(request, { POST: () => notificationRun(request, env) });

  if (head === "media" && second === "candidates") return routeMethods(request, { POST: () => mediaCandidates(request, env) });

  return errorResponse(404, serverText(requestLocale(request), "common.notFound"), "NOT_FOUND");
}

async function routeMethods(request: Request, handlers: Partial<Record<string, () => Promise<Response> | Response>>): Promise<Response> {
  const handler = handlers[request.method];
  return handler ? await handler() : methodNotAllowed(requestLocale(request));
}

function health(): Response {
  return Response.json(healthResponseSchema.parse({ ok: true, time: new Date().toISOString() }), {
    headers: { "x-content-type-options": "nosniff" },
  });
}
