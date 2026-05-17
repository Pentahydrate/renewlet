# Renewlet

[简体中文](README.md) | [English](README.en.md)

Renewlet is a self-hosted subscription manager. It keeps prices, renewal dates, budgets, and reminders for SaaS, AI tools, cloud services, and developer tools in one place, for individuals, small teams, and homelabs.

<p align="center">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-0f172a?style=flat-square">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square">
  <img alt="Go and PocketBase" src="https://img.shields.io/badge/Go%20%2B%20PocketBase-00a884?style=flat-square">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square">
</p>

<p align="center">
  <img src="./docs/screenshots/renewlet-dashboard-en.png" alt="Renewlet dashboard showing 100 developer subscriptions, monthly spend, upcoming renewals, and spending distribution" width="100%">
</p>

<p align="center">
  <sub>Screenshots use 100 real developer-service public-pricing demo subscriptions (price snapshot: 2026-05-18). Actual prices may change by official pricing page, region, tax, and billing term.</sub>
</p>

<p align="center"><strong>Subscription grid</strong></p>

<p align="center">
  <img src="./docs/screenshots/renewlet-subscriptions-en.png" alt="Renewlet subscriptions grid with filters, tags, renewal status, and service logos" width="100%">
</p>

<p align="center"><strong>Statistics</strong></p>

<p align="center">
  <img src="./docs/screenshots/renewlet-statistics-en.png" alt="Renewlet statistics view with budget usage, category breakdown, and payment method charts" width="100%">
</p>

<p align="center"><strong>Renewal calendar</strong></p>

<p align="center">
  <img src="./docs/screenshots/renewlet-calendar-en.png" alt="Renewlet renewal calendar showing monthly renewal events and estimated spend for developer subscriptions" width="100%">
</p>

<p align="center"><strong>Notification methods</strong></p>

<p align="center">
  <img src="./docs/screenshots/renewlet-notifications-en.png" alt="Renewlet notification settings showing channel list and email notification configuration" width="100%">
</p>

## Overview

If you subscribe to many tools, Renewlet helps you keep track of them: when each one renews, roughly how much you spend each month, what is coming up soon, and where reminders should go. You can save prices, currencies, billing cycles, renewal dates, payment methods, tags, websites, and notes, then use the dashboard, calendar, and statistics pages to understand the overall spend.

The project packages the React frontend and Go/PocketBase backend into one Docker image. After deployment, a single container serves the app, business APIs, PocketBase APIs, and the PocketBase Admin UI.

Current architecture:

- `packages/server`: Go + PocketBase backend for SQLite, authentication, files, admin UI, data models, and business APIs.
- `packages/client`: Vite + React SPA for the app UI, routing, themes, and Chinese/English copy.
- Docker image: runs one Go binary that serves the PocketBase API, app API, PocketBase Admin, static assets, and SPA fallback.

## Features

- Track subscriptions: save names, logos, prices, currencies, billing cycles, statuses, categories, payment methods, websites, tags, and notes.
- Get renewal reminders: generate notifications from each user's time zone and reminder window, keep delivery history, and retry failed sends.
- Send notifications: use Telegram, Notifyx, Webhook, WeCom Bot, SMTP email, or Bark.
- Review spending: normalize costs by month and show budget usage, category breakdowns, payment-method breakdowns, and inactive-subscription savings.
- Handle currencies: choose Exchange API or FloatRates JSON Feeds for exchange rates; if remote sources fail, Renewlet uses fallback rates.
- Self-host it: run one container and persist SQLite data through a local directory or Docker volume.
- Switch languages: Simplified Chinese and English are supported in the app.

## Resource Usage

After starting the Docker Hub `latest` image locally and opening `/setup`, `docker stats --no-stream` reported about `15MiB` of memory in use.

This is a single measurement on an idle install with no data. Actual usage depends on subscription count, notification jobs, automatic backups, the host platform, and Docker's accounting. The default deployment already sets a Go runtime soft memory limit; on low-memory machines, start with the defaults and adjust after observing your own workload.

