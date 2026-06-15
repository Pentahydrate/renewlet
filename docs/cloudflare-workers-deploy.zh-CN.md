# Cloudflare Workers 部署

## 推荐：一键部署

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

1. 点击按钮。
2. 登录或授权 Cloudflare。
3. 按 Cloudflare 向导完成部署。
4. 打开：

```text
https://<worker-name>.<workers-dev-subdomain>.workers.dev/setup
```

保持生成的部署命令为 `pnpm deploy`。Renewlet 的 deploy 脚本会先应用 D1 migrations，再发布 Worker，确保新表先创建好，更新后的 API 再开始对外服务。

### 无法获取存储库内容

如果 Cloudflare 页面提示 `Failed to get repository contents` / `无法获取存储库内容`，通常是部署向导读取 GitHub 公共仓库时遇到临时限流或网络出口问题，不代表 Renewlet 服务端或 Worker 代码部署失败。

如果你使用代理节点、公司/校园网络或其他共享网络出口，当前出口 IP 也可能被 GitHub 或 Cloudflare 临时限流。不要连续重试；可以稍后再试、切换更稳定的代理节点/网络出口；仍失败时，改用下面的手动部署流程。

### 升级办法

一键部署会在你的 GitHub/GitLab 账号下生成一个仓库。以后升级，更新这个仓库，不要重新点一键部署按钮。

先在 Cloudflare Dashboard 打开 Renewlet Worker，进入 `Settings` -> `Builds`，找到连接的生成仓库。然后本地执行：

```bash
git clone https://github.com/<你的账号>/<Cloudflare生成的仓库>.git
cd <Cloudflare生成的仓库>
git remote add upstream https://github.com/zhiyingzzhou/renewlet.git
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

如果已经有 `upstream`：

```bash
git remote set-url upstream https://github.com/zhiyingzzhou/renewlet.git
```

然后继续执行上面的 `git fetch upstream`、`git merge upstream/main` 和 `git push origin main`。

push 后 Cloudflare 会自动重新部署。

如果你想自己创建 D1/R2、Cloudflare API Token 和 GitHub Secrets，可以继续使用下面的手动部署流程。

## 手动部署（GitHub Actions）

手动部署适合想自己管理 Cloudflare 资源和 GitHub Actions 的用户。准备好下面 5 个值后，在你的 fork 仓库里手动运行 `Cloudflare Worker`。

流程：

- 检查 Cloudflare Worker 和前端类型
- 构建 Cloudflare 前端
- 如果 5 个 GitHub Secrets 都已配置，根据 Secrets 生成 `wrangler.generated.jsonc`
- 如果 5 个 GitHub Secrets 都已配置，应用远端 D1 migrations 并部署 Worker

如果缺少任意必需 secret，workflow 仍会运行 Cloudflare 检查和构建，然后通过 GitHub Actions notice 明确跳过远端 D1 migration 和 Worker 部署。

把下面 5 个值填进 GitHub Secrets 后才会启用远端部署。

### 1. Fork 仓库

把当前仓库 Fork 到自己的账号或组织。

仓库名已存在：使用已有 fork，或换一个仓库名。

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

在你的 fork 仓库里打开 `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`，添加下面 5 个必需 repository secrets：

| Secret | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 用于 GitHub Actions 调用 Wrangler 部署 Worker 并应用远端 D1 migrations 的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 部署 Renewlet 的 Cloudflare account ID |
| `WORKER_NAME` | Worker 名称，例如 `renewlet` 或 `renewlet-prod` |
| `D1_DATABASE_ID` | 从 Cloudflare 控制台复制的 D1 database ID |
| `R2_BUCKET_NAME` | R2 bucket 名称，例如 `renewlet-assets` |

可选：Renewlet 会用 GitHub Release 检查版本弹窗，也会用 GitHub 仓库 commit 检查内置图标库状态。大多数部署可以匿名检查；如果版本或图标库状态出现 GitHub `403` / 限流错误，再额外添加下面这个 repository secret：

| Secret | 值 |
| --- | --- |
| `RENEWLET_GITHUB_TOKEN` | 只读 GitHub token；workflow 会在部署 Worker 时通过临时 `--secrets-file` 上传为 Worker secret |

一键部署用户不使用这张 GitHub Actions secrets 表；需要时在 Cloudflare Dashboard 打开 Renewlet Worker，进入 `Settings` -> `Variables and Secrets`，添加同名 `RENEWLET_GITHUB_TOKEN` Secret 后重新部署。

本地 `pnpm dev:cloudflare` 放到已忽略的 `.dev.vars`：

```env
RENEWLET_GITHUB_TOKEN="github_pat_..."
```

不要把这个 token 写进 `wrangler.jsonc` 的 `vars`、`wrangler.generated.jsonc` 或前端代码。

<img src="./screenshots/cloudflare/github-actions-secrets.jpg" alt="New repository secret" width="720">

<img src="./screenshots/cloudflare/github-new-secret.jpg" alt="New repository secret" width="720">

<img src="./screenshots/cloudflare/github-secrets-complete.jpg" alt="New repository secret" width="720">

### 6. 运行部署

工作流文件在 `.github/workflows/cloudflare-worker.yml`。

首次部署建议从 GitHub Actions 手动运行。之后同步 fork 更新后，仓库启用 Actions 时会自动重新部署；也可以随时从 GitHub Actions 手动运行：

workflow 需要上面 5 个必需 repository secrets 才会部署到 Cloudflare。没有配齐时，它只验证 Cloudflare 构建路径，不会修改任何远端 D1 数据库或 Worker。

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

一键部署用户：按上面的“升级办法”，同步 Cloudflare Builds 连接的生成仓库。

手动部署用户：打开 fork，点击 `Sync fork` / `Update branch`。如果没有自动部署，进入 `Actions` 手动运行 `Cloudflare Worker`。

每次 Cloudflare 升级都必须先跑 D1 migrations，再发布 Worker。`pnpm deploy` 和 GitHub Actions 都会按这个顺序执行。

## 可选：Wrangler CLI

普通部署不需要使用 Wrangler CLI。只有你想在本机直接管理 Cloudflare 资源时，再使用下面的命令。

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

如果本机 CLI 部署也需要 `RENEWLET_GITHUB_TOKEN`，先生成未提交的 secrets 文件，再沿用同一个 generated config 部署：

```bash
cat > cloudflare-worker-secrets.local <<'EOF'
RENEWLET_GITHUB_TOKEN="github_pat_..."
EOF

