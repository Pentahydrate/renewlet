/**
 * @file Seed 专用 PocketBase REST API 包装器。
 *
 * 职责：为本地 seed 脚本提供最小 HTTP 客户端能力，并把 PocketBase collection 写入限速、
 * 429 重试和 JSON 错误归一化集中在一个地方，避免业务编排层散落网络恢复逻辑。
 *
 * 外部依赖：Node.js 全局 fetch、PocketBase REST API、HTTP Retry-After 约定。
 *
 * 流程：
 *   api() -> pace collection write -> fetch JSON -> ok return
 *         -> 429 retry/backoff -> retry exhausted -> throw readable error
 *
 * Caveat：节流时钟保存在单个 Node 进程的闭包里，不能协调两个终端同时运行 seed。
 * Caveat：`RENEWLET_SEED_WRITE_DELAY_MS=0` 是显式绕过保护，可能重新触发 PocketBase create 限流。
 * PERF：如果未来 PocketBase 提供稳定批量写接口，可以用批量 mutation 替代逐条 pacing。
 */

export const DEFAULT_SEED_WRITE_DELAY_MS = 300;

const COLLECTION_WRITE_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const MAX_429_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_BACKOFF_MS = 5_000;

export function parseSeedWriteDelayMs(value) {
  if (value === undefined || value === "") return DEFAULT_SEED_WRITE_DELAY_MS;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`RENEWLET_SEED_WRITE_DELAY_MS must be a non-negative integer, got: ${value}`);
  }
  return Number.parseInt(trimmed, 10);
}

export function createSeedApi({ writeDelayMs = DEFAULT_SEED_WRITE_DELAY_MS } = {}) {
  let nextWriteAt = 0;

  return async function api(pbUrl, path, options = {}) {
    const method = options.method || "GET";

    for (let attempt = 0; ; attempt += 1) {
      // 只限制 collection 写入：auth 和 list 读请求不会触发这次遇到的 `*:create` 规则。
      await paceCollectionWrite(method, path, writeDelayMs, () => nextWriteAt, (value) => {
        nextWriteAt = value;
      });

      const { response, data, text } = await sendJsonRequest(pbUrl, path, method, options);
      if (response.ok) return data;

      if (response.status === 429 && attempt < MAX_429_RETRIES) {
        // 429 是临时容量信号，适合恢复；schema、鉴权或校验错误自动重试只会掩盖真正原因。
        const delayMs = retryAfterDelayMs(response.headers.get("retry-after")) ?? retryBackoffMs(attempt);
        console.warn(`${method} ${path} hit PocketBase rate limit; retrying in ${delayMs}ms (${attempt + 1}/${MAX_429_RETRIES}).`);
        await sleep(delayMs);
        continue;
      }

      const message = data?.message || text || response.statusText;
      const prefix = response.status === 429
        ? `${method} ${path} failed after ${MAX_429_RETRIES} retries (${response.status})`
        : `${method} ${path} failed (${response.status})`;
      throw new Error(`${prefix}: ${message}`);
    }
  };
}

async function paceCollectionWrite(method, path, writeDelayMs, getNextWriteAt, setNextWriteAt) {
  if (writeDelayMs <= 0 || !isCollectionWrite(method, path)) return;
  const waitMs = getNextWriteAt() - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  // 在请求发出前预订下一个写入窗口，避免连续 PATCH/POST 在网络很快时挤成突发流量。
  setNextWriteAt(Date.now() + writeDelayMs);
}

function isCollectionWrite(method, path) {
  return COLLECTION_WRITE_METHODS.has(method) && path.startsWith("/api/collections/");
}

async function sendJsonRequest(pbUrl, path, method, options) {
  const headers = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${pbUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { response, text, data: text ? safeJson(text) : {} };
}

function retryAfterDelayMs(value) {
  if (!value) return null;
  const numericSeconds = Number.parseFloat(value);
  // Retry-After 允许秒数或 HTTP-date；统一封顶，避免异常服务端头让本地脚本长时间“假死”。
  const delayMs = Number.isFinite(numericSeconds) ? numericSeconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(delayMs)) return null;
  return Math.min(Math.max(0, Math.ceil(delayMs)), MAX_RETRY_DELAY_MS);
}

function retryBackoffMs(attempt) {
  // 加少量 jitter，让多个本地 seed 进程即使同时撞到限流，也不至于按同一节奏再次碰撞。
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.min(base + Math.floor(Math.random() * 250), MAX_RETRY_DELAY_MS);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
