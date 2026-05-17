/**
 * @file 开发者服务订阅官方价格快照。
 *
 * 职责：集中维护 100 条可公开核验的开发者订阅计划，供 seed 编排器生成本地演示数据。
 * 本文件只表达服务名、计划名、公开价格、币种、账期和官方来源；续费日期、付款方式、
 * 状态等 demo 字段由 `developer-subscription-fixtures.mjs` 生成，避免把演示分布误当真实账单。
 *
 * 外部依赖：各服务官方 pricing/help/docs 页面；TheSVG slug 仅作为 logo 查找键，没有可靠 slug 时保持 null。
 *
 * 流程：
 *   official pricing/help/docs -> sub(...) fixture -> validate/defaults -> PocketBase payload
 *
 * Caveat：价格和官方页面会变；更新任一价格时要同步 `PRICE_CHECKED_AT`、`pricingSource` 与 `priceBasis`。
 * TODO：后续可以为价格复核增加脚本化 URL 可达性检查，但不能把第三方汇总页作为来源。
 */

export const PRICE_CHECKED_AT = "2026-05-18";

export const DEVELOPER_SUBSCRIPTION_FIXTURES = [
  sub("chatgpt-plus", "ChatGPT Plus", "openai", 20, "USD", "monthly", "ai_tools", "https://chatgpt.com", "https://help.openai.com/en/articles/6950777-chatgpt-plus", ["AI", "Writing", "Research"], "Plus", "monthly public plan price"),
  sub("claude-pro", "Claude Pro", "anthropic", 20, "USD", "monthly", "ai_tools", "https://claude.ai", "https://www.anthropic.com/pricing", ["AI", "Coding"], "Pro", "monthly public plan price"),
  sub("perplexity-pro", "Perplexity Pro", "perplexity", 20, "USD", "monthly", "ai_tools", "https://www.perplexity.ai", "https://www.perplexity.ai/pricing", ["AI", "Search"], "Pro", "monthly public plan price"),
  sub("github-copilot-pro", "GitHub Copilot Pro", "github", 10, "USD", "monthly", "developer_tools", "https://github.com/features/copilot", "https://github.com/features/copilot/plans", ["Code", "AI"], "Pro", "monthly individual plan price"),
  sub("github-copilot-pro-plus", "GitHub Copilot Pro+", "github", 39, "USD", "monthly", "developer_tools", "https://github.com/features/copilot", "https://github.com/features/copilot/plans", ["Code", "AI"], "Pro+", "monthly individual plan price"),
  sub("github-copilot-business", "GitHub Copilot Business", "github", 19, "USD", "monthly", "developer_tools", "https://github.com/features/copilot", "https://github.com/features/copilot/plans", ["Code", "AI", "Team"], "Business", "per-user monthly plan price"),
  sub("github-copilot-enterprise", "GitHub Copilot Enterprise", "github", 39, "USD", "monthly", "developer_tools", "https://github.com/features/copilot", "https://github.com/features/copilot/plans", ["Code", "AI", "Enterprise"], "Enterprise", "per-user monthly plan price"),
  sub("cursor-pro", "Cursor Pro", "cursor", 20, "USD", "monthly", "developer_tools", "https://cursor.com", "https://cursor.com/pricing", ["Editor", "AI"], "Pro", "monthly public plan price", { status: "trial", trialEndOffsetDays: 2 }),
  sub("cursor-pro-plus", "Cursor Pro+", "cursor", 60, "USD", "monthly", "developer_tools", "https://cursor.com", "https://cursor.com/pricing", ["Editor", "AI"], "Pro+", "monthly public plan price"),
  sub("cursor-ultra", "Cursor Ultra", "cursor", 200, "USD", "monthly", "developer_tools", "https://cursor.com", "https://cursor.com/pricing", ["Editor", "AI"], "Ultra", "monthly public plan price"),
  sub("cursor-teams", "Cursor Teams", "cursor", 40, "USD", "monthly", "developer_tools", "https://cursor.com", "https://cursor.com/pricing", ["Editor", "AI", "Team"], "Teams", "per-user monthly plan price"),
  sub("jetbrains-ai-pro", "JetBrains AI Pro", "jetbrains", 10, "USD", "monthly", "developer_tools", "https://www.jetbrains.com/ai/", "https://www.jetbrains.com/ai/", ["IDE", "AI"], "AI Pro", "personal monthly plan price"),
  sub("raycast-pro", "Raycast Pro", "raycast", 96, "USD", "annual", "productivity", "https://www.raycast.com", "https://www.raycast.com/pricing", ["Launcher", "Mac", "AI"], "Pro", "annual total based on the public USD 8/month annual-billing price"),
  sub("sourcegraph-cody-pro", "Sourcegraph Cody Pro", "sourcegraph", 16, "USD", "monthly", "developer_tools", "https://sourcegraph.com", "https://sourcegraph.com/pricing", ["Code", "AI"], "Cody Pro", "per-user monthly plan price"),
  sub("tabnine-dev", "Tabnine Dev", null, 12, "USD", "monthly", "developer_tools", "https://www.tabnine.com", "https://www.tabnine.com/pricing", ["Code", "AI"], "Dev", "per-user monthly plan price"),
  sub("replit-core", "Replit Core", "replit", 25, "USD", "monthly", "developer_tools", "https://replit.com", "https://replit.com/pricing", ["IDE", "Cloud", "AI"], "Core", "monthly public plan price"),
  sub("windsurf-pro", "Windsurf Pro", null, 15, "USD", "monthly", "developer_tools", "https://windsurf.com", "https://windsurf.com/pricing", ["Editor", "AI"], "Pro", "monthly public plan price"),
  sub("windsurf-teams", "Windsurf Teams", null, 40, "USD", "monthly", "developer_tools", "https://windsurf.com", "https://windsurf.com/pricing", ["Editor", "AI", "Team"], "Teams", "per-user monthly plan price"),
  sub("v0-premium", "v0 Premium", "vercel", 20, "USD", "monthly", "ai_tools", "https://v0.dev", "https://v0.dev/pricing", ["AI", "Frontend"], "Premium", "monthly public plan price"),
  sub("lovable-pro", "Lovable Pro", null, 25, "USD", "monthly", "ai_tools", "https://lovable.dev", "https://lovable.dev/pricing", ["AI", "Frontend"], "Pro", "monthly public plan price"),

  sub("vercel-pro", "Vercel Pro", "vercel", 20, "USD", "monthly", "hosting_domains", "https://vercel.com", "https://vercel.com/pricing", ["Hosting", "Frontend"], "Pro", "per-user monthly plan price"),
  sub("netlify-pro", "Netlify Pro", "netlify", 20, "USD", "monthly", "hosting_domains", "https://www.netlify.com", "https://www.netlify.com/pricing/", ["Hosting", "Frontend"], "Pro", "per-member monthly plan price"),
  sub("supabase-pro", "Supabase Pro", "supabase", 25, "USD", "monthly", "hosting_domains", "https://supabase.com", "https://supabase.com/pricing", ["Database", "Backend"], "Pro", "monthly project plan price"),
  sub("supabase-team", "Supabase Team", "supabase", 599, "USD", "monthly", "hosting_domains", "https://supabase.com", "https://supabase.com/pricing", ["Database", "Backend", "Team"], "Team", "monthly organization plan price"),
  sub("railway-hobby", "Railway Hobby", "railway", 5, "USD", "monthly", "hosting_domains", "https://railway.com", "https://docs.railway.com/pricing/plans", ["Hosting", "Backend"], "Hobby", "monthly public plan price"),
  sub("railway-pro", "Railway Pro", "railway", 20, "USD", "monthly", "hosting_domains", "https://railway.com", "https://docs.railway.com/pricing/plans", ["Hosting", "Backend"], "Pro", "monthly public plan price"),
  sub("render-starter", "Render Starter", "render", 19, "USD", "monthly", "hosting_domains", "https://render.com", "https://render.com/pricing", ["Hosting", "Backend"], "Starter", "monthly team plan price"),
  sub("fly-launch", "Fly.io Launch", "flydotio", 29, "USD", "monthly", "hosting_domains", "https://fly.io", "https://fly.io/plans", ["Hosting", "Backend"], "Launch", "monthly public plan price"),
  sub("heroku-eco-dynos", "Heroku Eco Dynos", "heroku", 5, "USD", "monthly", "hosting_domains", "https://www.heroku.com", "https://www.heroku.com/pricing", ["Hosting", "PaaS"], "Eco Dynos", "monthly dyno plan price"),
  sub("heroku-basic-dyno", "Heroku Basic Dyno", "heroku", 7, "USD", "monthly", "hosting_domains", "https://www.heroku.com", "https://www.heroku.com/pricing", ["Hosting", "PaaS"], "Basic Dyno", "monthly dyno plan price"),
  sub("cloudflare-workers-paid", "Cloudflare Workers Paid", "cloudflare", 5, "USD", "monthly", "hosting_domains", "https://workers.cloudflare.com", "https://developers.cloudflare.com/workers/platform/pricing/", ["Serverless", "Edge"], "Paid", "monthly Workers paid plan price"),
  sub("digitalocean-droplet", "DigitalOcean Basic Droplet", "digitalocean", 6, "USD", "monthly", "hosting_domains", "https://www.digitalocean.com", "https://www.digitalocean.com/pricing/droplets", ["VPS", "Infra"], "Basic Droplet", "entry monthly Droplet price"),
  sub("digitalocean-app-platform-basic", "DigitalOcean App Platform Basic", "digitalocean", 5, "USD", "monthly", "hosting_domains", "https://www.digitalocean.com", "https://www.digitalocean.com/pricing/app-platform", ["PaaS", "Frontend"], "Basic", "entry monthly App Platform component price"),
  sub("docker-pro", "Docker Pro", "docker", 108, "USD", "annual", "developer_tools", "https://www.docker.com", "https://www.docker.com/pricing/", ["Containers", "Registry"], "Pro", "annual total based on the public USD 9/month annual-billing price"),
  sub("docker-team", "Docker Team", "docker", 180, "USD", "annual", "developer_tools", "https://www.docker.com", "https://www.docker.com/pricing/", ["Containers", "Team"], "Team", "per-user annual total based on the public USD 15/month annual-billing price"),
  sub("npm-pro", "npm Pro", "npm", 7, "USD", "monthly", "developer_tools", "https://www.npmjs.com", "https://www.npmjs.com/products", ["Packages", "Registry"], "Pro", "monthly public plan price"),
  sub("ngrok-personal", "ngrok Personal", "ngrok", 8, "USD", "monthly", "developer_tools", "https://ngrok.com", "https://ngrok.com/pricing", ["Tunnels", "Networking"], "Personal", "monthly public plan price"),
  sub("ngrok-professional", "ngrok Professional", "ngrok", 20, "USD", "monthly", "developer_tools", "https://ngrok.com", "https://ngrok.com/pricing", ["Tunnels", "Networking"], "Professional", "monthly public plan price"),
  sub("cloudflare-images-basic", "Cloudflare Images Basic", "cloudflare", 5, "USD", "monthly", "hosting_domains", "https://www.cloudflare.com", "https://www.cloudflare.com/developer-platform/products/cloudflare-images/", ["Images", "CDN"], "Images", "monthly Images subscription price"),
  sub("aws-developer-support", "AWS Developer Support", "amazon-web-services", 29, "USD", "monthly", "hosting_domains", "https://aws.amazon.com", "https://aws.amazon.com/premiumsupport/pricing/", ["Cloud", "Support"], "Developer Support", "minimum monthly support plan price"),

  sub("upstash-redis-select", "Upstash Redis Pay As You Go", "upstash", 10, "USD", "monthly", "hosting_domains", "https://upstash.com", "https://upstash.com/pricing", ["Redis", "Serverless"], "Pay As You Go", "monthly account plan price"),
  sub("turso-starter", "Turso Starter", null, 8, "USD", "monthly", "hosting_domains", "https://turso.tech", "https://turso.tech/pricing", ["Database", "SQLite"], "Starter", "monthly public plan price"),
  sub("turso-scaler", "Turso Scaler", null, 19, "USD", "monthly", "hosting_domains", "https://turso.tech", "https://turso.tech/pricing", ["Database", "SQLite"], "Scaler", "monthly public plan price"),
  sub("meilisearch-build", "Meilisearch Build", "meilisearch", 19, "USD", "monthly", "hosting_domains", "https://www.meilisearch.com", "https://www.meilisearch.com/pricing", ["Search", "Database"], "Build", "monthly public plan price"),
  sub("meilisearch-pro", "Meilisearch Pro", "meilisearch", 26, "USD", "monthly", "hosting_domains", "https://www.meilisearch.com", "https://www.meilisearch.com/pricing", ["Search", "Database"], "Pro", "monthly public plan price"),
  sub("neon-launch", "Neon Launch", "neon", 19, "USD", "monthly", "hosting_domains", "https://neon.tech", "https://neon.tech/pricing", ["Postgres", "Database"], "Launch", "monthly public plan price"),
  sub("neon-scale", "Neon Scale", "neon", 69, "USD", "monthly", "hosting_domains", "https://neon.tech", "https://neon.tech/pricing", ["Postgres", "Database"], "Scale", "monthly public plan price"),
  sub("redis-cloud-essential", "Redis Cloud Essential", "redis", 5, "USD", "monthly", "hosting_domains", "https://redis.io", "https://redis.io/pricing/", ["Redis", "Database"], "Essential", "monthly public fixed plan price"),
  sub("mongodb-atlas-m10", "MongoDB Atlas Dedicated M10", "mongodb", 57, "USD", "monthly", "hosting_domains", "https://www.mongodb.com", "https://www.mongodb.com/pricing", ["Database", "MongoDB"], "M10 Dedicated", "published monthly estimate for the entry dedicated tier"),
  sub("cockroachdb-basic", "CockroachDB Basic", "cockroach-labs", 15, "USD", "monthly", "hosting_domains", "https://www.cockroachlabs.com", "https://www.cockroachlabs.com/pricing/", ["Database", "SQL"], "Basic", "monthly public plan price"),
  sub("contentful-lite", "Contentful Lite", "contentful", 300, "USD", "monthly", "developer_tools", "https://www.contentful.com", "https://www.contentful.com/pricing/", ["CMS", "Content"], "Lite", "monthly public plan price"),
  sub("postman-solo", "Postman Solo", "postman", 108, "USD", "annual", "developer_tools", "https://www.postman.com", "https://www.postman.com/pricing/", ["API", "Testing"], "Solo", "annual total based on the public USD 9/month annual-billing price"),
  sub("sanity-growth", "Sanity Growth", "sanity", 15, "USD", "monthly", "developer_tools", "https://www.sanity.io", "https://www.sanity.io/pricing", ["CMS", "Content"], "Growth", "per-seat monthly plan price"),
  sub("sanity-enterprise", "Sanity Enterprise", "sanity", 999, "USD", "monthly", "developer_tools", "https://www.sanity.io", "https://www.sanity.io/pricing", ["CMS", "Content"], "Enterprise", "monthly public plan price"),
  sub("storyblok-entry", "Storyblok Entry", "storyblok", 99, "USD", "monthly", "developer_tools", "https://www.storyblok.com", "https://www.storyblok.com/pricing", ["CMS", "Content"], "Entry", "monthly public plan price"),
  sub("storyblok-business", "Storyblok Business", "storyblok", 349, "USD", "monthly", "developer_tools", "https://www.storyblok.com", "https://www.storyblok.com/pricing", ["CMS", "Content"], "Business", "monthly public plan price"),
  sub("datocms-professional", "DatoCMS Professional", "datocms", 199, "EUR", "monthly", "developer_tools", "https://www.datocms.com", "https://www.datocms.com/pricing", ["CMS", "Content"], "Professional", "monthly public plan price"),
  sub("datocms-starter", "DatoCMS Starter", "datocms", 19, "EUR", "monthly", "developer_tools", "https://www.datocms.com", "https://www.datocms.com/pricing", ["CMS", "Content"], "Starter", "monthly public plan price"),
  sub("elastic-cloud-standard", "Elastic Cloud Standard", "elastic", 95, "USD", "monthly", "hosting_domains", "https://www.elastic.co/cloud", "https://www.elastic.co/pricing/", ["Search", "Observability"], "Standard", "monthly starting price"),
  sub("figma-professional", "Figma Professional", "figma", 20, "USD", "monthly", "design", "https://www.figma.com", "https://www.figma.com/pricing/", ["Design", "Collaboration"], "Professional", "monthly public plan price"),

  sub("clerk-pro", "Clerk Pro", "clerk", 25, "USD", "monthly", "security_vpn", "https://clerk.com", "https://clerk.com/pricing", ["Auth", "Users"], "Pro", "monthly public plan price"),
  sub("clerk-scale", "Clerk Scale", "clerk", 100, "USD", "monthly", "security_vpn", "https://clerk.com", "https://clerk.com/pricing", ["Auth", "Users"], "Scale", "monthly public plan price"),
  sub("notion-plus", "Notion Plus", "notion", 10, "USD", "monthly", "productivity", "https://www.notion.com", "https://www.notion.com/pricing", ["Docs", "Knowledge"], "Plus", "monthly public plan price"),
  sub("twilio-sendgrid-essentials", "Twilio SendGrid Essentials", "twilio", 19.95, "USD", "monthly", "developer_tools", "https://sendgrid.com", "https://www.twilio.com/en-us/sendgrid/pricing", ["Email", "API"], "Essentials", "monthly public email API plan price"),
  sub("mailgun-foundation", "Mailgun Foundation", "mailgun", 59, "USD", "monthly", "developer_tools", "https://www.mailgun.com", "https://www.mailgun.com/pricing/", ["Email", "API"], "Foundation", "monthly public email API plan price"),
  sub("resend-pro", "Resend Pro", "resend", 20, "USD", "monthly", "developer_tools", "https://resend.com", "https://resend.com/pricing", ["Email", "API"], "Pro", "monthly public plan price"),
  sub("pusher-channels-startup", "Pusher Channels Startup", "pusher", 49, "USD", "monthly", "developer_tools", "https://pusher.com", "https://pusher.com/channels/pricing", ["Realtime", "API"], "Startup", "monthly public plan price"),
  sub("pusher-beams-startup", "Pusher Beams Startup", "pusher", 99, "USD", "monthly", "developer_tools", "https://pusher.com", "https://pusher.com/beams/pricing", ["Push", "API"], "Startup", "monthly public plan price"),
  sub("svix-startup", "Svix Startup", null, 490, "USD", "monthly", "developer_tools", "https://www.svix.com", "https://www.svix.com/pricing/", ["Webhooks", "API"], "Startup", "monthly public plan price"),
  sub("workos-production", "WorkOS Production", null, 125, "USD", "monthly", "security_vpn", "https://workos.com", "https://workos.com/pricing", ["Auth", "Enterprise"], "Production", "monthly public plan price"),

  sub("sentry-team", "Sentry Team", "sentry", 26, "USD", "monthly", "developer_tools", "https://sentry.io", "https://sentry.io/pricing/", ["Observability", "Errors"], "Team", "monthly team plan price"),
  sub("sentry-business", "Sentry Business", "sentry", 80, "USD", "monthly", "developer_tools", "https://sentry.io", "https://sentry.io/pricing/", ["Observability", "Errors"], "Business", "monthly business plan price"),
  sub("datadog-infrastructure-pro", "Datadog Infrastructure Pro", "datadog", 15, "USD", "monthly", "developer_tools", "https://www.datadoghq.com", "https://www.datadoghq.com/pricing/", ["Observability", "Infra"], "Infrastructure Pro", "per-host monthly plan price"),
  sub("datadog-apm-pro", "Datadog APM Pro", "datadog", 31, "USD", "monthly", "developer_tools", "https://www.datadoghq.com", "https://www.datadoghq.com/pricing/", ["Observability", "APM"], "APM Pro", "per-host monthly plan price"),
  sub("grafana-cloud-pro", "Grafana Cloud Pro", "grafana", 19, "USD", "monthly", "developer_tools", "https://grafana.com", "https://grafana.com/pricing/", ["Observability", "Metrics"], "Pro", "monthly public plan price"),
  sub("new-relic-core-user", "New Relic Core User", null, 49, "USD", "monthly", "developer_tools", "https://newrelic.com", "https://newrelic.com/pricing", ["Observability", "APM"], "Core User", "per-user monthly plan price"),
  sub("new-relic-pro-user", "New Relic Pro User", null, 99, "USD", "monthly", "developer_tools", "https://newrelic.com", "https://newrelic.com/pricing", ["Observability", "APM"], "Pro User", "per-user monthly plan price"),
  sub("honeycomb-pro", "Honeycomb Pro", "honeycomb", 130, "USD", "monthly", "developer_tools", "https://www.honeycomb.io", "https://www.honeycomb.io/pricing", ["Observability", "Tracing"], "Pro", "monthly public plan price"),
  sub("better-stack-uptime-team", "Better Stack Uptime Team", "better-stack", 34, "USD", "monthly", "developer_tools", "https://betterstack.com", "https://betterstack.com/pricing", ["Observability", "Uptime"], "Team", "monthly public plan price"),
  sub("honeybadger-team", "Honeybadger Team", "honeybadger", 59, "USD", "monthly", "developer_tools", "https://www.honeybadger.io", "https://www.honeybadger.io/pricing/", ["Observability", "Errors"], "Team", "monthly public plan price"),

  sub("1password-individual", "1Password Individual", "1password", 47.88, "USD", "annual", "security_vpn", "https://1password.com", "https://1password.com/pricing/password-manager", ["Security", "Passwords"], "Individual", "annual total based on the public USD 3.99/month annual-billing price"),
  sub("1password-business", "1Password Business", "1password", 95.88, "USD", "annual", "security_vpn", "https://1password.com", "https://1password.com/pricing/business", ["Security", "Passwords"], "Business", "per-user annual total based on the public USD 7.99/month annual-billing price"),
  sub("bitwarden-premium", "Bitwarden Premium", "bitwarden", 19.8, "USD", "annual", "security_vpn", "https://bitwarden.com", "https://bitwarden.com/pricing/", ["Security", "Passwords"], "Premium", "annual total based on the public USD 1.65/month annual-billing price"),
  sub("bitwarden-teams", "Bitwarden Teams", "bitwarden", 47.88, "USD", "annual", "security_vpn", "https://bitwarden.com", "https://bitwarden.com/pricing/", ["Security", "Passwords"], "Teams", "per-user annual total based on the public USD 3.99/month annual-billing price"),
  sub("snyk-team", "Snyk Team", "snyk", 25, "USD", "monthly", "security_vpn", "https://snyk.io", "https://snyk.io/plans/", ["Security", "SCA"], "Team", "per-user monthly plan price"),
  sub("sonarqube-cloud-team", "SonarQube Cloud Team", "sonarqube", 32, "EUR", "monthly", "security_vpn", "https://www.sonarsource.com", "https://www.sonarsource.com/plans-and-pricing/sonarqube-cloud/", ["Quality", "Security"], "Team", "monthly public plan price"),
  sub("semgrep-team", "Semgrep Team", null, 30, "USD", "monthly", "security_vpn", "https://semgrep.dev", "https://semgrep.dev/pricing", ["Security", "SAST"], "Team", "per-user monthly plan price"),
  sub("tailscale-starter", "Tailscale Starter", "tailscale", 5, "USD", "monthly", "security_vpn", "https://tailscale.com", "https://tailscale.com/pricing", ["VPN", "Networking"], "Starter", "per-user monthly plan price"),
  sub("tailscale-premium", "Tailscale Premium", "tailscale", 10, "USD", "monthly", "security_vpn", "https://tailscale.com", "https://tailscale.com/pricing", ["VPN", "Networking"], "Premium", "per-user monthly plan price"),
  sub("cloudflare-zero-trust-payg", "Cloudflare Zero Trust Pay-as-you-go", "cloudflare", 7, "USD", "monthly", "security_vpn", "https://www.cloudflare.com", "https://www.cloudflare.com/plans/zero-trust-services/", ["Security", "Zero Trust"], "Pay-as-you-go", "per-user monthly plan price"),

  sub("codecov-team", "Codecov Team", "codecov", 12, "USD", "monthly", "developer_tools", "https://about.codecov.io", "https://about.codecov.io/pricing/", ["CI", "Coverage"], "Team", "per-user monthly plan price"),
  sub("circleci-performance", "CircleCI Performance", "circleci", 15, "USD", "monthly", "developer_tools", "https://circleci.com", "https://circleci.com/pricing/", ["CI", "Builds"], "Performance", "monthly public plan price"),
  sub("browserstack-desktop-mobile", "BrowserStack Desktop & Mobile", "browserstack", 39, "USD", "monthly", "developer_tools", "https://www.browserstack.com", "https://www.browserstack.com/pricing", ["Testing", "Browsers"], "Desktop & Mobile", "monthly public plan price"),
  sub("browserstack-automate", "BrowserStack Automate", "browserstack", 149, "USD", "monthly", "developer_tools", "https://www.browserstack.com", "https://www.browserstack.com/pricing", ["Testing", "Automation"], "Automate", "monthly public plan price"),
  sub("sauce-labs-live-testing", "Sauce Labs Live Testing", "sauce-labs", 39, "USD", "monthly", "developer_tools", "https://saucelabs.com", "https://saucelabs.com/pricing", ["Testing", "Browsers"], "Live Testing", "monthly public plan price"),
  sub("lambdatest-live", "LambdaTest Live", null, 15, "USD", "monthly", "developer_tools", "https://www.lambdatest.com", "https://www.lambdatest.com/pricing", ["Testing", "Browsers"], "Live", "monthly public plan price"),
  sub("cypress-cloud-team", "Cypress Cloud Team", "cypress", 799, "USD", "annual", "developer_tools", "https://www.cypress.io", "https://www.cypress.io/pricing", ["Testing", "E2E"], "Team", "annual public plan price"),
  sub("testrail-professional-cloud", "TestRail Professional Cloud", null, 37, "USD", "monthly", "developer_tools", "https://www.testrail.com", "https://www.testrail.com/pricing", ["Testing", "QA"], "Professional Cloud", "per-user monthly plan price"),
  sub("linear-basic", "Linear Basic", "linear", 10, "USD", "monthly", "business", "https://linear.app", "https://linear.app/pricing", ["Issues", "Planning"], "Basic", "per-user monthly plan price"),
  sub("linear-business", "Linear Business", "linear", 16, "USD", "monthly", "business", "https://linear.app", "https://linear.app/pricing", ["Issues", "Planning"], "Business", "per-user monthly plan price"),
];

/**
 * 用 positional factory 压缩 100 行 fixture 的视觉噪音。
 *
 * Caveat：这里牺牲了一点参数自解释性来换取数据表可扫描性；调整字段顺序时必须同步
 * `buildDemoSubscriptions()` 的校验字段和 `toSubscriptionPayload()` 的写入字段。
 */
function sub(slug, name, iconSlug, price, currency, billingCycle, category, website, pricingSource, tags, planLabel, priceBasis, overrides = {}) {
  return {
    slug,
    name,
    iconSlug,
    price,
    currency,
    billingCycle,
    category,
    website,
    pricingSource,
    tags,
    planLabel,
    priceBasis,
    ...overrides,
  };
}
