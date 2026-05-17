/**
 * 站点图标候选 URL 生成工具（favicon）。
 *
 * 背景：
 * - 项目里有 LogoPicker / IconPicker 两个组件，都需要“根据关键词猜测站点域名，然后生成一组可尝试的图标 URL”
 * - 这类逻辑容易在多个组件里重复，且后续要调整策略（比如换第三方服务、增加候选路径）时会很难维护
 *
 * 设计目标：
 * - 纯函数、无副作用：只负责生成候选 URL，不做网络请求
 * - 可配置：支持传入“已知关键词→域名映射”与 fallback TLD 列表
 * - 输出去重：避免同一 URL 重复出现在候选列表里
 */

/** favicon 候选生成参数。 */
export interface GenerateFaviconUrlsOptions {
  /** 用户输入的关键词，例如 "netflix" / "alipay"。 */
  name: string;
  /**
   * 可选：常见关键词 → 域名映射（命中率更高）。
   *
   * 例：{ netflix: "netflix.com" }
   */
  knownDomains?: Readonly<Record<string, string>>;
  /**
   * 可选：当 unknown 时，用 `${keyword}.${tld}` 的方式猜测域名。
   *
   * 例：["com", "io", "co"]
   */
  fallbackTlds?: readonly string[];
  /**
   * 可选：是否额外尝试 `www.` 变体（仅针对形如 `example.com` 的主域名）。
   *
   * 默认：true
   */
  includeWwwVariant?: boolean;
}

/**
 * 生成 favicon 候选 URL 列表（已去重）。
 *
 * 注意：
 * - 这里不会校验 URL 是否真实存在；由上层组件通过 `<img onError>` 做“失败剔除”
 * - 不建议无限制增加候选来源，否则会造成大量失败请求影响体验
 */
export function generateFaviconUrls(options: GenerateFaviconUrlsOptions): string[] {
  const raw = options.name.trim();
  if (!raw) return [];

  const keyword = raw.toLowerCase().replace(/\s+/g, "");
  const includeWwwVariant = options.includeWwwVariant ?? true;
  const fallbackTlds = options.fallbackTlds ?? ["com", "io", "co"];

  const domains: string[] = [];

  const known = options.knownDomains?.[keyword];
  if (known) domains.push(known);

  for (const tld of fallbackTlds) {
    const normalizedTld = tld.trim();
    if (!normalizedTld) continue;
    domains.push(`${keyword}.${normalizedTld}`);
  }

  const domainSet = new Set(domains.filter((d) => d.length > 0));
  const urls: string[] = [];

  const pushFaviconCandidates = (domain: string) => {
    urls.push(`https://${domain}/favicon.ico`);
    urls.push(`https://${domain}/apple-touch-icon.png`);
    urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
    urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  };

  for (const domain of domainSet) {
    pushFaviconCandidates(domain);

    if (!includeWwwVariant) continue;

    // 仅针对主域名补全 `www.` 变体（例如 example.com → www.example.com）。
    const parts = domain.split(".");
    if (parts.length === 2 && !domain.startsWith("www.")) {
      pushFaviconCandidates(`www.${domain}`);
    }
  }

  return [...new Set(urls)];
}
