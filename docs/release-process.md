# Release Process

Renewlet uses a tag-driven release process. `dev` is the integration branch, `main` is the latest stable release, and production artifacts are created only from release tags. The Actions page keeps only a few human-facing entry points so maintainers and fork users do not have to understand internal release plumbing.

## Workflow Entry Points

- `CI`: public quality gate. It needs no secrets and works for forks and PRs.
- `Build Smoke`: public build smoke test. It needs no secrets, validates Docker build and Cloudflare build, and never pushes or deploys.
- `Cloudflare Worker`: self-managed Worker deployment for fork users or maintainer test environments. It skips remote deployment when Cloudflare secrets are missing; once secrets exist, it applies D1 migrations and deploys the Worker.
- `Docker Hub Overview`: manual metadata sync for the official Docker Hub page. It does not build or push images.
- `Maintainer Release`: the only manual maintainer release workflow. Use `action=prepare|rc|promote` to choose the stage.
- `Release Publish`: tag-driven official publishing workflow for `v*.*.*` tags. It handles Docker images, GitHub Releases, and the production Cloudflare approval chain.

Official Docker publishing and production Cloudflare deploys live inside `Release Publish`; there are no extra manual internal workflows.

## Docker Hub Overview

Docker Hub does not populate the repository Overview from image pushes, and it does not resolve GitHub-style relative links in README content. `Release Publish` updates the Docker Hub short description and Overview after the official image push succeeds by generating a Docker Hub-specific README from `README.md` with absolute GitHub and raw asset URLs.

Use the manual `Docker Hub Overview` workflow when the Overview needs to be refreshed without publishing a new RC or stable image. The manual workflow runs the same generator and updates only Docker Hub repository metadata; it does not build, tag, push, or deploy anything.

Keep repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` configured before publishing RC or stable tags. The token must be able to push `zhiyingzzhou/renewlet` and update repository metadata, because the same release job handles both image upload and Overview synchronization.

## Branches

- `dev`: day-to-day integration branch. Feature and fix PRs target this branch.
- `release/vX.Y.Z`: release stabilization branch created from `dev`.
- `main`: stable branch. It only receives release and hotfix PRs.
- `hotfix/vX.Y.Z`: urgent fix branch created from `main`, then merged back into `dev`.

Use Conventional Commits for PR titles and commits. Examples: `feat: add notification channel`, `fix: prevent duplicate reminder jobs`, `docs: clarify Docker upgrade`.

## Release Bot GitHub App

Release workflows use a dedicated GitHub App token instead of the default `GITHUB_TOKEN`. This matches mature release workflows such as n8n and Immich, and avoids repository-level `GITHUB_TOKEN` limits around creating pull requests and triggering follow-up CI.

Create a GitHub App named `renewlet-release-bot`, disable webhooks, and install it only on `zhiyingzzhou/renewlet`. Grant the app these repository permissions:

- Contents: read and write
- Pull requests: read and write
- Workflows: read and write

Add these repository settings before running `Maintainer Release`:

- Variable `RENEWLET_RELEASE_APP_CLIENT_ID`: the GitHub App Client ID.
- Secret `RENEWLET_RELEASE_APP_PRIVATE_KEY`: the full private key PEM generated for the app.

`Maintainer Release` fails early if either value is missing. Existing `release/vX.Y.Z` branches can stay in place; the release bot updates the branch and, after RC validation, creates or updates the matching PR.

## Prepare A Release

1. Make sure `dev` is green in CI.
2. Run the `Maintainer Release` workflow with `action=prepare`.
3. Enter a stable SemVer version such as `0.1.0`.
4. The workflow syncs package versions and pushes or updates `release/v0.1.0`.
5. Edit `docs/release-notes/vX.Y.Z-zh.md` as the GitHub Release body. Add `docs/release-notes/vX.Y.Z-en.md` when an English entry is needed. The release script only appends Docker image tags and the GitHub compare link.
6. Keep release-only fixes on `release/v0.1.0`.
7. Do not open the `main` PR yet; publish and validate at least one RC first.

## Publish A Release Candidate

1. Run the `Maintainer Release` workflow with `action=rc`.
2. Enter the stable version, for example `0.1.0`.
3. Enter the RC number, for example `1`.
4. The workflow creates tag `v0.1.0-rc.1` with the release bot token.
5. GitHub only starts the tag-driven `Release Publish` workflow when the tag is pushed by the release bot token. Tags created by the default `GITHUB_TOKEN` do not trigger follow-up workflows.
6. `Release Publish` builds and pushes:
   - `zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `zhiyingzzhou/renewlet:rc`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0-rc.1`
   - `ghcr.io/zhiyingzzhou/renewlet:rc`
7. RC releases are GitHub prereleases. They never update `latest` and never deploy production Cloudflare.

## Validate And Promote

1. Test the RC Docker image, GitHub prerelease assets, and Cloudflare release build output.
2. If the RC fails validation, fix `release/v0.1.0` and publish the next RC, for example `v0.1.0-rc.2`.
3. After an RC passes validation, run the `Maintainer Release` workflow with `action=promote`.
4. Enter the stable version, for example `0.1.0`, and the validated RC number, for example `1`.
5. The workflow checks that `v0.1.0-rc.1` exists, then creates or updates the `release/v0.1.0` PR against `main`.

## Cloudflare Test Deploy

Use the `Cloudflare Worker` workflow for Cloudflare test deployments. It runs on `dev` and `main` pushes and can also be started manually from GitHub Actions. This workflow is for test or user-managed Worker environments; it is separate from the release production gate.

If a fork user has not configured `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `WORKER_NAME`, `D1_DATABASE_ID`, and `R2_BUCKET_NAME`, the workflow finishes check/build and skips remote deployment with a notice. Once all secrets exist, it generates the Wrangler config, applies D1 migrations, and deploys the Worker.

