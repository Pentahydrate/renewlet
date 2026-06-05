# Renewlet

<p align="center">
  <img src="./packages/client/public/logo.svg" alt="Renewlet" width="320">
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.md">English</a>
</p>

<p align="center">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-0f172a?style=flat-square">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square">
  <img alt="Go and PocketBase" src="https://img.shields.io/badge/Go%20%2B%20PocketBase-00a884?style=flat-square">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare%20Workers-ready-f38020?style=flat-square">
  <img alt="H5 mobile ready" src="https://img.shields.io/badge/H5-mobile--ready-2563eb?style=flat-square">
  <img alt="Memory 20-30MiB" src="https://img.shields.io/badge/memory-20--30MiB-10b981?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square">
</p>

Renewlet 是一个会在续费前提醒你的自托管订阅账本。添加订阅或其他周期性扣费，填好续费日和提前提醒天数，它就会通过你配置的渠道通知你。价格、币种、预算、Logo、分类和付款方式也可以一起记录。

H5 移动端完整适配，手机浏览器打开就能录入订阅、筛选列表、看统计和配置通知。

实测空闲内存约 20-30MiB，适合小 VPS、NAS 和 homelab 常驻运行。

<p align="center">
  <img src="./docs/screenshots/renewlet-dashboard-zh.png" alt="Renewlet 中文仪表盘，展示月度支出、近期续费和支出分布" width="100%">
</p>

## 功能亮点

- 清楚记录每个订阅：名称、Logo、价格、币种、扣费周期、续费日、状态、分类、付款方式、标签、网站和备注。
- 看懂支出结构：按月和按年折算成本，展示预算使用、分类占比、付款方式占比和停用订阅节省。
- 续费前提醒：按用户自己的 IANA 时区和本地提醒时间生成任务，支持提前天数、重复提醒、发送历史和失败重试。
- 日历应用订阅：可在设置里生成全局私有 ICS Feed URL，也可从订阅卡片或日历详情弹窗为单个订阅生成独立 Feed 并唤起系统日历订阅。
- 七种通知渠道：Telegram、Notifyx、Webhook、企业微信机器人、SMTP 邮件、Bark 和 Server酱。
- 订阅 Logo 可控：上传 Logo、填写图片链接、搜索内置图标来源，也可以使用 favicon 候选。
- 多币种换算：可选择 Exchange API 或 FloatRates JSON Feeds，远端不可用时会使用备用汇率。
- 订阅数据可迁移：从 Renewlet 导出，导入 Renewlet 或 Wallos 文件，预览映射结果后再写入。
- 可自定义清单：分类、状态、付款方式和货币都能在设置里调整，内置常见付款方式图标。
- 界面和账号设置：应用内切换语言、浅色/深色/跟随系统主题、主题色，并管理账号密码。
- 单容器自托管：React 前端、Go/PocketBase 后端、SQLite 数据和静态资源一起运行，数据持久化到 `data/`。
- 可部署到 Cloudflare Workers：React 静态资源、Worker API、D1、R2 和 Cron Triggers 可以在无 Go/PocketBase 服务器的环境运行。
- H5 移动端友好：移动端底部导航、订阅卡片、标签筛选抽屉和设置页面都按小屏幕适配。

## Cloudflare Workers 部署

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

推荐直接点击按钮，按 Cloudflare 向导完成部署。

需要自己创建 Cloudflare 资源或通过 GitHub Actions 部署时，查看 [Cloudflare Workers 手动部署](docs/cloudflare-workers-deploy.zh-CN.md)。

## 快速部署

准备一台已安装 Docker 和 Docker Compose v2 的机器：

```bash
mkdir -p renewlet && cd renewlet
curl -fsSL https://raw.githubusercontent.com/zhiyingzzhou/renewlet/main/deploy/docker-deploy.sh | bash
docker compose up -d
```

启动后打开：

```text
http://localhost:3000/setup
```

创建第一个管理员用户。部署脚本会生成 `docker-compose.yml`、`.env` 和 `data/`，并自动写入 `PB_ENCRYPTION_KEY` 与 `CRON_SECRET`。

如果 Docker Hub 拉取不可用，把 `.env` 里的镜像切到 GHCR：

```env
RENEWLET_IMAGE="ghcr.io/zhiyingzzhou/renewlet:latest"
```

生产环境建议固定到具体发布版本，然后重新拉取并启动：

```bash
sed -i.bak 's#RENEWLET_IMAGE=.*#RENEWLET_IMAGE="ghcr.io/zhiyingzzhou/renewlet:0.1.0"#' .env
docker compose pull
docker compose up -d
```

