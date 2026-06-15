import { healthResponseSchema } from "@renewlet/shared/schemas/app";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListUsers,
  adminPatchUser,
  appStatus,
  changePassword,
  createInitialAdmin,
  login,
  logout,
  passwordResetStatus,
  session,
  setupStatus,
} from "./auth";
import { deleteAsset, listUploadedAssets, readAsset, uploadAsset } from "./assets";
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
import { createSubscription, deleteSubscription, readSubscriptions, renewSubscription, updateSubscription } from "./subscriptions";
import { applyImport, previewImport } from "./import-export";
import {
  createCloudBackup,
  deleteCloudBackup,
  downloadCloudBackup,
  listCloudBackups,
  readCloudBackupConfig,
  runDueCloudBackups,
  testCloudBackupConfig,
  updateCloudBackupConfig,
} from "./cloud-backup";
import { recognizeSubscriptions, recognizeSubscriptionsStream, testAIRecognitionConnection } from "./ai-recognition";
import { listAIModels } from "./ai-models";
import { builtInIconIndexStatus, checkBuiltInIconIndexProvider, refreshBuiltInIconIndexProvider } from "./media-icon-index";
import { mediaCandidates } from "./search";
import { notificationHistory, notificationRun, notificationTest, runScheduledNotifications } from "./notifications";
import { renewAutoSubscriptionsForAllUsers } from "./subscription-renewal";
import {
  createPublicStatusPage,
  deletePublicStatusPage,
  readPublicStatus,
  readPublicStatusAsset,
  readPublicStatusPage,
  updatePublicStatusPage,
} from "./public-status";
import { systemRestart, systemUpdate, systemVersion } from "./system";
import { errorResponse, methodNotAllowed, pathSegments, requestLocale, toResponse } from "./http";
import { serverText } from "./server-i18n";
import type { Env } from "./types";

/**
 * Cloudflare Worker 入口。
 *
 * Static Assets 负责前端文件，Worker 只接管 `/api/*`、公开 ICS 和 scheduled cron；这里的显式路由表
 * 是 Cloudflare 运行面的产品 API 边界，不应扩展成 PocketBase REST 兼容层。
 */
const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return toResponse(error);
    }
  },

  async scheduled(_controller, env) {
    // Cron 先推进自动续订再生成通知；否则后台续订项会用旧日期进入本轮提醒内容。
    await renewAutoSubscriptionsForAllUsers(env);
    // Cron 顶层失败必须交回平台记录；本地调试通过 `--test-scheduled` 的 `/__scheduled` 绕过 Wrangler Static Assets bug。
    await runScheduledNotifications(env);
    // 云备份是可恢复快照，不参与通知窗口；放在通知之后，避免慢远端存储拖慢本轮续费提醒。
    await runDueCloudBackups(env);
  },
};

export default worker;