## Publish Stable

1. Merge the promoted release PR into `main`.
2. Create and push an annotated stable tag from `main`:

```bash
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "Renewlet v0.1.0"
git push origin v0.1.0
```

3. `Release Publish` builds Docker images, creates a draft GitHub Release, and attaches `renewlet-docker-v0.1.0.zip`, `renewlet_0.1.0_linux_amd64.tar.gz`, `renewlet_0.1.0_linux_arm64.tar.gz`, and `checksums.txt`.
4. The workflow rejects a tag when the workspace package versions do not match the tag version. RC tags validate against the stable package version without writing the `-rc.N` suffix into `package.json`.
5. Stable releases push:
   - `zhiyingzzhou/renewlet:0.1.0`
   - `zhiyingzzhou/renewlet:0.1`
   - `zhiyingzzhou/renewlet:latest`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1.0`
   - `ghcr.io/zhiyingzzhou/renewlet:0.1`
   - `ghcr.io/zhiyingzzhou/renewlet:latest`
6. Review the draft Release, verify the Docker image list and Full Changelog compare link, then publish it manually.
7. Approve the `production-cloudflare` environment if this release should deploy the production Worker. Stable releases use the production deploy job inside `Release Publish`, not the `Cloudflare Worker` test deploy workflow.

## Docker In-App Updates

- `/renewlet` is the stable Docker entrypoint and healthcheck path; do not remove it in later releases.
- The real self-update target is `/opt/renewlet/current/renewlet`; the updater never replaces `/renewlet`.
- Users on images older than this layout must still run `docker compose pull && docker compose up -d` once. Later stable releases can be installed from the admin version dialog.
- Release binary archives must be Linux `amd64` and `arm64` tarballs named `renewlet_<version>_linux_<arch>.tar.gz`, with matching SHA-256 entries in `checksums.txt`.
- `/api/app/admin/system/version` reports `deployment` as `docker`, `cloudflare`, or `source`, and `updateMode` as `in-app-binary`, `docker-compose`, `cloudflare-deploy`, or `source-manual`. `updateSupported` only means the admin dialog may execute the in-app binary update.
- Docker release images with the new layout return `deployment=docker`, `updateMode=in-app-binary`, and `updateSupported=true`. Disabled self-update, old bridge layouts, and non-release builds must return the correct manual mode and a single unsupported reason.
- Cloudflare builds return `deployment=cloudflare`, `updateMode=cloudflare-deploy`, and `updateSupported=false`; they expose the injected build version and release link, but must not claim `checkSucceeded=true` unless a trusted GitHub latest-release check has actually succeeded.

## Hotfix

1. Create `hotfix/vX.Y.Z` from `main`.
2. Apply the smallest safe fix.
3. Open a PR to `main`.
4. After merge, tag `vX.Y.Z` and let `Release Publish` create the release.
5. Merge or cherry-pick the hotfix back to `dev`.

## Manual Checks

Before stable release, run or confirm these checks:

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

Production users should pin a concrete image tag. `latest` only moves on stable releases; RC tags are for validation.
