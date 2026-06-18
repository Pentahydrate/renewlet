const LOCAL_PREVIEW_BASE_URL = 'http://localhost:4173'
const SITEMAP_LASTMOD = '2026-06-02'

export type WebsiteEnv = Record<string, string | undefined>

export type WebsiteDeployment = {
  basePath: string
  baseUrl: string
  viteBase: string
}

function normalizeBasePath(rawBasePath: string | undefined) {
  const trimmed = rawBasePath?.trim() ?? ''
  if (!trimmed || trimmed === '/') return ''

  // basePath 用于 Vite asset 前缀，只保留 path 段，避免环境变量里多余斜杠影响静态资源 URL。
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function normalizeBaseUrl(rawBaseUrl: string | undefined) {
  const candidate = rawBaseUrl?.trim() || LOCAL_PREVIEW_BASE_URL
  const url = new URL(candidate)

  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.protocol = 'https:'
  }
  // sitemap/OG URL 必须是稳定 origin + path，不继承预览链接里的 query/hash。
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

export function resolveWebsiteDeployment(env: WebsiteEnv = {}): WebsiteDeployment {
  const basePath = normalizeBasePath(env.RENEWLET_WEBSITE_BASE_PATH)
  const baseUrl = normalizeBaseUrl(env.RENEWLET_WEBSITE_BASE_URL)

  return {
    basePath,
    baseUrl,
    // Vite base 需要尾随斜杠；空子路径必须回到根路径，否则 build 后资源会变成相对路径。
    viteBase: basePath ? `${basePath}/` : '/',
  }
}

export function websiteUrl(deployment: Pick<WebsiteDeployment, 'baseUrl'>, path = '') {
  const normalizedPath = path.replace(/^\/+/, '')
  return normalizedPath ? `${deployment.baseUrl}/${normalizedPath}` : `${deployment.baseUrl}/`
}

export function renderRobotsTxt(deployment: WebsiteDeployment) {
  return `User-agent: *
Allow: /

Sitemap: ${websiteUrl(deployment, 'sitemap.xml')}
`
}

export function renderSitemapXml(deployment: WebsiteDeployment) {
  const rootUrl = websiteUrl(deployment)
  const enUrl = websiteUrl(deployment, 'en/')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${rootUrl}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${rootUrl}" />
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${rootUrl}" />
  </url>
  <url>
    <loc>${enUrl}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${rootUrl}" />
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${rootUrl}" />
  </url>
</urlset>
`
}

export function replaceWebsiteMetadataPlaceholders(html: string, deployment: WebsiteDeployment) {
  // HTML 模板里的占位符由构建脚本一次性替换，避免运行时 JS 才补 SEO/分享元数据。
  const replacements: Record<string, string> = {
    '%RENEWLET_WEBSITE_URL%': websiteUrl(deployment),
    '%RENEWLET_WEBSITE_EN_URL%': websiteUrl(deployment, 'en/'),
    '%RENEWLET_WEBSITE_LOGO_URL%': websiteUrl(deployment, 'assets/renewlet/logo.svg'),
    '%RENEWLET_WEBSITE_DASHBOARD_ZH_URL%': websiteUrl(deployment, 'assets/renewlet/images/dashboard-zh.png'),
    '%RENEWLET_WEBSITE_DASHBOARD_EN_URL%': websiteUrl(deployment, 'assets/renewlet/images/dashboard-en.png'),
  }

  return Object.entries(replacements).reduce((result, [placeholder, value]) => result.replaceAll(placeholder, value), html)
}
