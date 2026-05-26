# Cloudflare Workers Deploy

## One-Click Deploy

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

1. Click the button.
2. Finish the Cloudflare wizard.
3. Open:

```text
https://<worker-name>.<workers-dev-subdomain>.workers.dev/setup
```

## GitHub Actions Deploy

Manual Cloudflare resources and GitHub Secrets. Push to `dev` or run the workflow manually.

Workflow:

- Checks Cloudflare Worker and frontend types
- Builds the Cloudflare frontend
- If all 5 GitHub Secrets are configured, generates `wrangler.generated.jsonc` from Secrets
- If all 5 GitHub Secrets are configured, applies remote D1 migrations and deploys the Worker

If any required secret is missing, the workflow still runs the Cloudflare checks and build, then skips the remote D1 migration and Worker deployment with a GitHub Actions notice.

Add these 5 values to GitHub Secrets to enable remote deployment.

### 1. Fork The Repository

Fork the current repository to your own account or organization.

Repository name already exists: use the existing fork, or delete/rename the repository with the same name and fork again.

### 2. Create Cloudflare Resources

Create a D1 database and an R2 bucket in the Cloudflare dashboard.

D1:

1. In the Cloudflare dashboard, open `Storage & Databases` -> `D1 SQL Database`.
2. Click `Create Database`.

   <img src="./screenshots/cloudflare/en/cloudflare-d1-create.jpg" alt="Create D1 SQL database" width="720">

3. Enter `renewlet` as the database name.

   <img src="./screenshots/cloudflare/en/cloudflare-d1-create-setting.jpg" alt="Create D1 SQL database" width="720">

4. Open the created database and copy the database ID as `D1_DATABASE_ID`.

   <img src="./screenshots/cloudflare/en/cloudflare-d1-id.jpg" alt="Copy database ID" width="720">

R2:

1. In the Cloudflare dashboard, open `Storage & Databases` -> `R2 Object Storage`.

   <img src="./screenshots/cloudflare/en/cloudflare-r2-bucket-create.jpg" alt="Create R2 Object Storage" width="720">

2. Create a bucket named `renewlet-assets`.

   <img src="./screenshots/cloudflare/en/cloudflare-r2-bucket-create-setting.jpg" alt="Create R2 Object Storage" width="720">

3. Copy the bucket name as `R2_BUCKET_NAME`.

   <img src="./screenshots/cloudflare/en/cloudflare-r2-bucket-setting.jpg" alt="Copy bucket name" width="720">

Renewlet's Worker binding names are fixed:

| Binding | Cloudflare product | Purpose |
| --- | --- | --- |
| `DB` | D1 | Users, sessions, subscriptions, settings, notification jobs |
| `ASSETS_BUCKET` | R2 | Private uploaded logos/icons |

### 3. Get CLOUDFLARE_ACCOUNT_ID

Direct link: <a href="https://dash.cloudflare.com/?to=/:account/home" target="_blank" rel="noopener noreferrer">https://dash.cloudflare.com/?to=/:account/home</a>

1. Open the Cloudflare Dashboard.
2. Go to `Account home`.
3. Find the account used to deploy Renewlet.
4. Click the menu button on the right side of the account row.
5. Click `Copy account ID`.
6. Save the copied value as `CLOUDFLARE_ACCOUNT_ID`.

<img src="./screenshots/cloudflare/en/cloudflare-account-id.jpg" alt="Copy account ID" width="720">

You can also copy it from the `Workers & Pages` page: open `Workers & Pages`, then click the copy button for `Account ID` in `Account details`.

Direct link: <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages" target="_blank" rel="noopener noreferrer">https://dash.cloudflare.com/?to=/:account/workers-and-pages</a>

<img src="./screenshots/cloudflare/en/cloudflare-workers-account-id.jpg" alt="Copy account ID" width="720">

### 4. Create CLOUDFLARE_API_TOKEN

Direct link: <a href="https://dash.cloudflare.com/?to=/:account/api-tokens" target="_blank" rel="noopener noreferrer">https://dash.cloudflare.com/?to=/:account/api-tokens</a>

Permissions: `Edit Cloudflare Workers` + `Account` -> `D1` -> `Edit`. Scope resources to the account that deploys Renewlet; if you bind a custom domain, scope the zone to that domain.

1. Open the Cloudflare Dashboard.
2. Go to the `Account API tokens` page.
3. Click `Create Token`.

   <img src="./screenshots/cloudflare/en/cloudflare-api-token-list.jpg" alt="Account API tokens page" width="720">

4. Set Token name to `renewlet-worker-deploy`.
5. Under `Permission policies`, open the `Custom` dropdown and select `Edit Cloudflare Workers`.

   <img src="./screenshots/cloudflare/en/cloudflare-api-token-template.jpg" alt="Edit Cloudflare Workers" width="720">

6. Add one permission row: `Account` -> `D1` -> `Edit`.

   <img src="./screenshots/cloudflare/en/cloudflare-api-token-permissions-add-d1.jpg" alt="Add D1 Edit" width="720">

   <img src="./screenshots/cloudflare/en/cloudflare-api-token-permissions-d1.jpg" alt="Add D1 Edit" width="720">

7. Scroll down to `Resources`.
8. If the page shows `Account Resources`: select `Include` -> the Cloudflare account used to deploy Renewlet.
9. If the page shows `Zone Resources`: select the domain that will later be bound to a Worker route or custom domain.
10. If the page does not show a resources section, click `Continue to summary`.

    <img src="./screenshots/cloudflare/en/cloudflare-api-token-summary-review.jpg" alt="Review token" width="720">

