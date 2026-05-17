/**
 * 图标索引与搜索工具（The SVG）。
 *
 * 架构位置：
 * - 脚本侧拉取 registry 后调用 parse/create 生成本地索引。
 * - API route 运行时只加载本地索引并调用 search，避免每次请求访问远端 registry。
 *
 * 注意： 所有 slug/variant/path 都要做白名单校验，避免远端 registry 被污染后生成危险 URL。
 */
import { rankSearchText } from "@/lib/searchable-options";
import type { ApiTheSvgIcon } from "@/lib/api/schemas/media";

/** The SVG CDN 根地址；只在构建图标 URL 时集中引用。 */
export const THE_SVG_CDN_BASE = "https://testingcf.jsdelivr.net/gh/glincker/thesvg@main";
/** The SVG upstream registry 地址；更新脚本使用，运行时 API 不直接访问。 */
export const THE_SVG_REGISTRY_URL = `${THE_SVG_CDN_BASE}/src/data/icons.json`;

/** 上游 registry 的单个图标结构。 */
export interface TheSvgRegistryIcon {
  slug: string;
  title: string;
  aliases: string[];
  categories: string[];
  variants: Record<string, string>;
  hex?: string | undefined;
  license?: string | undefined;
  url?: string | undefined;
  guidelines?: string | undefined;
}

/** 本地索引中的图标结构：每个图标只保留最终选中的 variant，减小运行时体积。 */
export interface TheSvgIndexIcon {
  slug: string;
  title: string;
  aliases: string[];
  categories: string[];
  variant: string;
  hex?: string | undefined;
  license?: string | undefined;
  url?: string | undefined;
  guidelines?: string | undefined;
}

type TheSvgSearchIcon = TheSvgRegistryIcon | TheSvgIndexIcon;

const PREFERRED_VARIANTS = ["default", "color"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function isSafePathPart(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function parseVariants(slug: string, value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const variants: Record<string, string> = {};
  for (const [variant, path] of Object.entries(value)) {
    if (!isSafePathPart(variant)) continue;
    if (typeof path !== "string") continue;
    const normalizedPath = path.trim();
    if (!normalizedPath.endsWith(".svg")) continue;
    if (!normalizedPath.startsWith(`/icons/${slug}/`)) continue;
    variants[variant] = normalizedPath;
  }

  return variants;
}

/** 从不可信 JSON 中解析 The SVG registry，并丢弃不完整或路径不安全的记录。 */
export function parseTheSvgRegistry(value: unknown): TheSvgRegistryIcon[] {
  if (!Array.isArray(value)) return [];

  const icons: TheSvgRegistryIcon[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const slug = asString(item["slug"]);
    const title = asString(item["title"]);
    if (!slug || !title) continue;
    if (!isSafePathPart(slug)) continue;
    if (seen.has(slug)) continue;

    const variants = parseVariants(slug, item["variants"]);
    if (Object.keys(variants).length === 0) continue;

    icons.push({
      slug,
      title,
      aliases: asStringArray(item["aliases"]),
      categories: asStringArray(item["categories"]),
      variants,
      hex: asString(item["hex"]),
      license: asString(item["license"]),
      url: asString(item["url"]),
      guidelines: asString(item["guidelines"]),
    });
    seen.add(slug);
  }

  return icons;
}

/** 选择最适合 UI 展示的 variant，优先彩色/默认版本，最后再回退任意安全 variant。 */
export function chooseTheSvgVariant(icon: Pick<TheSvgRegistryIcon, "variants">): string | undefined {
  for (const variant of PREFERRED_VARIANTS) {
    if (icon.variants[variant]) return variant;
  }

  return Object.keys(icon.variants).find(isSafePathPart);
}

/** 将完整 registry 压缩为运行时搜索索引。 */
export function createTheSvgIndex(registry: readonly TheSvgRegistryIcon[]): TheSvgIndexIcon[] {
  return registry.flatMap((icon) => {
    const variant = chooseTheSvgVariant(icon);
    if (!variant) return [];

    return [{
      slug: icon.slug,
      title: icon.title,
      aliases: icon.aliases,
      categories: icon.categories,
      variant,
      hex: icon.hex,
      license: icon.license,
      url: icon.url,
      guidelines: icon.guidelines,
    }];
  });
}

/** 构造可直接展示的 SVG CDN URL；slug/variant 必须先通过安全路径校验。 */
export function buildTheSvgIconUrl(slug: string, variant: string): string {
  if (!isSafePathPart(slug) || !isSafePathPart(variant)) {
    throw new Error("Invalid theSVG icon path");
  }
  return `${THE_SVG_CDN_BASE}/public/icons/${slug}/${variant}.svg`;
}

function getTheSvgVariant(icon: TheSvgSearchIcon): string | undefined {
  if ("variant" in icon) return isSafePathPart(icon.variant) ? icon.variant : undefined;
  return chooseTheSvgVariant(icon);
}

function toApiIcon(icon: TheSvgSearchIcon): ApiTheSvgIcon | undefined {
  const variant = getTheSvgVariant(icon);
  if (!variant) return undefined;

  return {
    slug: icon.slug,
    title: icon.title,
    iconUrl: buildTheSvgIconUrl(icon.slug, variant),
    aliases: icon.aliases,
    categories: icon.categories,
    hex: icon.hex,
    license: icon.license,
    url: icon.url,
    guidelines: icon.guidelines,
  };
}

function scoreTheSvgIcon(icon: TheSvgSearchIcon, query: string): number {
  const score = rankSearchText(
    [
      icon.slug,
      icon.title,
      ...icon.aliases,
      ...icon.categories,
      icon.url ?? "",
      icon.guidelines ?? "",
    ],
    query,
  );

  if (score === 0) return 0;
  const normalizedQuery = query.trim().toLowerCase();
  if (icon.slug.toLowerCase() === normalizedQuery) return score + 0.3;
  if (icon.title.toLowerCase() === normalizedQuery) return score + 0.2;
  if (icon.slug.toLowerCase().startsWith(normalizedQuery)) return score + 0.1;
  return score;
}

/** 基于 slug、标题、别名和分类搜索图标，并返回 API DTO。 */
export function searchTheSvgIcons(
  registry: readonly TheSvgSearchIcon[],
  query: string,
  limit = 32,
): ApiTheSvgIcon[] {
  const q = query.trim();
  if (!q) return [];

  return registry
    .map((icon) => ({ icon, score: scoreTheSvgIcon(icon, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.icon.title.localeCompare(b.icon.title))
    .map((item) => toApiIcon(item.icon))
    .filter((icon): icon is ApiTheSvgIcon => Boolean(icon))
    .slice(0, limit);
}
