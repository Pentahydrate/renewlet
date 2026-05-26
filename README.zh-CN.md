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
- 六种通知渠道：Telegram、Notifyx、Webhook、企业微信机器人、SMTP 邮件和 Bark。
- 多币种换算：可选择 Exchange API 或 FloatRates JSON Feeds，远端不可用时会使用备用汇率。
- 可自定义清单：分类、付款方式、货币都能在设置里调整，内置常见付款方式图标。
- 单容器自托管：React 前端、Go/PocketBase 后端、SQLite 数据和静态资源一起运行，数据持久化到 `data/`。
- 可部署到 Cloudflare Workers：React 静态资源、Worker API、D1、R2 和 Cron Triggers 可以在无 Go/PocketBase 服务器的环境运行。
- H5 移动端友好：移动端底部导航、订阅卡片、标签筛选抽屉和设置页面都按小屏幕适配。
- 中英文界面：应用内支持简体中文和 English。

## Cloudflare Workers 部署

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

[Cloudflare Workers 部署](docs/cloudflare-workers-deploy.zh-CN.md)

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

`latest` 只会在稳定版 GitHub Release 发布后移动。生产环境优先使用 `0.1.0` 这类具体版本标签；候选版使用 `0.1.0-rc.1` 这类标签，永远不会更新 `latest`。

### 升级

升级前先备份数据和配置：

```bash
tar -czf renewlet-backup-$(date +%F).tgz .env docker-compose.yml data
```

如果当前容器还没有页面内更新能力，先用 Docker 手动桥接升级一次：

```bash
sed -i.bak 's#RENEWLET_IMAGE=.*#RENEWLET_IMAGE="zhiyingzzhou/renewlet:0.1.0"#' .env
docker compose pull
docker compose up -d
docker compose logs -f
```

完成这次桥接后，管理员可以点击 Header 里的版本徽标，在弹窗里对后续稳定版执行 **立即更新**。Docker 会继续保留 `/renewlet` 作为稳定入口和 healthcheck 路径；自更新只替换容器内的 `/opt/renewlet/current/renewlet`。

Cloudflare 部署只显示版本和发布页链接，不提供页面内一键更新；请通过 Cloudflare 部署 workflow 或同步 fork 升级。

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
