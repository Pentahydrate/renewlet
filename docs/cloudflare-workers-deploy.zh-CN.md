# Cloudflare Workers 部署

## 一键部署

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

1. 点击按钮。
2. 按 Cloudflare 向导完成部署。
3. 打开：

```text
https://<worker-name>.<workers-dev-subdomain>.workers.dev/setup
```

## GitHub Actions 部署

手动创建 Cloudflare 资源和 GitHub Secrets。push 到 `dev` 或手动运行 workflow。

流程：

- 检查 Cloudflare Worker 和前端类型
- 构建 Cloudflare 前端
- 如果 5 个 GitHub Secrets 都已配置，根据 Secrets 生成 `wrangler.generated.jsonc`
- 如果 5 个 GitHub Secrets 都已配置，应用远端 D1 migrations 并部署 Worker

如果缺少任意必需 secret，workflow 仍会运行 Cloudflare 检查和构建，然后通过 GitHub Actions notice 明确跳过远端 D1 migration 和 Worker 部署。

把下面 5 个值填进 GitHub Secrets 后才会启用远端部署。

### 1. Fork 仓库

把当前仓库 Fork 到自己的账号或组织。

仓库名已存在：使用已有 fork；或删除/重命名同名仓库后重新 Fork。

### 2. 创建 Cloudflare 资源

在 Cloudflare 控制台创建 D1 数据库和 R2 bucket。

D1：

1. 打开 Cloudflare 控制台的 `存储和数据库` -> `D1 SQL 数据库`。
2. 点击 `创建数据库`。

   <img src="./screenshots/cloudflare/zh/cloudflare-d1-create.jpg" alt="创建 D1 SQL 数据库" width="720">

3. 数据库名填 `renewlet`。

   <img src="./screenshots/cloudflare/zh/cloudflare-d1-create-setting.jpg" alt="创建 D1 SQL 数据库" width="720">

4. 打开创建好的数据库，复制 database ID，作为 `D1_DATABASE_ID`。

   <img src="./screenshots/cloudflare/zh/cloudflare-d1-id.jpg" alt="复制 database ID" width="720">

R2：

1. 打开 Cloudflare 控制台的 `存储和数据库` -> `R2 对象存储`。

   <img src="./screenshots/cloudflare/zh/cloudflare-r2-bucket-create.jpg" alt="创建 R2 对象存储" width="720">

2. 创建 bucket，名称填 `renewlet-assets`。

   <img src="./screenshots/cloudflare/zh/cloudflare-r2-bucket-create-setting.jpg" alt="创建 R2 对象存储" width="720">

3. 复制 bucket 名，作为 `R2_BUCKET_NAME`。

   <img src="./screenshots/cloudflare/zh/cloudflare-r2-bucket-setting.jpg" alt="复制 bucket 名" width="720">

Renewlet 的 Worker binding 名固定如下：

| Binding | Cloudflare 产品 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 用户、会话、订阅、设置、通知任务 |
| `ASSETS_BUCKET` | R2 | 私有上传 Logo/Icon |

### 3. 获取 CLOUDFLARE_ACCOUNT_ID

直达入口：<a href="https://dash.cloudflare.com/?to=/:account/home" target="_blank" rel="noopener noreferrer">https://dash.cloudflare.com/?to=/:account/home</a>

1. 打开 Cloudflare Dashboard。
2. 进入 `账户主页`。
3. 找到部署 Renewlet 的账号行。
4. 点击账号行右侧菜单按钮。
5. 点击 `复制帐户 ID`。
6. 把复制值保存为 `CLOUDFLARE_ACCOUNT_ID`。

<img src="./screenshots/cloudflare/zh/cloudflare-account-id.jpg" alt="复制帐户 ID" width="720">

也可以从 `Workers & Pages` 页面复制：打开 `Workers & Pages`，在 `Account details` 里点击 `Account ID` 的复制按钮。

直达入口：<a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages" target="_blank" rel="noopener noreferrer">https://dash.cloudflare.com/?to=/:account/workers-and-pages</a>

<img src="./screenshots/cloudflare/zh/cloudflare-workers-account-id.jpg" alt="复制帐户 ID" width="720">

