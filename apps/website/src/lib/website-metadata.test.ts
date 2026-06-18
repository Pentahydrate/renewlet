import { describe, expect, it } from 'vitest'

import {
  renderRobotsTxt,
  renderSitemapXml,
  replaceWebsiteMetadataPlaceholders,
  resolveWebsiteDeployment,
  websiteUrl,
} from './website-metadata'

describe('resolveWebsiteDeployment', () => {
  it('uses root asset paths for a GitHub Pages custom domain', () => {
    // 自定义域部署时资产从根路径读取，不能继续带 GitHub Pages 仓库名前缀。
    const deployment = resolveWebsiteDeployment({
      RENEWLET_WEBSITE_BASE_URL: 'https://renewlet.olyq.org',
      RENEWLET_WEBSITE_BASE_PATH: '',
    })

    expect(deployment).toEqual({
      basePath: '',
      baseUrl: 'https://renewlet.olyq.org',
      viteBase: '/',
    })
  })

  it('uses repository asset paths for the default GitHub Pages project URL', () => {
    // 默认 project page 仍需要 /renewlet/ 作为 Vite base，否则刷新和截图资源会 404。
    const deployment = resolveWebsiteDeployment({
      RENEWLET_WEBSITE_BASE_URL: 'https://zhiyingzzhou.github.io/renewlet',
      RENEWLET_WEBSITE_BASE_PATH: '/renewlet',
    })

    expect(deployment).toEqual({
      basePath: '/renewlet',
      baseUrl: 'https://zhiyingzzhou.github.io/renewlet',
      viteBase: '/renewlet/',
    })
  })

  it('normalizes trailing slashes from GitHub Pages metadata', () => {
    const deployment = resolveWebsiteDeployment({
      RENEWLET_WEBSITE_BASE_URL: 'https://zhiyingzzhou.github.io/renewlet/',
      RENEWLET_WEBSITE_BASE_PATH: 'renewlet/',
    })

    expect(deployment.baseUrl).toBe('https://zhiyingzzhou.github.io/renewlet')
    expect(deployment.basePath).toBe('/renewlet')
    expect(deployment.viteBase).toBe('/renewlet/')
  })

  it('upgrades public GitHub Pages HTTP metadata to HTTPS', () => {
    const deployment = resolveWebsiteDeployment({
      RENEWLET_WEBSITE_BASE_URL: 'http://renewlet.olyq.org',
      RENEWLET_WEBSITE_BASE_PATH: '',
    })

    expect(deployment.baseUrl).toBe('https://renewlet.olyq.org')
  })

  it('keeps local preview metadata on HTTP', () => {
    const deployment = resolveWebsiteDeployment({
      RENEWLET_WEBSITE_BASE_URL: 'http://localhost:4173',
      RENEWLET_WEBSITE_BASE_PATH: '',
    })

    expect(deployment.baseUrl).toBe('http://localhost:4173')
  })
})

describe('website metadata rendering', () => {
  const customDomainDeployment = resolveWebsiteDeployment({
    RENEWLET_WEBSITE_BASE_URL: 'https://renewlet.olyq.org',
    RENEWLET_WEBSITE_BASE_PATH: '',
  })

  it('joins absolute website URLs under the configured Pages URL', () => {
    expect(websiteUrl(customDomainDeployment)).toBe('https://renewlet.olyq.org/')
    expect(websiteUrl(customDomainDeployment, 'en/')).toBe('https://renewlet.olyq.org/en/')
  })

  it('renders robots.txt from the configured Pages URL', () => {
    expect(renderRobotsTxt(customDomainDeployment)).toContain('Sitemap: https://renewlet.olyq.org/sitemap.xml')
  })

  it('renders sitemap URLs from the configured Pages URL', () => {
    const sitemap = renderSitemapXml(customDomainDeployment)

    expect(sitemap).toContain('<loc>https://renewlet.olyq.org/</loc>')
    expect(sitemap).toContain('<loc>https://renewlet.olyq.org/en/</loc>')
    expect(sitemap).not.toContain('zhiyingzzhou.github.io/renewlet')
  })

  it('replaces HTML placeholders with configured absolute URLs', () => {
    // SEO/OG 占位符在 build 阶段替换为绝对 URL，避免社交抓取器依赖客户端 JS。
    const html = [
      '%RENEWLET_WEBSITE_URL%',
      '%RENEWLET_WEBSITE_EN_URL%',
      '%RENEWLET_WEBSITE_LOGO_URL%',
      '%RENEWLET_WEBSITE_DASHBOARD_ZH_URL%',
      '%RENEWLET_WEBSITE_DASHBOARD_EN_URL%',
    ].join('\n')

    expect(replaceWebsiteMetadataPlaceholders(html, customDomainDeployment)).toBe(
      [
        'https://renewlet.olyq.org/',
        'https://renewlet.olyq.org/en/',
        'https://renewlet.olyq.org/assets/renewlet/logo.svg',
        'https://renewlet.olyq.org/assets/renewlet/images/dashboard-zh.png',
        'https://renewlet.olyq.org/assets/renewlet/images/dashboard-en.png',
      ].join('\n'),
    )
  })
})
