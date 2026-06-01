# Cloudflare Workers Deploy

## Recommended: One-Click Deploy

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/zhiyingzzhou/renewlet"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>

1. Click the button.
2. Sign in to Cloudflare or authorize access.
3. Finish the Cloudflare wizard.
4. Open:

```text
https://<worker-name>.<workers-dev-subdomain>.workers.dev/setup
```

Keep the generated deploy command as `pnpm deploy`. Renewlet's deploy script applies D1 migrations before publishing the Worker, so new tables are created before the updated API starts serving traffic.

If you prefer to create D1/R2, the Cloudflare API Token, and GitHub Secrets yourself, use the manual deploy flow below.

## Manual Deploy (GitHub Actions)

Manual deploy is for users who want to manage Cloudflare resources and GitHub Actions themselves. After preparing the 5 values below, run `Cloudflare Worker` manually in your fork.

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

For the first deployment, run it manually from GitHub Actions. Later, when you sync upstream changes into your fork, Actions can redeploy automatically if enabled. You can also run it manually at any time:

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

Cloudflare Workers deployments can update with automatic sync or manual sync.

### Automatic Update

If your fork has automatic upstream sync enabled, upstream updates sync and redeploy automatically.

### Manual Update

1. Open your fork repository.
2. Click `Sync fork`.
3. If GitHub asks for confirmation, click `Update branch`.
4. Wait for Cloudflare to redeploy.
5. If deployment does not start automatically, open `Actions` and run `Cloudflare Worker` manually.

Every Cloudflare update must run the same migration-before-deploy path. The GitHub Actions workflow does this automatically when all required secrets are configured.

## Optional: Wrangler CLI

Most deployments do not need Wrangler CLI. Use these commands only if you want to manage Cloudflare resources from your own machine.

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

## Other Configuration

| Name | Type | Purpose |
| --- | --- | --- |
| `SETUP_ENABLED` | Worker var | `/setup` switch, defaults to `true` |
| `SESSION_TTL_DAYS` | Worker var | Login validity period, defaults to 30 days |
| `VITE_RENEWLET_RUNTIME=cloudflare` | Build variable | Frontend uses the Worker API |

## Common Cases

**What if the Worker name already exists?**

Change `WORKER_NAME` in GitHub Secrets, then rerun the workflow.

**Calendar feed says `no such table: calendar_feeds`?**

Your Worker was updated before the remote D1 migrations finished or ran. The calendar feed table now stores scoped tokens for both the global feed and per-subscription feeds, so the D1 migration must run before relying on calendar subscription links. Re-run the `Cloudflare Worker` workflow, or run:

```bash
pnpm cloudflare:config:ci
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.generated.jsonc
```

**Old `pb_data`?**

Use a separate export/import flow.
