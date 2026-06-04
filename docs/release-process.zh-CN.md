# 发布流程

Renewlet 使用 tag 驱动发布。`dev` 是日常集成分支，`main` 是最新稳定版分支，Release、镜像和 Cloudflare 生产部署只从发布 tag 产生。Actions 页面只保留少量入口，降低维护者和 fork 用户的心智负担。

## Workflow 入口

- `CI`：公开质量门，不需要 secrets，fork 和 PR 都能运行。
- `Build Smoke`：公开构建冒烟，不需要 secrets，只验证 Docker build 和 Cloudflare build，不推镜像、不部署。
- `Cloudflare Worker`：fork 用户或维护者测试环境的自管 Worker 部署。缺少 Cloudflare secrets 时只跳过远端部署；配置 secrets 后才执行 D1 migration 和 Worker deploy。
- `Docker Hub Overview`：官方 Docker Hub 页面元数据的手动同步入口，不构建也不推送镜像。
- `Maintainer Release`：维护者唯一手动发布入口，通过 `action=prepare|rc|promote` 控制阶段。
- `Release Publish`：tag 驱动的官方发布入口，响应 `v*.*.*` tag，负责 Docker/GitHub Release/生产 Cloudflare 审批链路。

官方 Docker 发布和生产 Cloudflare 部署都收在 `Release Publish` 内部，不再暴露额外手动 workflow。

## Docker Hub Overview

Docker Hub 不会因为 `docker push` 自动填充仓库 Overview，也不会像 GitHub 一样解析 README 里的仓库相对链接。`Release Publish` 会在官方镜像推送成功后，从 `README.md` 生成一份 Docker Hub 专用 README，把文档链接和图片资源改成 GitHub/raw 绝对 URL，再同步 Docker Hub 的短描述和 Overview。

如果只需要刷新 Overview、不发布新的 RC 或稳定镜像，运行手动 `Docker Hub Overview` workflow。该入口复用同一个生成脚本，只更新 Docker Hub 仓库元数据，不构建、不打 tag、不推镜像、不部署。

发布 RC 或稳定版 tag 前，确保仓库 secrets `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN` 已配置。该 token 必须能推送 `zhiyingzzhou/renewlet` 并更新仓库元数据，因为同一个 release job 同时负责镜像上传和 Overview 同步。

## 分支

- `dev`：日常集成分支，功能和修复 PR 默认合入这里。
- `release/vX.Y.Z`：从 `dev` 拉出的发布稳定分支。
- `main`：稳定版分支，只接收 release PR 和 hotfix PR。
- `hotfix/vX.Y.Z`：从 `main` 拉出的紧急修复分支，修完后回灌到 `dev`。

PR 标题和 commit 使用 Conventional Commits。示例：`feat: add notification channel`、`fix: prevent duplicate reminder jobs`、`docs: clarify Docker upgrade`。

## Release Bot GitHub App

发布 workflow 使用专门的 GitHub App token，不使用默认 `GITHUB_TOKEN` 创建 PR 或推发布 tag。这个做法和 n8n、Immich 这类成熟发布流程一致，可以避开仓库级 `GITHUB_TOKEN` 创建 PR 和触发后续 CI 的权限限制。

创建名为 `renewlet-release-bot` 的 GitHub App，关闭 webhook，只安装到 `zhiyingzzhou/renewlet` 仓库。给 App 授予以下 repository 权限：

- Contents：read and write
- Pull requests：read and write
- Workflows：read and write

运行 `Maintainer Release` 前，在仓库里配置：

- Variable `RENEWLET_RELEASE_APP_CLIENT_ID`：GitHub App 的 Client ID。
- Secret `RENEWLET_RELEASE_APP_PRIVATE_KEY`：App 生成的完整 private key PEM。

任一配置缺失时，`Maintainer Release` 会在开头直接失败并提示配置项。已经存在的 `release/vX.Y.Z` 分支不用删除；release bot 会更新分支，并在 RC 验证通过后创建或更新对应 PR。

## 准备发布

1. 确认 `dev` 的 CI 通过。
2. 运行 `Maintainer Release` workflow，`action` 选择 `prepare`。
3. 输入稳定版 SemVer，例如 `0.1.0`。
4. workflow 会同步 package 版本，并推送或更新 `release/v0.1.0`。
5. 编辑 `docs/release-notes/vX.Y.Z-zh.md` 作为 GitHub Release 正文；需要英文入口时再补 `docs/release-notes/vX.Y.Z-en.md`。发布脚本只追加 Docker 镜像标签和 GitHub compare 链接。
6. 发布期只在 `release/v0.1.0` 上做 release 修复。
7. 这一步不要创建 `main` PR；先发布并验证至少一个 RC。

## 发布候选版

1. 运行 `Maintainer Release` workflow，`action` 选择 `rc`。
2. 输入稳定版版本号，例如 `0.1.0`。
3. 输入 RC 编号，例如 `1`。
4. workflow 会用 release bot token 创建 `v0.1.0-rc.1` tag。
5. GitHub 只有在 tag 由 release bot token 推送时，才会启动 tag 驱动的 `Release Publish` workflow。默认 `GITHUB_TOKEN` 创建的 tag 不会触发后续 workflow。
   `Release Publish` 会在 softprops 创建 RC GitHub prerelease 前删除同 tag 残留 draft；旧 draft 否则可能让首次发布在 finalizing 时撞上 `tag_name already_exists`。