pnpm exec wrangler deploy --config wrangler.generated.jsonc --secrets-file cloudflare-worker-secrets.local
```

## 其他配置

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `SETUP_ENABLED` | Worker var | `/setup` 开关，默认 `true` |
| `SESSION_TTL_DAYS` | Worker var | 登录有效期，默认 30 天 |
| `RENEWLET_GITHUB_TOKEN` | Worker secret | 可选；提高 GitHub Release 和内置图标库版本检查额度 |
| `VITE_RENEWLET_RUNTIME=cloudflare` | 构建变量 | 前端使用 Worker API |

## 常见情况

**Worker 名称已存在怎么办？**

修改 GitHub Secrets 里的 `WORKER_NAME`，重新运行 workflow。

**日历订阅提示 `no such table: calendar_feeds`？**

说明 Worker 已更新，但远端 D1 migrations 没有完成或没有运行。日历订阅表现在同时保存全局 Feed 和单个订阅 Feed 的 scoped token，所以必须先完成 D1 migration 再依赖日历订阅链接。重新运行 `Cloudflare Worker` workflow，或执行：

```bash
pnpm cloudflare:config:ci
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.generated.jsonc
```

**Server酱测试通知返回 HTTP 429？**

这是 Server酱上游拒绝请求。Server酱官方 FAQ 写明：`429` 是来源 IP 在 24 小时内调用 API 次数超过限制，处理办法是停止调用 24 小时后再试。

Renewlet 部署在 Cloudflare Workers 后，Server酱请求由 Worker 发出；Server酱统计的是 Worker 出站到 Server酱时的来源 IP。真正原因就是这个 Cloudflare 出站来源 IP 触发了 Server酱的 24 小时限流，不是 Renewlet 的通知参数格式错误。

处理办法：

- 立刻停止连续测试，等 24 小时后再试。
- 急用通知时，先切到 SMTP、Telegram、Bark 或 Webhook。
- Renewlet 会按 SendKey 自动选择入口：`sctp...` 会发到 [Server酱³ 官方 API 入口](https://doc2.ft07.com/zh/serverchan3/server/api) `https://<uid>.push.ft07.com/send/<sendkey>.send`；`SCT...` 会发到 Server酱 Turbo 的 `https://sctapi.ftqq.com/<sendkey>.send`。如果你填的是 `sctp...` SendKey，这里已经不是 [SCT 转发](https://doc2.ft07.com/zh/serverchan3/compatibility/sct-forward)入口；继续返回 429，原因仍是 Server酱对 Cloudflare 出站来源 IP 的 24 小时限流。

**旧 `pb_data`？**

走单独导出/导入流程。
