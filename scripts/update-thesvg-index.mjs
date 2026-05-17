#!/usr/bin/env node

/**
 * 图标索引生成脚本（TheSVG）。
 *
 * 架构位置：把上游 registry 收敛成前端搜索和后端 embedded static 共用的窄 JSON，
 * 避免客户端运行时拉取完整上游数据。
 *
 * 流程：
 *   拉取 registry -> 校验 slug/variant/path -> 选择首选变体 -> 写入前后端索引
 *
 * 注意： 生成结果是仓库内静态数据；上游字段或 CDN 路径变化时必须先保证前后端解析仍兼容。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THE_SVG_CDN_BASE = "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main";
const THE_SVG_REGISTRY_URL = `${THE_SVG_CDN_BASE}/src/data/icons.json`;
const PREFERRED_VARIANTS = ["default", "color"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPaths = [
  path.resolve(__dirname, "../packages/client/src/lib/thesvg-index.json"),
  path.resolve(__dirname, "../packages/server/internal/static/data/thesvg-index.json"),
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function isSafePathPart(value) {
  // slug/variant 会拼进 CDN 路径，只允许单段安全字符，防止上游数据把 `../` 注入生成索引。
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function parseVariants(slug, value) {
  if (!isRecord(value)) return {};

  const variants = {};
  for (const [variant, pathValue] of Object.entries(value)) {
    if (!isSafePathPart(variant)) continue;
    if (typeof pathValue !== "string") continue;
    const normalizedPath = pathValue.trim();
    if (!normalizedPath.endsWith(".svg")) continue;
    // 变体路径必须仍落在当前 slug 目录下，避免 registry 中的跨目录引用污染 IconURL。
    if (!normalizedPath.startsWith(`/icons/${slug}/`)) continue;
    variants[variant] = normalizedPath;
  }

  return variants;
}

function chooseVariant(variants) {
  for (const variant of PREFERRED_VARIANTS) {
    if (variants[variant]) return variant;
  }

  // 没有默认/彩色变体时退到第一个安全变体，保证长尾品牌仍可被搜索到。
  return Object.keys(variants).find(isSafePathPart);
}

function parseRegistry(value) {
  if (!Array.isArray(value)) return [];

  const icons = [];
  const seen = new Set();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const slug = asString(item.slug);
    const title = asString(item.title);
    if (!slug || !title) continue;
    if (!isSafePathPart(slug)) continue;
    if (seen.has(slug)) continue;

    const variants = parseVariants(slug, item.variants);
    const variant = chooseVariant(variants);
    if (!variant) continue;

    // 只写前后端需要的窄字段，避免上游 registry 新增大字段时无意膨胀 bundle/embedded 数据。
    icons.push({
      slug,
      title,
      aliases: asStringArray(item.aliases),
      categories: asStringArray(item.categories),
      variant,
      hex: asString(item.hex),
      license: asString(item.license),
      url: asString(item.url),
      guidelines: asString(item.guidelines),
    });
    seen.add(slug);
  }

  return icons;
}

const response = await fetch(THE_SVG_REGISTRY_URL, {
  headers: { accept: "application/json" },
});

if (!response.ok) {
  throw new Error(`theSVG registry HTTP ${response.status}`);
}

const registry = await response.json();
const icons = parseRegistry(registry);
if (icons.length === 0) {
  throw new Error("theSVG index generation produced no icons");
}

for (const outputPath of outputPaths) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(icons)}\n`, "utf8");
}

console.log(`Generated ${icons.length} theSVG icons at ${outputPaths.map((item) => path.relative(process.cwd(), item)).join(", ")}`);