### 4. 创建 CLOUDFLARE_API_TOKEN

直达入口：<a href="https://dash.cloudflare.com/?to=/:account/api-tokens" target="_blank" rel="noopener noreferrer">https://dash.cloudflare.com/?to=/:account/api-tokens</a>

权限：`Edit Cloudflare Workers` + `Account` -> `D1` -> `Edit`。资源范围选部署 Renewlet 的账号；绑定自定义域名时，zone 选对应域名。

1. 打开 Cloudflare Dashboard。
2. 进入 `帐户 API 令牌` 页面。
3. 点击 `创建令牌`。

   <img src="./screenshots/cloudflare/zh/cloudflare-api-token-list.jpg" alt="帐户 API 令牌页面" width="720">

4. 令牌名称 填 `renewlet-worker-deploy`。
5. 在 `权限策略` 里打开 `Custom` 下拉框，选择 `Edit Cloudflare Workers`。

   <img src="./screenshots/cloudflare/zh/cloudflare-api-token-template.jpg" alt="Edit Cloudflare Workers" width="720">

6. 在权限列表里新增一行：`Account` -> `D1` -> `Edit`。

   <img src="./screenshots/cloudflare/zh/cloudflare-api-token-permissions-add-d1.jpg" alt="Add d1 edit" width="720">

   <img src="./screenshots/cloudflare/zh/cloudflare-api-token-permissions-d1.jpg" alt="Add d1 edit" width="720">
   
7. 向下滚动到 `资源` 区域。
8. 如果页面显示 `帐户资源`：选择 `包括` -> 部署 Renewlet 的 Cloudflare 账号。
9. 如果页面显示 `区域资源`：选择后面要绑定 Worker route 或 custom domain 的域名。
10. 如果页面没有资源选择区，直接点击 `审核令牌`。

    <img src="./screenshots/cloudflare/zh/cloudflare-api-token-summary-review.jpg" alt="审核令牌" width="720">

11. 检查 令牌名称、权限策略 和 资源(没有的话跳过)。
12. 点击 `创建令牌`。

    <img src="./screenshots/cloudflare/zh/cloudflare-api-token-summary-create.jpg" alt="创建令牌" width="720">

13. 复制生成的 token，保存为 `CLOUDFLARE_API_TOKEN`。**请立刻保存，token 只显示一次。**

    <img src="./screenshots/cloudflare/zh/cloudflare-api-token-created.jpg" alt="复制令牌" width="720">

    <img src="./screenshots/cloudflare/zh/cloudflare-api-token-list-success.jpg" alt="令牌列表" width="720">

### 5. 配置 GitHub Secrets

在你的 fork 仓库里打开 `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`，添加下面 5 个 repository secrets：

| Secret | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 用于 GitHub Actions 调用 Wrangler 部署 Worker 并应用远端 D1 migrations 的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 部署 Renewlet 的 Cloudflare account ID |
| `WORKER_NAME` | Worker 名称，例如 `renewlet` 或 `renewlet-prod` |
| `D1_DATABASE_ID` | 从 Cloudflare 控制台复制的 D1 database ID |
| `R2_BUCKET_NAME` | R2 bucket 名称，例如 `renewlet-assets` |

<img src="./screenshots/cloudflare/github-actions-secrets.jpg" alt="New repository secret" width="720">

<img src="./screenshots/cloudflare/github-new-secret.jpg" alt="New repository secret" width="720">

<img src="./screenshots/cloudflare/github-secrets-complete.jpg" alt="New repository secret" width="720">

### 6. 运行部署

工作流文件在 `.github/workflows/cloudflare-worker.yml`。

它会在 push 到 `dev` 时自动运行，也可以从 GitHub Actions 手动运行：

workflow 需要下面 5 个 repository secrets 才会部署到 Cloudflare。没有配齐时，它只验证 Cloudflare 构建路径，不会修改任何远端 D1 数据库或 Worker。

1. 打开你的 fork 仓库。
2. 进入 `Actions`。
3. 选择 `Cloudflare Worker`。
4. 点击 `Run workflow`。

<img src="./screenshots/cloudflare/github-actions-workflow.jpg" alt="Github action workflow" width="720">