生产环境建议使用 `0.1.0` 这类具体稳定版本标签。

### 升级

升级前先备份数据和配置：

如果你是在 2026-06-04 之前部署的 Renewlet，升级前请先打开旧版本的订阅页，使用“导出订阅”里的 JSON 导出功能保存 `subscriptions.json`。升级后可通过“导入数据”导入这份旧版 JSON。这个文件只用于订阅数据迁移，仍建议同时保留下面的 `.env`、`docker-compose.yml` 和 `data/` 备份。

```bash
tar -czf renewlet-backup-$(date +%F).tgz .env docker-compose.yml data
```

使用 Docker Compose 更新到指定版本：

```bash
sed -i.bak 's#RENEWLET_IMAGE=.*#RENEWLET_IMAGE="zhiyingzzhou/renewlet:0.1.0"#' .env
docker compose pull
docker compose up -d
docker compose logs -f
```

使用当前二进制布局的官方 Docker release 镜像，也可以点击 Renewlet 页面顶部的版本号入口，打开“系统更新”执行更新。页面内更新会下载 GitHub Release 二进制、校验 `checksums.txt`、替换运行二进制，然后由管理员点击 **立即重启** 应用更新。旧布局镜像需要先执行一次 `docker compose pull && docker compose up -d`，之后才会开放页面内更新。

Cloudflare 部署升级：打开你的 fork，点击 `Sync fork` / `Update branch`，等待重新部署；没有自动运行时再手动运行 `Cloudflare Worker`。部署路径必须保持先执行 D1 migrations，再发布 Worker。

### 常用命令

查看状态和日志：

```bash
docker compose ps
docker compose logs -f
```

停止服务但保留数据：

```bash
docker compose down
```

常用配置都在 `.env`：

| 变量 | 用途 |
| --- | --- |
| `PORT` | 对外端口，默认 `3000`。 |
| `RENEWLET_IMAGE` | Docker 镜像，默认 `zhiyingzzhou/renewlet:latest`。 |
| `TZ` | 容器时区，主要影响日志；提醒时间按用户设置的时区计算。 |
| `PB_ENCRYPTION_KEY` | PocketBase 敏感设置加密密钥，部署后不要随意更换。 |
| `CRON_SECRET` | 外部 Cron 调用 `/api/cron/notifications` 时使用的 Bearer 密钥。 |
| `NOTIFICATION_SCHEDULER_ENABLED` | 是否启用内置通知调度器，默认 `true`。 |

完整 Docker 环境变量模板见 `.env.example`。

## 截图

<table>
  <tr>
    <td width="50%">
      <strong>订阅清单</strong><br>
      <img src="./docs/screenshots/renewlet-subscriptions-zh.png" alt="Renewlet 中文订阅清单，展示筛选、标签、状态和服务 Logo">
    </td>
    <td width="50%">
      <strong>统计分析</strong><br>
      <img src="./docs/screenshots/renewlet-statistics-zh.png" alt="Renewlet 中文统计页面，展示预算、分类支出和付款方式图表">
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>续费日历</strong><br>
      <img src="./docs/screenshots/renewlet-calendar-zh.png" alt="Renewlet 中文续费日历，展示月度续费事件和预计支出">
    </td>
    <td width="50%">
      <strong>通知设置</strong><br>
      <img src="./docs/screenshots/renewlet-notifications-zh.png" alt="Renewlet 中文通知设置，展示通知渠道和邮件配置">
    </td>
  </tr>
</table>

### H5 移动端

<table>
  <tr>
    <td width="50%">
      <strong>移动端订阅列表</strong><br>
      <img src="./docs/screenshots/renewlet-subscriptions-h5-zh.png" alt="Renewlet 中文 H5 订阅列表，展示移动端筛选区、订阅卡片、Logo、价格和标签">
    </td>
    <td width="50%">
      <strong>移动端通知方式</strong><br>
      <img src="./docs/screenshots/renewlet-notifications-h5-zh.png" alt="Renewlet 中文 H5 通知方式，展示邮件通知渠道和 SMTP 邮件配置">
    </td>
  </tr>
</table>

## 贡献

欢迎提交 issue、改进文档、补充测试或发起 pull request。较大的功能建议先开 issue 说明目标、使用场景和大致方案，方便在实现前对齐方向。

## 友情链接

- [LINUX DO](https://linux.do/)：Renewlet 认可并感谢 LINUX DO 社区对开源项目交流的支持。

## 许可证

Renewlet 基于 [MIT License](LICENSE) 开源。