6. `Release Publish` 会构建并推送：
   - `zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `zhiyingzzhou/renewlet:rc`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `ghcr.io/zhiyingzzhou/renewlet:rc`
7. RC 是 GitHub prerelease，永远不会更新 `latest`，也不会部署 Cloudflare 生产环境。

## 验证并 Promote

1. 测试 RC Docker 镜像、GitHub prerelease 附件和 Cloudflare release build 输出。
2. 如果 RC 验证失败，继续修 `release/v0.1.0`，然后发布下一个 RC，例如 `v0.1.0-rc.2`。
3. RC 验证通过后，运行 `Maintainer Release` workflow，`action` 选择 `promote`。
4. 输入稳定版版本号，例如 `0.1.0`，以及已验证的 RC 编号，例如 `1`。
5. workflow 会检查 `v0.1.0-rc.1` 是否存在，然后创建或更新指向 `main` 的 `release/v0.1.0` PR。

## Cloudflare 测试部署

Cloudflare 测试部署使用 `Cloudflare Worker` workflow。它会在 `dev` 或 `main` push 时运行，也可以在 GitHub Actions 页面手动启动。这个 workflow 面向测试环境或用户自管 Worker 环境，和正式版发布的生产审批门分开。

如果 fork 用户没有配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`WORKER_NAME`、`D1_DATABASE_ID`、`R2_BUCKET_NAME`，workflow 会完成 check/build 后跳过远端部署并给出 notice；配置齐全后才会生成 Wrangler 配置、执行 D1 migration、部署 Worker。

## 发布稳定版

1. 把 promote 后的 release PR 合入 `main`。
2. 从 `main` 创建并推送稳定版 annotated tag：

```bash
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "Renewlet v0.1.0"
git push origin v0.1.0
```

3. `Release Publish` 会构建 Docker 镜像、创建 draft GitHub Release，并附加 `renewlet-docker-v0.1.0.zip`、`renewlet_0.1.0_linux_amd64.tar.gz`、`renewlet_0.1.0_linux_arm64.tar.gz` 和 `checksums.txt`。
4. 稳定版推送：
   - `zhiyingzzhou/renewlet:0.1.0`
   - `zhiyingzzhou/renewlet:0.1`
   - `zhiyingzzhou/renewlet:latest`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1`
   - `ghcr.io/zhiyingzzhou/renewlet:latest`
5. 检查 draft Release 的镜像列表和 Full Changelog compare 链接后，手动发布 Release。
6. 如果本次稳定版需要部署 Cloudflare 生产 Worker，审批 `production-cloudflare` environment。稳定版发布使用 `Release Publish` 内部的生产部署 job，不使用 `Cloudflare Worker` 测试部署 workflow。

## Docker 页面内更新

- `/renewlet` 是稳定 Docker 入口和 healthcheck 路径，后续版本不要删除。
- 真实自更新目标是 `/opt/renewlet/current/renewlet`；更新器永远不替换 `/renewlet`。
- 使用旧布局镜像的用户仍需先执行一次 `docker compose pull && docker compose up -d`。完成桥接后，后续稳定版可点击页面顶部版本号入口，打开“系统更新”执行更新。
- Release 二进制包必须提供 Linux `amd64` 和 `arm64` tarball，命名为 `renewlet_<version>_linux_<arch>.tar.gz`，并在 `checksums.txt` 写入对应 SHA-256。
- `/api/app/admin/system/version` 使用 `deployment` 表达 `docker`、`cloudflare` 或 `source` 部署形态，使用 `updateMode` 表达 `in-app-binary`、`docker-compose`、`cloudflare-deploy` 或 `source-manual` 升级路径。`updateSupported` 只表示管理员弹窗能否执行页面内二进制更新。
- 自更新通道由当前运行版本号决定：稳定版只检查 stable Release，`x.y.z-rc.N` 只检查合法 prerelease RC，并允许从较低 RC 更新到更高 RC。当前通道没有更高合法目标时，版本检查仍视为成功，并展示已是最新版本。
- 新布局的 Docker release 镜像返回 `deployment=docker`、`updateMode=in-app-binary`、`updateSupported=true`。禁用自更新、旧 bridge 布局和非 release 构建必须返回对应手动模式，并只给出一条明确不支持原因。
- Cloudflare 构建返回 `deployment=cloudflare`、`updateMode=cloudflare-deploy`、`updateSupported=false`；`checkSucceeded=true` 只表示 Worker 已读到构建元数据和部署升级能力，不代表做过 GitHub latest Release 检查。自管分支部署显示 `packageVersion-dev+shortSha` 和提交链接，官方稳定生产部署显示 tag 版本和发布页信息，不允许暴露可执行更新路径。

## 热修复

1. 从 `main` 拉出 `hotfix/vX.Y.Z`。
2. 做最小安全修复。
3. 开 PR 合入 `main`。
4. 合并后打 `vX.Y.Z` tag，让 `Release Publish` 创建发布。
5. 把 hotfix merge 或 cherry-pick 回 `dev`。

## 手动检查

稳定版发布前运行或确认以下检查：

```bash
pnpm check:file-lines
pnpm check:deploy
pnpm --filter @renewlet/client lint
pnpm --filter @renewlet/client i18n:check
pnpm --filter @renewlet/client test:run
pnpm --dir packages/server test
pnpm typecheck
pnpm check:cloudflare
pnpm build:cloudflare
docker build --pull --no-cache -t renewlet:release-smoke .
```

生产用户应固定具体镜像标签。`latest` 只随稳定版移动；RC 标签只用于发布前验证。