<img src="./screenshots/cloudflare/github-actions-run.jpg" alt="Github action run" width="720">

<img src="./screenshots/cloudflare/github-actions-success.jpg" alt="Github action success" width="720">

### 7. 打开 Renewlet

默认访问地址是：

```text
https://<WORKER_NAME>.<workers-dev-subdomain>.workers.dev/setup
```

<img src="./screenshots/cloudflare/zh/cloudflare-worker-domain.jpg" alt="自定义域名" width="720">

自定义域名：部署后在 Cloudflare 控制台为 Worker 绑定 route 或 custom domain。

<img src="./screenshots/cloudflare/zh/cloudflare-worker-custom-domain.jpg" alt="自定义域名" width="720">

## 更新版本

Workers 部署不支持 Renewlet 的 Docker 页面内更新器。管理员版本弹窗只显示版本信息和 GitHub Release 链接。

Workers 部署支持两种更新方式：

### 自动更新

启用 Upstream Sync Action 后，上游仓库有更新时会自动同步并触发部署。

### 手动更新

1. 在 Fork 仓库中同步上游更新。
2. 同步完成后会自动触发部署；也可以手动进入 Actions 页面运行 `Cloudflare Worker`。

## Wrangler CLI

创建资源：

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create renewlet
pnpm exec wrangler r2 bucket create renewlet-assets
```

导出真实值并部署：

```bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
export WORKER_NAME="renewlet"
export D1_DATABASE_ID="..."
export R2_BUCKET_NAME="renewlet-assets"

pnpm cloudflare:config:ci
pnpm check:cloudflare
pnpm build:cloudflare
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.generated.jsonc
pnpm exec wrangler deploy --config wrangler.generated.jsonc
```

## 本地开发

复制本地变量示例：

```bash
cp .dev.vars.example .dev.vars
```

启动本地 Worker：

```bash
pnpm check:cloudflare
pnpm build:cloudflare
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev --test-scheduled --ip 0.0.0.0
```

打开：

```text
http://localhost:8787/setup
http://<本机局域网 IP>:8787/setup
```

生产 Cron 使用 `wrangler.jsonc` 里的 `triggers.crons`。

本地模拟 Cron Trigger：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
curl "http://<本机局域网 IP>:8787/__scheduled?cron=*+*+*+*+*"
```

`/__scheduled` 需要配合 `wrangler dev --test-scheduled` 使用。

## 部署后巡检

首次复制巡检变量模板，填入已部署 Worker 域名和独立测试管理员账号：

```bash
cp cloudflare-check.env.example cloudflare-check.env.local
```

之后直接运行：

```bash
pnpm test:e2e:cloudflare
```

`cloudflare-check.env.local` 会被 git 忽略；脚本会先运行 `pnpm typecheck:e2e`，再检查公开路由、登录守卫、私有页面、设置页、临时订阅写删、移动端布局和核心 API 重复请求。

只做只读巡检：

```bash
pnpm test:e2e:cloudflare -- --readonly
```

## 本地数据

Wrangler 的本地 D1 文件在项目目录：

```text
.wrangler/state/v3/d1/
```

Renewlet 的本地 R2 状态在：

```text
.wrangler/state/v3/r2/
```

查表：

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
```

查看用户：

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT id, email, role, created_at FROM users;"
```

查看订阅数量：

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT COUNT(*) AS count FROM subscriptions;"
```

用 `sqlite3` 直接打开：

```bash
sqlite3 "$(find .wrangler/state/v3/d1 -name '*.sqlite' ! -name 'metadata.sqlite' | head -n 1)"
```

## 其他配置

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `SETUP_ENABLED` | Worker var | `/setup` 开关，默认 `true` |
| `SESSION_TTL_DAYS` | Worker var | 登录有效期，默认 30 天 |
| `VITE_RENEWLET_RUNTIME=cloudflare` | 构建变量 | 前端使用 Worker API |

## 常见情况

**Worker 名称已存在怎么办？**

修改 GitHub Secrets 里的 `WORKER_NAME`，重新运行 workflow。

**旧 `pb_data`？**

走单独导出/导入流程。