/**
 * handleRequest 完成 Worker 顶层路由分发。
 *
 * `/calendar/renewals.ics` 是 bearer token 公共入口，不能被 `/api/*` 的认证假设覆盖。
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const locale = requestLocale(request);
  if (url.pathname === "/calendar/renewals.ics") return routeMethods(request, { GET: () => calendarFeedIcs(request, env) });
  // wrangler assets 只把 /api/* 交给 Worker；这里再次拒绝非 API，避免静态资源请求误进产品 API。
  if (!url.pathname.startsWith("/api/")) return errorResponse(404, serverText(locale, "common.notFound"), "NOT_FOUND");
  if (url.pathname === "/api/app/health") return health();
  if (url.pathname === "/api/app/ready") return ready(env);
  if (url.pathname === "/api/app/status") return routeMethods(request, {
    GET: () => appStatus(request, env),
  });
  if (url.pathname === "/api/app/setup") return routeMethods(request, {
    GET: () => setupStatus(request, env),
    POST: () => createInitialAdmin(request, env),
  });
  if (url.pathname.startsWith("/api/public/")) return routePublic(request, env, url);
  if (url.pathname.startsWith("/api/app/")) return routeApp(request, env, url);
  return errorResponse(404, serverText(locale, "common.notFound"), "NOT_FOUND");
}

async function routePublic(request: Request, env: Env, url: URL): Promise<Response> {
  const segments = pathSegments(url, "/api/public");
  const [head, pageToken, third, assetId] = segments;
  if (head === "status" && pageToken && !third) {
    return routeMethods(request, { GET: () => readPublicStatus(request, env, pageToken) });
  }
  if (head === "status" && pageToken && third === "assets" && assetId) {
    return routeMethods(request, { GET: () => readPublicStatusAsset(request, env, pageToken, assetId) });
  }
  return errorResponse(404, serverText(requestLocale(request), "common.notFound"), "NOT_FOUND");
}

async function routeApp(request: Request, env: Env, url: URL): Promise<Response> {
  const segments = pathSegments(url);
  const [head, second, third, fourth, fifth, sixth, seventh] = segments;

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
  if (head === "admin" && second === "system" && third === "restart") {
    return routeMethods(request, { POST: () => systemRestart(request, env) });
  }
  if (head === "admin" && second === "media" && third === "icon-index" && !fourth) {
    return routeMethods(request, {
      GET: () => builtInIconIndexStatus(request, env),
    });
  }
  if (head === "admin" && second === "media" && third === "icon-index" && fourth === "providers" && fifth && sixth === "check" && !seventh) {
    return routeMethods(request, {
      POST: () => checkBuiltInIconIndexProvider(request, env, fifth),
    });
  }
  if (head === "admin" && second === "media" && third === "icon-index" && fourth === "providers" && fifth && sixth === "refresh" && !seventh) {
    return routeMethods(request, {
      POST: () => refreshBuiltInIconIndexProvider(request, env, fifth),
    });
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
  if (head === "subscriptions" && second && third === "renew") {
    return routeMethods(request, { POST: () => renewSubscription(request, env, second) });
  }
  if (head === "subscriptions" && second) return routeMethods(request, {
    PATCH: () => updateSubscription(request, env, second),
    DELETE: () => deleteSubscription(request, env, second),
  });

  if (head === "import" && second === "preview") return routeMethods(request, { POST: () => previewImport(request, env) });
  if (head === "import" && second === "apply") return routeMethods(request, { POST: () => applyImport(request, env) });

  if (head === "cloud-backup" && second === "config" && !third) return routeMethods(request, {
    GET: () => readCloudBackupConfig(request, env),
    PUT: () => updateCloudBackupConfig(request, env),
  });
  if (head === "cloud-backup" && second === "test" && !third) {
    return routeMethods(request, { POST: () => testCloudBackupConfig(request, env) });
  }
  if (head === "cloud-backups" && !second) return routeMethods(request, {
    GET: () => listCloudBackups(request, env),
    POST: () => createCloudBackup(request, env),
  });
  if (head === "cloud-backups" && second && third === "download" && !fourth) {
    return routeMethods(request, { GET: () => downloadCloudBackup(request, env, second) });
  }
  if (head === "cloud-backups" && second && !third) {
    return routeMethods(request, { DELETE: () => deleteCloudBackup(request, env, second) });
  }

  if (head === "ai" && second === "subscriptions" && third === "recognize" && fourth === "stream" && !fifth) {
    return routeMethods(request, { POST: () => recognizeSubscriptionsStream(request, env) });
  }
  if (head === "ai" && second === "subscriptions" && third === "recognize" && !fourth) {
    return routeMethods(request, { POST: () => recognizeSubscriptions(request, env) });
  }
  if (head === "ai" && second === "subscriptions" && third === "test") {
    return routeMethods(request, { POST: () => testAIRecognitionConnection(request, env) });
  }
  if (head === "ai" && second === "models" && third === "list") {
    return routeMethods(request, { POST: () => listAIModels(request, env) });
  }

  if (head === "assets" && !second) return routeMethods(request, {
    GET: () => listUploadedAssets(request, env),
    POST: () => uploadAsset(request, env),
  });
  if (head === "assets" && second) return routeMethods(request, {
    GET: () => readAsset(request, env, second),
    DELETE: () => deleteAsset(request, env, second),
  });

  if (head === "calendar-feed" && !second) return routeMethods(request, {
    GET: () => readCalendarFeed(request, env),
    POST: () => createCalendarFeed(request, env),
    DELETE: () => deleteCalendarFeed(request, env),
  });

  if (head === "public-status-page" && !second) return routeMethods(request, {
    GET: () => readPublicStatusPage(request, env),
    POST: () => createPublicStatusPage(request, env),
    PATCH: () => updatePublicStatusPage(request, env),
    DELETE: () => deletePublicStatusPage(request, env),
  });

  if (head === "notifications" && second === "history") return routeMethods(request, { GET: () => notificationHistory(request, env) });
  if (head === "notifications" && second === "test") return routeMethods(request, { POST: () => notificationTest(request, env) });
  if (head === "notifications" && second === "run") return routeMethods(request, { POST: () => notificationRun(request, env) });

  if (head === "media" && second === "candidates") return routeMethods(request, { POST: () => mediaCandidates(request, env) });

  return errorResponse(404, serverText(requestLocale(request), "common.notFound"), "NOT_FOUND");
}

/**
 * routeMethods 执行方法白名单。
 *
 * 显式返回 405 能让前端和巡检快速发现 route 漂移，而不是把错误吞成 404。
 */
async function routeMethods(request: Request, handlers: Partial<Record<string, () => Promise<Response> | Response>>): Promise<Response> {
  const handler = handlers[request.method];
  return handler ? await handler() : methodNotAllowed(requestLocale(request));
}

/** health 返回最小可缓存外的存活信息；不读取 D1/R2，避免健康检查放大平台短暂抖动。 */
function health(): Response {
  return Response.json(healthResponseSchema.parse({ ok: true, time: new Date().toISOString() }), {
    headers: { "x-content-type-options": "nosniff" },
  });
}

async function ready(env: Env): Promise<Response> {
  // ready 只验证 D1 binding 可用；R2/第三方 provider 不应拖慢平台健康检查。
  await env.DB.prepare("SELECT 1").first();
  return health();
}
