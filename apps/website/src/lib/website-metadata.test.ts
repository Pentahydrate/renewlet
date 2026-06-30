import { describe, expect, it } from 'vitest'

import {
  latestStableReleaseVersionFromFileNames,
} from './release-version'
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
      RENEWLET_WEBSITE_BASE_URL: 'https://renewlet.cc',
      RENEWLET_WEBSITE_BASE_PATH: '',
    })

    expect(deployment).toEqual({
      basePath: '',
      baseUrl: 'https://renewlet.cc',
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
      RENEWLET_WEBSITE_BASE_URL: 'http://renewlet.cc',
      RENEWLET_WEBSITE_BASE_PATH: '',
    })

    expect(deployment.baseUrl).toBe('https://renewlet.cc')
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
    RENEWLET_WEBSITE_BASE_URL: 'https://renewlet.cc',
    RENEWLET_WEBSITE_BASE_PATH: '',
  })

  it('joins absolute website URLs under the configured Pages URL', () => {
    expect(websiteUrl(customDomainDeployment)).toBe('https://renewlet.cc/')
    expect(websiteUrl(customDomainDeployment, 'en/')).toBe('https://renewlet.cc/en/')
  })

  it('renders robots.txt from the configured Pages URL', () => {
    expect(renderRobotsTxt(customDomainDeployment)).toContain('Sitemap: https://renewlet.cc/sitemap.xml')
  })

  it('renders sitemap URLs from the configured Pages URL', () => {
    const sitemap = renderSitemapXml(customDomainDeployment)

    expect(sitemap).toContain('<loc>https://renewlet.cc/</loc>')
    expect(sitemap).toContain('<loc>https://renewlet.cc/en/</loc>')
    expect(sitemap).toContain('<lastmod>2026-06-19</lastmod>')
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
      '%RENEWLET_WEBSITE_SOFTWARE_VERSION%',
    ].join('\n')

    expect(replaceWebsiteMetadataPlaceholders(html, customDomainDeployment, { softwareVersion: '0.1.9' })).toBe(
      [
        'https://renewlet.cc/',
        'https://renewlet.cc/en/',
        'https://renewlet.cc/assets/renewlet/logo.svg',
        'https://renewlet.cc/assets/renewlet/images/dashboard-zh.png',
        'https://renewlet.cc/assets/renewlet/images/dashboard-en.png',
        '0.1.9',
      ].join('\n'),
    )
  })
})

describe('release note version selection', () => {
  it('uses the highest stable release note version and ignores RC files', () => {
    expect(
      latestStableReleaseVersionFromFileNames([
        'v0.1.8-zh.md',
        'v0.1.9-en.md',
        'v0.1.9-zh.md',
        'v0.2.0-rc.1-zh.md',
      ]),
    ).toBe('0.1.9')
  })
})
