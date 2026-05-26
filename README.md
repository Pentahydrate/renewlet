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
  <img alt="Mobile web ready" src="https://img.shields.io/badge/mobile%20web-ready-2563eb?style=flat-square">
  <img alt="Memory 20-30MiB" src="https://img.shields.io/badge/memory-20--30MiB-10b981?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square">
</p>

Renewlet is a self-hosted subscription ledger that reminds you before renewals. Add a subscription or any recurring charge, set its renewal date and reminder days, and it will notify you through the channels you configure. You can also track price, currency, budget, logo, category, and payment method.

Mobile web is first-class: open it in a phone browser to add subscriptions, filter lists, review stats, and configure notifications.

Idle memory usage is around 20-30MiB in local testing, making it comfortable for small VPS, NAS, and homelab boxes.

<p align="center">
  <img src="./docs/screenshots/renewlet-dashboard-en.png" alt="Renewlet dashboard showing monthly spend, upcoming renewals, and spending distribution" width="100%">
</p>

## Highlights

- Track each subscription clearly: name, logo, price, currency, billing cycle, renewal date, status, category, payment method, tags, website, and notes.
- Understand spending: normalize costs by month and year, then review budget usage, category breakdowns, payment-method charts, and inactive-subscription savings.
- Get renewal reminders: jobs are generated from each user's IANA time zone and local notification time, with reminder days, repeat reminders, delivery history, and failed-send retries.
- Send notifications through six channels: Telegram, Notifyx, Webhook, WeCom Bot, SMTP email, and Bark.
- Handle multiple currencies: choose Exchange API or FloatRates JSON Feeds, with fallback rates when remote providers are unavailable.
- Customize your lists: categories, payment methods, and currencies can be adjusted in settings, with built-in icons for common payment methods.
- Self-host one container: React frontend, Go/PocketBase backend, SQLite data, and static assets run together, with data persisted to `data/`.
- Deploy to Cloudflare Workers: React static assets, Worker API, D1, R2, and Cron Triggers can run without the Go/PocketBase server.
- Mobile-web friendly: bottom navigation, subscription cards, tag-filter drawers, and settings screens are adapted for small screens.
- Switch languages in the app: Simplified Chinese and English are supported.

## Cloudflare Workers Deploy

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

[Cloudflare Workers Deploy](docs/cloudflare-workers-deploy.md)

## Quick Deploy

On a machine with Docker and Docker Compose v2:

```bash
mkdir -p renewlet && cd renewlet
curl -fsSL https://raw.githubusercontent.com/zhiyingzzhou/renewlet/main/deploy/docker-deploy.sh | bash
docker compose up -d
```

Then open:

```text
http://localhost:3000/setup
```

Create the first admin user. The deploy script creates `docker-compose.yml`, `.env`, and `data/`, then generates `PB_ENCRYPTION_KEY` and `CRON_SECRET` for you.

If Docker Hub is unavailable, switch the image in `.env` to GHCR:

```env
RENEWLET_IMAGE="ghcr.io/zhiyingzzhou/renewlet:latest"
```

Then pin a released version when you use Renewlet in production, pull, and restart:

```bash
sed -i.bak 's#RENEWLET_IMAGE=.*#RENEWLET_IMAGE="ghcr.io/zhiyingzzhou/renewlet:0.1.0"#' .env
docker compose pull
docker compose up -d
```

`latest` only moves on stable GitHub Releases. For production, prefer a concrete version tag such as `0.1.0`; release candidates use tags like `0.1.0-rc.1` and never update `latest`.

### Upgrade

Back up data and config before upgrading:

```bash
tar -czf renewlet-backup-$(date +%F).tgz .env docker-compose.yml data
```

If your current container predates the in-app updater, upgrade once with Docker:

```bash
sed -i.bak 's#RENEWLET_IMAGE=.*#RENEWLET_IMAGE="zhiyingzzhou/renewlet:0.1.0"#' .env
docker compose pull
docker compose up -d
docker compose logs -f
```

After that bridge upgrade, admins can open the version badge in the header and click **Update now** for later stable releases. Docker keeps `/renewlet` as the stable entrypoint and healthcheck path; the updater only replaces `/opt/renewlet/current/renewlet` inside the container.

Cloudflare deployments show the version and release link only. Upgrade them through the Cloudflare deployment workflow or by syncing your fork.

### Common commands

Check status and logs:

```bash
docker compose ps
docker compose logs -f
```

Stop the service while keeping data:

```bash
docker compose down
```

Common settings live in `.env`:

| Variable | Purpose |
| --- | --- |
| `PORT` | Public port, `3000` by default. |
| `RENEWLET_IMAGE` | Docker image, `zhiyingzzhou/renewlet:latest` by default. |
| `TZ` | Container time zone, mainly for logs; reminders use each user's time zone. |
| `PB_ENCRYPTION_KEY` | Encryption key for sensitive PocketBase settings. Do not rotate it casually after deployment. |
| `CRON_SECRET` | Bearer secret for external Cron calls to `/api/cron/notifications`. |
| `NOTIFICATION_SCHEDULER_ENABLED` | Enables the built-in notification scheduler. Defaults to `true`. |

The full Docker environment template is in `.env.example`.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <strong>Subscriptions</strong><br>
      <img src="./docs/screenshots/renewlet-subscriptions-en.png" alt="Renewlet subscriptions view with filters, tags, statuses, and service logos">
    </td>
    <td width="50%">
      <strong>Statistics</strong><br>
      <img src="./docs/screenshots/renewlet-statistics-en.png" alt="Renewlet statistics view with budget usage, category spending, and payment method charts">
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Renewal Calendar</strong><br>
      <img src="./docs/screenshots/renewlet-calendar-en.png" alt="Renewlet renewal calendar showing monthly renewal events and estimated spend">
    </td>
    <td width="50%">
      <strong>Notifications</strong><br>
      <img src="./docs/screenshots/renewlet-notifications-en.png" alt="Renewlet notification settings showing channels and email configuration">
    </td>
  </tr>
</table>

### Mobile

<table>
  <tr>
    <td width="50%">
      <strong>Mobile subscriptions</strong><br>
      <img src="./docs/screenshots/renewlet-subscriptions-h5-en.png" alt="Renewlet mobile subscriptions view with filters, subscription cards, logos, prices, and tags">
    </td>
    <td width="50%">
      <strong>Mobile notification methods</strong><br>
      <img src="./docs/screenshots/renewlet-notifications-h5-en.png" alt="Renewlet mobile notification methods view showing the email channel and SMTP email configuration">
    </td>
  </tr>
</table>

## Contributing

Issues, docs improvements, tests, and pull requests are welcome. For larger changes, please open an issue first with the goal, use case, and rough approach so the direction can be aligned before implementation.

## Acknowledgements

- [LINUX DO](https://linux.do/): Renewlet recognizes and thanks the LINUX DO community for supporting open-source project discussion.

## License

Renewlet is open-sourced under the [MIT License](LICENSE).