11. Review Token name, Permission policies, and Resources. Skip Resources if the page does not show them.
12. Click `Create Token`.

    <img src="./screenshots/cloudflare/en/cloudflare-api-token-summary-create.jpg" alt="Create Token" width="720">

13. Copy the generated token and save it as `CLOUDFLARE_API_TOKEN`. **Save it immediately. The token is shown only once.**

    <img src="./screenshots/cloudflare/en/cloudflare-api-token-created.jpg" alt="Copy token" width="720">

    <img src="./screenshots/cloudflare/en/cloudflare-api-token-list-success.jpg" alt="Token list" width="720">

### 5. Configure GitHub Secrets

In your fork repository, open `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`, then add these 5 repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token used by GitHub Actions to deploy the Worker and apply remote D1 migrations |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID used to deploy Renewlet |
| `WORKER_NAME` | Worker name, for example `renewlet` or `renewlet-prod` |
| `D1_DATABASE_ID` | D1 database ID copied from the Cloudflare dashboard |
| `R2_BUCKET_NAME` | R2 bucket name, for example `renewlet-assets` |

<img src="./screenshots/cloudflare/github-actions-secrets.jpg" alt="New repository secret" width="720">

<img src="./screenshots/cloudflare/github-new-secret.jpg" alt="New repository secret" width="720">

<img src="./screenshots/cloudflare/github-secrets-complete.jpg" alt="New repository secret" width="720">

### 6. Run The Deployment

The workflow file is `.github/workflows/cloudflare-worker.yml`.

It runs automatically when you push to `dev`, and you can also run it manually from GitHub Actions:

The workflow needs all 5 repository secrets to deploy to Cloudflare. Without them, it only verifies the Cloudflare build path and does not change any remote D1 database or Worker.

1. Open your fork repository.
2. Go to `Actions`.
3. Select `Cloudflare Worker`.
4. Click `Run workflow`.

<img src="./screenshots/cloudflare/github-actions-workflow.jpg" alt="GitHub Actions workflow" width="720">

<img src="./screenshots/cloudflare/github-actions-run.jpg" alt="GitHub Actions run" width="720">

<img src="./screenshots/cloudflare/github-actions-success.jpg" alt="GitHub Actions success" width="720">

### 7. Open Renewlet

The default URL is:

```text
https://<WORKER_NAME>.<workers-dev-subdomain>.workers.dev/setup
```

<img src="./screenshots/cloudflare/en/cloudflare-worker-domain.jpg" alt="Custom domain" width="720">

Custom domain: after deployment, bind a Worker route or custom domain for the Worker in the Cloudflare dashboard.

<img src="./screenshots/cloudflare/en/cloudflare-worker-custom-domain.jpg" alt="Custom domain" width="720">

## Update Version

Workers deploy does not support Renewlet's Docker in-app updater. The admin version dialog only shows version information and the GitHub Release link.

Workers deploy supports two update modes:

### Automatic Update

Enable Upstream Sync Action. Upstream updates sync and deploy automatically.

### Manual Update

1. Sync upstream updates in the fork.
2. After sync, deployment runs automatically. You can also run `Cloudflare Worker` from Actions.

## Wrangler CLI

Create resources:

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create renewlet
pnpm exec wrangler r2 bucket create renewlet-assets
```

Export the real values and deploy:

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

## Local Development

Copy the local variables example:

```bash
cp .dev.vars.example .dev.vars
```

Start the local Worker:

```bash
pnpm check:cloudflare
pnpm build:cloudflare
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev --test-scheduled --ip 0.0.0.0
```

Open:

```text
http://localhost:8787/setup
http://<local LAN IP>:8787/setup
```

Production Cron uses `triggers.crons` in `wrangler.jsonc`.

Simulate a Cron Trigger locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
curl "http://<local LAN IP>:8787/__scheduled?cron=*+*+*+*+*"
```

`/__scheduled` requires `wrangler dev --test-scheduled`.

## Post-Deployment Check

First copy the check variable template, then fill in the deployed Worker domain and an independent test administrator account:

```bash
cp cloudflare-check.env.example cloudflare-check.env.local
```

Then run:

```bash
pnpm test:e2e:cloudflare
```

`cloudflare-check.env.local` is ignored by git. The script first runs `pnpm typecheck:e2e`, then checks public routes, login guards, private pages, the settings page, temporary subscription create/delete, mobile layout, and duplicate requests from core APIs.

Read-only check only:

```bash
pnpm test:e2e:cloudflare -- --readonly
```

## Local Data

Wrangler's local D1 files are in the project directory:

```text
.wrangler/state/v3/d1/
```

Renewlet's local R2 state is in:

```text
.wrangler/state/v3/r2/
```

List tables:

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
```

View users:

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT id, email, role, created_at FROM users;"
```

View subscription count:

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT COUNT(*) AS count FROM subscriptions;"
```

Open directly with `sqlite3`:

```bash
sqlite3 "$(find .wrangler/state/v3/d1 -name '*.sqlite' ! -name 'metadata.sqlite' | head -n 1)"
```

## Other Configuration

| Name | Type | Purpose |
| --- | --- | --- |
| `SETUP_ENABLED` | Worker var | `/setup` switch, defaults to `true` |
| `SESSION_TTL_DAYS` | Worker var | Login validity period, defaults to 30 days |
| `VITE_RENEWLET_RUNTIME=cloudflare` | Build variable | Frontend uses the Worker API |

## Common Cases

**What if the Worker name already exists?**

Change `WORKER_NAME` in GitHub Secrets, then rerun the workflow.

**Old `pb_data`?**

Use a separate export/import flow.
