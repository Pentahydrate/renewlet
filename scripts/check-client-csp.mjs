#!/usr/bin/env node

/**
 * 构建产物 CSP 守卫。
 *
 * 触发时机：`pnpm check:cloudflare` / 发布前检查在 Vite build 之后调用。
 * 前置依赖：`apps/web/dist/index.html` 必须已经存在；脚本失败即阻断部署。
 *
 * 业务边界：生产静态响应头只为本地 Wallos DB 解析放开 `wasm-unsafe-eval`；
 * 首屏脚本必须走同源外部文件，不能回退成 inline 或更宽的 unsafe-eval。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(repoRoot, "apps/web/dist/index.html");
const html = readFileSync(indexPath, "utf8");
const inlineScripts = [...html.matchAll(/<script\b(?!(?=[^>]*\bsrc\s*=))[^>]*>([\s\S]*?)<\/script>/gi)]
  .filter((match) => match[1]?.trim());

if (inlineScripts.length > 0) {
  // CSP 是 Cloudflare 与 Go 静态响应共享的安全边界；发现 inline script 必须让构建失败。
  console.error(`CSP check failed: ${indexPath} contains ${inlineScripts.length} inline script tag(s).`);
  console.error("Move first-paint code into apps/web/public/*.js and load it with src so production CSP can avoid inline scripts.");
  process.exit(1);
}

console.log("Client CSP checks passed.");