## One-Command Docker Deployment

The easiest path is the prebuilt Docker Hub image. The script below downloads the Compose template, generates random secrets, and creates the local data directory. For most installs, you do not need to edit `.env` or `docker-compose.yml` by hand.

On a server with Docker and Docker Compose v2 installed, run:

```bash
mkdir -p renewlet && cd renewlet
curl -fsSL https://raw.githubusercontent.com/zhiyingzzhou/renewlet/main/deploy/docker-deploy.sh | bash
docker compose up -d
```

After the first startup, open:

```text
http://localhost:3000/setup
```

Create the first admin user. If PocketBase does not have a superuser yet, this account also becomes the initial PocketBase Admin UI account. Existing superusers are not overwritten.

The script creates:

| Path | Description |
| --- | --- |
| `docker-compose.yml` | Production deployment template. It uses `zhiyingzzhou/renewlet:latest` by default. |
| `.env` | Port, image, time zone, secrets, and notification scheduler settings. `PB_ENCRYPTION_KEY` and `CRON_SECRET` are generated automatically. |
| `data/` | Data directory mounted to `/pb_data` inside the container. |

If Docker Hub is unavailable, switch `.env` to the GHCR image:

```env
RENEWLET_IMAGE="ghcr.io/zhiyingzzhou/renewlet:latest"
```

Then pull and restart:

```bash
docker compose pull
docker compose up -d
```

## Operations

Check status and logs:

```bash
docker compose ps
docker compose logs -f
```

Before upgrading, back up data and configuration:

```bash
tar -czf renewlet-backup-$(date +%F).tgz .env docker-compose.yml data
```

Upgrade to the latest image:

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

Restart the service:

```bash
docker compose restart
```

To migrate to another machine, extract the backup and start the service:

```bash
mkdir -p renewlet && cd renewlet
tar -xzf /path/to/renewlet-backup.tgz
docker compose up -d
```

Stop the service while keeping data:

```bash
docker compose down
```

Full removal deletes local data, so back up first:

```bash
docker compose down
rm -rf data .env docker-compose.yml
```

## Configuration

For the one-command deployment, all settings live in `.env`. Defaults are fine for a normal install. If you use a reverse proxy and domain, set `APP_URL` to your public HTTPS URL, for example `https://renewlet.example.com`.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Public service port. |
| `RENEWLET_IMAGE` | `zhiyingzzhou/renewlet:latest` | Docker image. `latest` follows the newest release; in production you can pin `zhiyingzzhou/renewlet:vX.Y.Z` or switch to `ghcr.io/zhiyingzzhou/renewlet:latest`. |
| `APP_URL` | `http://localhost:3000` | Public app URL used to build links in emails and notifications. |
| `TZ` | `Asia/Shanghai` | Container time zone, mainly for logs. Reminder time follows each user's in-app setting. |
| `PB_ENCRYPTION_KEY` | generated | Must be exactly 32 characters. It encrypts sensitive PocketBase settings. Do not rotate it casually after deployment. |
| `GOMEMLIMIT` / `MEM_LIMIT` | `128MiB` / `256m` | Go runtime soft memory limit and container memory limit. |
| `SMTP_HOST` / `SMTP_FROM` | empty | Enables PocketBase password-reset email when configured. |
| `BACKUPS_CRON` | empty | Optional PocketBase backup cron expression. |
| `NOTIFICATION_SCHEDULER_ENABLED` | `true` | Enables the built-in notification scheduler. |
| `CRON_SECRET` | generated | Bearer secret for external platform Cron calls to `/api/cron/notifications`. |
| `NOTIFICATION_SCHEDULER_CRON` | `* * * * *` | Cron expression for the notification scheduler. |
| `NOTIFICATION_MAX_RETRIES` | `3` | Maximum retry count for failed notification jobs. |

## Scheduled Notifications

For Docker/VPS self-hosting, keep `NOTIFICATION_SCHEDULER_ENABLED=true`. The app checks all user settings on `NOTIFICATION_SCHEDULER_CRON` and sends reminders only when a user's IANA time zone and local notification time match the delivery window.

If your platform provides Cron, or you want to use GitHub Actions, host crontab, or another external scheduler, disable the built-in scheduler and configure an external entrypoint secret:

```env
NOTIFICATION_SCHEDULER_ENABLED="false"
CRON_SECRET="CHANGE_ME_TO_A_RANDOM_SECRET"
```

The external entrypoint is `GET /api/cron/notifications`. It only accepts `Authorization: Bearer <CRON_SECRET>` and does not support URL query secrets. Vercel Cron sends the Bearer header automatically when `CRON_SECRET` is configured; GitHub Actions or crontab can call it like this:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_DOMAIN/api/cron/notifications"
```

For debugging, add `dryRun=1` to run the logic without sending notifications, or add `force=1` to force the schedule window:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_DOMAIN/api/cron/notifications?dryRun=1&force=1"
```

## Source Build Deployment

If you want to build the image from source instead of using the Docker Hub image:

```bash
git clone https://github.com/zhiyingzzhou/renewlet.git
cd renewlet
cp .env.example .env
docker compose up -d --build
```

The root `docker-compose.yml` is for source builds and persists `/pb_data` with the Docker named volume `renewlet-pb-data`. The one-command deployment uses `deploy/docker-compose.yml` and stores data in the local `data/` directory by default.

## Local Development

Install dependencies:

```bash
pnpm install
```

Start the backend:

```bash
pnpm --dir packages/server start
```

Start the frontend:

```bash
pnpm --filter @renewlet/client dev
```

Vite runs at `http://localhost:5173` by default and proxies `/api` and `/_` to the Go server: `http://127.0.0.1:3000`.

## Build

```bash
pnpm build
```

The build first generates `packages/client/dist`, syncs the static assets into the server directory, and then compiles `packages/server/dist/renewlet`.

## Image Publishing

When maintainers publish a version, GitHub Actions builds multi-platform images and pushes them to:

- `docker.io/zhiyingzzhou/renewlet`
- `ghcr.io/zhiyingzzhou/renewlet`

The workflow runs on pushes to `main`, `v*.*.*` tags, and manual `Docker Image` workflow runs.

Before the first Docker Hub publish:

1. Create the public Docker Hub repository `zhiyingzzhou/renewlet`.
2. Create a Docker Hub Access Token.
3. Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` in GitHub `Settings -> Secrets and variables -> Actions`.

Publish a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI pushes tags such as `latest`, `v0.1.0`, `0.1.0`, `0.1`, and `sha-*`.

References: [sub2api deployment README](https://github.com/Wei-Shaw/sub2api/blob/main/deploy/README.md), [Docker GitHub Actions guide](https://docs.docker.com/guides/gha/), [Docker multi-platform builds](https://docs.docker.com/build/ci/github-actions/multi-platform/), and [GitHub publish Docker images](https://docs.github.com/actions/tutorials/publish-packages/publish-docker-images).

## Verification

Common checks:

```bash
pnpm --filter @renewlet/client typecheck
pnpm --filter @renewlet/client build
pnpm --dir packages/server test
pnpm build
```

Full check:

```bash
pnpm test:all
```

## Contributing

Issues, documentation improvements, tests, and pull requests are welcome. Before submitting changes, please run the relevant checks and keep documentation, tests, and implementation aligned.

For larger features, please open an issue first with the goal, use case, and rough approach so the direction can be discussed before implementation.

## Friendly Links

- [LINUX DO](https://linux.do/): Renewlet recognizes and appreciates the LINUX DO community's support for open source project discussions.

## License

Renewlet is open source under the [MIT License](LICENSE).
