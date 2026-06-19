#!/usr/bin/env node
/**
 * 部署脚本契约检查。
 *
 * 触发时机：`pnpm check:deploy`、CI 质量门和发布前部署验证。
 * 前置依赖：Node.js；安装 Docker Compose v2 时会额外检查 compose config，未安装时跳过该部分。
 *
 * 架构位置：根 `check:deploy` 在 CI/本地检查一键部署脚本是否仍会生成必要密钥、
 * 保留已有配置，并在缺少 Docker 时给出可预测行为。
 *
 * 流程：
 *   临时目录 -> 假 docker -> 复制部署模板 -> 运行脚本 -> 检查 .env/compose
 *
 * 注意：这里会创建临时文件但不改仓库；每个临时目录都在 finally 清理。
 * 新增部署环境变量时要同步 env.example 和这些断言。
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = join(repoRoot, "deploy/docker-deploy.sh");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

function runIn(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed in ${cwd}: ${command} ${args.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

function commandWorks(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0;
}

function parseEnvValue(path, key) {
  const content = readFileSync(path, "utf8");
  const line = content
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    throw new Error(`Missing ${key} in ${path}`);
  }
  // 部署脚本允许双引号/单引号包裹值；测试只关心真实 secret 长度，不关心引用形式。
  return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "");
}

function prepareFakeDocker(tempDir) {
  const binDir = join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });

  const dockerPath = join(binDir, "docker");
  // 假 docker 只实现脚本启动所需的 `docker compose version`，任何额外调用都会让测试失败。
  writeFileSync(
    dockerPath,
    [
      "#!/usr/bin/env sh",
      'if [ "$1" = "compose" ] && [ "$2" = "version" ]; then',
      "  exit 0",
      "fi",
      'echo "unexpected docker invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(dockerPath, 0o755);
  return binDir;
}

function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function initGitRepo(path) {
  mkdirSync(path, { recursive: true });
  runIn(path, "git", ["init", "-b", "main"]);
  runIn(path, "git", ["config", "user.name", "Renewlet Test"]);
  runIn(path, "git", ["config", "user.email", "renewlet-test@example.invalid"]);
}

function runDeployScript(tempDir) {
  const binDir = prepareFakeDocker(tempDir);
  return spawnSync("bash", [deployScript], {
    cwd: tempDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
  });
}

function checkGeneratedSecrets() {
  const tempDir = mkdtempSync(join(tmpdir(), "renewlet-deploy-ok-"));
  try {
    copyFileSync(join(repoRoot, "deploy/docker-compose.yml"), join(tempDir, "docker-compose.yml"));
    copyFileSync(join(repoRoot, "deploy/env.example"), join(tempDir, ".env"));

    const result = runDeployScript(tempDir);
    if (result.status !== 0) {
      throw new Error(`docker-deploy.sh failed unexpectedly:\n${result.stderr || result.stdout}`);
    }

    const envPath = join(tempDir, ".env");
    const pbKey = parseEnvValue(envPath, "PB_ENCRYPTION_KEY");
    if (pbKey.length !== 32) {
      throw new Error(`Expected generated PB_ENCRYPTION_KEY length 32, got ${pbKey.length}`);
    }

    const cronSecret = parseEnvValue(envPath, "CRON_SECRET");
    if (cronSecret.length === 0) {
      throw new Error("Expected generated CRON_SECRET to be non-empty");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function checkInvalidExistingPBKeyIsRejected() {
  const tempDir = mkdtempSync(join(tmpdir(), "renewlet-deploy-bad-"));
  try {
    copyFileSync(join(repoRoot, "deploy/docker-compose.yml"), join(tempDir, "docker-compose.yml"));

    const envPath = join(tempDir, ".env");
    const invalidEnv = [
      'PB_ENCRYPTION_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      'CRON_SECRET="existing-cron-secret"',
      "",
    ].join("\n");
    writeFileSync(envPath, invalidEnv);

    const result = runDeployScript(tempDir);
    if (result.status === 0) {
      throw new Error("Expected docker-deploy.sh to reject invalid PB_ENCRYPTION_KEY");
    }
    if (!result.stderr.includes("PB_ENCRYPTION_KEY must be exactly 32 characters; got 44")) {
      throw new Error(`Expected clear PB_ENCRYPTION_KEY length error, got:\n${result.stderr}`);
    }
    // 错误 key 不能被脚本自动替换；已有部署一旦丢失原 key，历史加密数据将无法解密。
    if (readFileSync(envPath, "utf8") !== invalidEnv) {
      throw new Error("Invalid existing PB_ENCRYPTION_KEY was modified");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function checkComposeConfig() {
  if (!commandWorks("docker", ["compose", "version"])) {
    console.warn("Skipping docker compose config checks because Docker Compose v2 is unavailable.");
    return;
  }

  run("docker", ["compose", "-f", "docker-compose.yml", "config"]);
  run("docker", ["compose", "-f", "deploy/docker-compose.yml", "--env-file", "deploy/env.example", "config"]);
  run("docker", ["compose", "-f", "docker-compose.ghcr.yml", "config"]);
}

function checkDockerSelfUpdateLayout() {
  const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
  const entrypoint = readFileSync(join(repoRoot, "deploy/docker-entrypoint.sh"), "utf8");
  const compose = readFileSync(join(repoRoot, "deploy/docker-compose.yml"), "utf8");
  const releaseWorkflow = readFileSync(join(repoRoot, ".github/workflows/release-publish.yml"), "utf8");

  // 页面内更新依赖 Dockerfile、entrypoint、compose、release 资产四处同频；这里把布局当契约锁住。
  for (const snippet of [
    "/opt/renewlet/current/renewlet",
    "RENEWLET_SELF_UPDATE_ENABLED=true",
    "ln -s /opt/renewlet/current/renewlet /renewlet",
  ]) {
    if (!dockerfile.includes(snippet)) {
      throw new Error(`Dockerfile must keep self-update layout snippet: ${snippet}`);
    }
  }
  if (
    !entrypoint.includes("mkdir -p /pb_data /opt/renewlet/current /opt/renewlet/backups") ||
    !entrypoint.includes("rm -f /renewlet") ||
    !entrypoint.includes("ln -s /opt/renewlet/current/renewlet /renewlet")
  ) {
    throw new Error("docker-entrypoint.sh must keep /opt/renewlet/current and backups writable");
  }
  if (!compose.includes('test: [ "CMD", "/renewlet", "healthcheck" ]')) {
    throw new Error("Docker healthcheck must keep /renewlet as the stable entrypoint");
  }
  for (const snippet of [
    "Build Linux self-update binaries",
    "pnpm --filter @renewlet/client build",
    "renewlet_${{ needs.metadata.outputs.version }}_linux_amd64.tar.gz",
    "renewlet_${{ needs.metadata.outputs.version }}_linux_arm64.tar.gz",
    "sha256sum renewlet_${{ needs.metadata.outputs.version }}_linux_*.tar.gz > checksums.txt",
  ]) {
    if (!releaseWorkflow.includes(snippet)) {
      throw new Error(`release-publish.yml must keep self-update release asset snippet: ${snippet}`);
    }
  }
  // GitHub Release 仍交给 softprops；RC 前置清理只移除同 tag 残留 draft，避免首次发布撞 duplicate tag。
  for (const snippet of [
    "Cleanup stale draft release",
    "if: ${{ needs.metadata.outputs.is-stable != 'true' }}",
    "uses: actions/github-script@v9.0.0",
    "item.draft && item.tag_name === tag",
    "github.rest.repos.deleteRelease",
    "uses: softprops/action-gh-release@v3.0.0",
    "fail_on_unmatched_files: true",
  ]) {
    if (!releaseWorkflow.includes(snippet)) {
      throw new Error(`release-publish.yml must keep GitHub Release hygiene snippet: ${snippet}`);
    }
  }
}

function checkDockerCustomHeadScriptEnv() {
  const expectedEnv = "RENEWLET_CUSTOM_HEAD_SCRIPT";
  const files = [
    ".env.example",
    "deploy/env.example",
    "docker-compose.yml",
    "docker-compose.ghcr.yml",
    "deploy/docker-compose.yml",
    "README.md",
    "README.zh-CN.md",
  ];

  // 自定义 head 脚本同时影响 HTML 注入与 CSP；部署入口漏传会让文档配置变成静默无效。
  for (const relativePath of files) {
    const content = readFileSync(join(repoRoot, relativePath), "utf8");
    if (!content.includes(expectedEnv)) {
      throw new Error(`${relativePath} must document or pass through ${expectedEnv}.`);
    }
  }
}

function checkCloudflareDeployMigrationScript() {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const deployScript = packageJson.scripts?.deploy;
  const deployCloudflareScript = packageJson.scripts?.["deploy:cloudflare"];
  const buildCloudflareScript = packageJson.scripts?.["build:cloudflare"];
  const devScript = packageJson.scripts?.["dev:cloudflare"];
  const migrationScript = packageJson.scripts?.["cloudflare:migrations:apply"];

  // Deploy Button 和自管 Wrangler 部署都依赖这个顺序：先确认生产 headers，再迁移 D1，最后更新 Worker。
  if (deployScript !== "node scripts/prepare-cloudflare-local-headers.mjs --check-production && pnpm cloudflare:migrations:apply && wrangler deploy") {
    throw new Error("package.json deploy script must check production Cloudflare headers before remote migration and wrangler deploy.");
  }
  if (deployCloudflareScript !== "pnpm build:cloudflare && pnpm deploy") {
    throw new Error("package.json deploy:cloudflare must rebuild production Cloudflare assets before deploy.");
  }
  if (buildCloudflareScript !== "VITE_RENEWLET_RUNTIME=cloudflare pnpm --filter @renewlet/client build") {
    throw new Error("package.json build:cloudflare must keep the production client build without local HTTP header rewrites.");
  }
  if (migrationScript !== "wrangler d1 migrations apply DB --remote") {
    throw new Error("package.json cloudflare:migrations:apply must target the DB binding with remote D1 migrations.");
  }
  if (devScript !== "pnpm build:cloudflare && node scripts/prepare-cloudflare-local-headers.mjs && pnpm cloudflare:migrations:apply:local && node scripts/cloudflare-dev-hint.mjs && wrangler dev --test-scheduled") {
    throw new Error("package.json dev:cloudflare must prepare local HTTP headers, print the local Cron hint, and enable Wrangler scheduled middleware.");
  }
}

function checkCloudflareStaticAssetHeadersContract() {
  const publicHeaders = readFileSync(join(repoRoot, "packages/client/public/_headers"), "utf8");
  const localHeadersScript = readFileSync(join(repoRoot, "scripts/prepare-cloudflare-local-headers.mjs"), "utf8");

  // 生产 Cloudflare HTTPS 入口继续使用强 CSP；只有 ignored 的 dist 文件能被本地 HTTP dev 放宽。
  for (const snippet of [
    "Content-Security-Policy:",
    "img-src 'self' data: blob: https:",
    "upgrade-insecure-requests",
  ]) {
    if (!publicHeaders.includes(snippet)) {
      throw new Error(`packages/client/public/_headers must keep production CSP snippet: ${snippet}`);
    }
  }
  if (publicHeaders.includes("img-src 'self' data: blob: http: https:")) {
    throw new Error("packages/client/public/_headers must not use the local HTTP img-src policy.");
  }
  for (const snippet of [
    "packages/client/dist/_headers",
    "upgrade-insecure-requests",
    "img-src 'self' data: blob: http: https:",
    "--check-production",
  ]) {
    if (!localHeadersScript.includes(snippet)) {
      throw new Error(`prepare-cloudflare-local-headers.mjs must keep local/production header guard snippet: ${snippet}`);
    }
  }
}

function checkCloudflareScheduledLocalRoute() {
  const wranglerConfig = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
  const runWorkerFirst = /"run_worker_first"\s*:\s*\[([^\]]*)\]/s.exec(wranglerConfig)?.[1] ?? "";
  const assetsBlock = /"assets"\s*:\s*\{(?<body>[\s\S]*?)\n\s*\}/.exec(wranglerConfig)?.groups?.body ?? "";

  // Worker 通过 Static Assets binding 读取 seed 图标索引；不能把大 JSON 再打进 Worker bundle。
  if (!/"binding"\s*:\s*"ASSETS"/.test(assetsBlock)) {
    throw new Error('wrangler.jsonc assets.binding must stay "ASSETS" for built-in icon seed reads.');
  }
  // Wrangler 的 /cdn-cgi scheduled 测试入口在 Workers Static Assets 下会先打到 asset proxy；Renewlet 本地 Cron 固定走 /__scheduled。
  if (!runWorkerFirst.includes('"/__scheduled"')) {
    throw new Error('wrangler.jsonc assets.run_worker_first must include "/__scheduled" for local Cron testing.');
  }
}

function checkCloudflareLocalDevNetworkAccess() {
  const wranglerConfig = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
  const devBlock = /"dev"\s*:\s*\{(?<body>[^}]+)\}/s.exec(wranglerConfig)?.groups?.body ?? "";

  // 本地真机验收依赖 Wrangler 监听所有网卡；`--host` 是 upstream 配置，不能替代 dev.ip。
  if (!/"ip"\s*:\s*"0\.0\.0\.0"/.test(devBlock)) {
    throw new Error('wrangler.jsonc dev.ip must be "0.0.0.0" so pnpm dev:cloudflare is reachable by LAN IP.');
  }
  if (!/"port"\s*:\s*8787/.test(devBlock)) {
    throw new Error("wrangler.jsonc dev.port must stay 8787 so local Cloudflare URLs and hints remain stable.");
  }
  if (!/"local_protocol"\s*:\s*"http"/.test(devBlock)) {
    throw new Error('wrangler.jsonc dev.local_protocol must stay "http" for local Cloudflare development.');
  }
}

function checkCloudflareFreshD1Migrations() {
  const tempDir = mkdtempSync(join(tmpdir(), "renewlet-d1-migrations-"));
  try {
    // Deploy Button 会创建全新的 D1；历史 migration 必须能从 0001 顺序跑到最新，不能只验证已有生产库增量路径。
    run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", tempDir], {
      env: {
        ...process.env,
        CI: "1",
      },
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function checkCloudflareDeployButtonVars() {
  const wranglerConfig = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const packageBindings = packageJson.cloudflare?.bindings ?? {};

  // Deploy Button 会把模板变量当成用户配置项；版本/commit/build time 必须由 workflow 注入。
  for (const name of ["RENEWLET_VERSION", "RENEWLET_COMMIT", "RENEWLET_BUILD_TIME"]) {
    if (wranglerConfig.includes(`"${name}"`)) {
      throw new Error(`wrangler.jsonc must not expose ${name} as a Deploy Button user variable.`);
    }
    if (Object.hasOwn(packageBindings, name)) {
      throw new Error(`package.json cloudflare.bindings must not expose ${name} as a Deploy Button field.`);
    }
  }
}

function checkCloudflareDeployButtonVersionFallback() {
  const workerSystem = readFileSync(join(repoRoot, "packages/cloudflare/src/system.ts"), "utf8");

  // Deploy Button 不一定有 CI 版本变量；Worker 缺元信息时必须显示 package stable version，不能再合成 dev 后缀。
  for (const snippet of [
    "`${rootPackageJson.version}-dev",
    'rootPackageJson.version + "-dev',
    "rootPackageJson.version}-dev",
  ]) {
    if (workerSystem.includes(snippet)) {
      throw new Error(`Cloudflare system version fallback must not synthesize dev versions: ${snippet}`);
    }
  }
  for (const snippet of ["PLACEHOLDER_DEV_VERSION_PATTERN", "return rootPackageJson.version;"]) {
    if (!workerSystem.includes(snippet)) {
      throw new Error(`Cloudflare system version fallback must keep Deploy Button stable-version guard: ${snippet}`);
    }
  }
}

function checkCloudflareWorkflowBuildMetadata() {
  const selfHostedWorkflow = readFileSync(join(repoRoot, ".github/workflows/cloudflare-worker.yml"), "utf8");
  const releaseWorkflow = readFileSync(join(repoRoot, ".github/workflows/release-publish.yml"), "utf8");

  // 自管 Cloudflare workflow 不是正式 Release，必须注入 packageVersion-dev+shortSha，避免生产界面暴露 0.0.0-dev。
  if (selfHostedWorkflow.includes("RENEWLET_VERSION: 0.0.0-dev")) {
    throw new Error("cloudflare-worker.yml must not deploy the 0.0.0-dev placeholder version.");
  }
  // 官方 main 是稳定发布线；自管分支部署不能绕过 Release Publish 的 production-cloudflare 审批门。
  for (const snippet of [
    "if: ${{ github.repository != 'zhiyingzzhou/renewlet' || github.ref == 'refs/heads/dev' }}",
    "      - dev",
    "      - main",
    "workflow_dispatch:",
  ]) {
    if (!selfHostedWorkflow.includes(snippet)) {
      throw new Error(`cloudflare-worker.yml must keep self-managed deployment guard: ${snippet}`);
    }
  }
  for (const snippet of [
    "PACKAGE_VERSION=\"$(node -p \"require('./package.json').version\")\"",
    "SHORT_SHA=\"${GITHUB_SHA::7}\"",
    "RENEWLET_VERSION=${PACKAGE_VERSION}-dev+${SHORT_SHA}",
    "RENEWLET_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  ]) {
    if (!selfHostedWorkflow.includes(snippet)) {
      throw new Error(`cloudflare-worker.yml must keep build metadata snippet: ${snippet}`);
    }
  }
  for (const snippet of [
    "Validate stable release version",
    "RENEWLET_VERSION: ${{ needs.metadata.outputs.version }}",
    "RENEWLET_COMMIT: ${{ github.sha }}",
    "RENEWLET_BUILD_TIME: ${{ steps.build-time.outputs.value }}",
  ]) {
    if (!releaseWorkflow.includes(snippet)) {
      throw new Error(`release-publish.yml must keep production Cloudflare metadata snippet: ${snippet}`);
    }
  }
}

function workflowTriggerBlock(content, trigger) {
  const match = new RegExp(`^  ${trigger}:\\n(?<body>(?:    .*(?:\\n|$))*)`, "m").exec(content);
  return match?.groups?.body ?? "";
}

function checkReleaseBranchWorkflowTriggers() {
  const workflows = [
    { path: ".github/workflows/ci.yml", name: "CI" },
    { path: ".github/workflows/build-smoke.yml", name: "Build Smoke" },
  ];

  // Release 分支 push 不跑质量门；required checks 只能绑定 PR 或 tag job，避免被过滤的 workflow 长期 pending。
  for (const workflow of workflows) {
    const content = readFileSync(join(repoRoot, workflow.path), "utf8");
    const pullRequestBlock = workflowTriggerBlock(content, "pull_request");
    const pushBlock = workflowTriggerBlock(content, "push");

    for (const snippet of ["      - dev", "      - main", '      - "release/**"']) {
      if (!pullRequestBlock.includes(snippet)) {
        throw new Error(`${workflow.name} pull_request trigger must keep branch snippet: ${snippet.trim()}`);
      }
    }
    for (const snippet of ["      - dev", "      - main"]) {
      if (!pushBlock.includes(snippet)) {
        throw new Error(`${workflow.name} push trigger must keep branch snippet: ${snippet.trim()}`);
      }
    }
    if (pushBlock.includes("release/")) {
      throw new Error(`${workflow.name} push trigger must not include release branches; release checks run on PR and tag workflows.`);
    }
  }

  if (!readFileSync(join(repoRoot, ".github/workflows/build-smoke.yml"), "utf8").includes("workflow_dispatch:")) {
    throw new Error("Build Smoke must keep workflow_dispatch for manual no-secret build verification.");
  }
}

function checkRuntimeReleaseSecretPathRemoved() {
  const removedHelper = join(repoRoot, "scripts/write-cloudflare-worker-secrets-file.mjs");
  const removedRuntimeReleaseSecretEnv = ["RENEWLET", "GITHUB", "TOKEN"].join("_");
  if (existsSync(removedHelper)) {
    throw new Error("Cloudflare Worker secrets helper must stay removed; release checks do not use runtime secret envs.");
  }

  const files = [
    ".env.example",
    "deploy/env.example",
    "docs/cloudflare-workers-deploy.md",
    "docs/cloudflare-workers-deploy.zh-CN.md",
    ".github/workflows/cloudflare-worker.yml",
    ".github/workflows/release-publish.yml",
  ];

  // 已发布 release notes 是历史记录，不能为了新 runtime 契约回写旧版本说明；这里仅守当前部署入口。
  for (const relativePath of files) {
    const content = readFileSync(join(repoRoot, relativePath), "utf8");
    for (const snippet of [
      removedRuntimeReleaseSecretEnv,
      "write-cloudflare-worker-secrets-file",
      "worker-secrets",
      "--secrets-file",
    ]) {
      if (content.includes(snippet)) {
        throw new Error(`${relativePath} must not contain removed runtime release secret path: ${snippet}`);
      }
    }
  }
}

function findJsonBinding(config, key, binding) {
  const match = Array.isArray(config[key])
    ? config[key].find((item) => item && typeof item === "object" && item.binding === binding)
    : undefined;
  if (!match) throw new Error(`Expected ${binding} in ${key}.`);
  return match;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function preserveCloudflareGeneratedConfig(repoPath) {
  const config = readJson(join(repoPath, "wrangler.jsonc"));
  const d1 = findJsonBinding(config, "d1_databases", "DB");
  const r2 = findJsonBinding(config, "r2_buckets", "ASSETS_BUCKET");
  return {
    name: config.name,
    databaseName: d1.database_name,
    databaseId: d1.database_id,
    bucketName: r2.bucket_name,
    vars: config.vars && typeof config.vars === "object" && !Array.isArray(config.vars) ? config.vars : {},
  };
}

function applyCloudflareGeneratedConfig(repoPath, preserved) {
  const config = readJson(join(repoPath, "wrangler.jsonc"));
  const d1 = findJsonBinding(config, "d1_databases", "DB");
  const r2 = findJsonBinding(config, "r2_buckets", "ASSETS_BUCKET");
  config.name = preserved.name;
  d1.database_name = preserved.databaseName;
  d1.database_id = preserved.databaseId;
  r2.bucket_name = preserved.bucketName;
  config.vars = {
    ...(config.vars && typeof config.vars === "object" && !Array.isArray(config.vars) ? config.vars : {}),
    ...preserved.vars,
  };
  writeFileSync(join(repoPath, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);
}

function simulateSyncRenewletUpstream(generatedRepo, upstreamRepo, tempDir) {
  mkdirSync(tempDir, { recursive: true });
  const preserved = preserveCloudflareGeneratedConfig(generatedRepo);
  const workflowsBackup = join(tempDir, "workflows-backup");
  const workflowsPath = join(generatedRepo, ".github/workflows");
  if (existsSync(workflowsPath)) {
    cpSync(workflowsPath, workflowsBackup, { recursive: true });
  }

  const existingUpstream = spawnSync("git", ["remote", "get-url", "upstream"], {
    cwd: generatedRepo,
    encoding: "utf8",
  });
  if (existingUpstream.status === 0) {
    runIn(generatedRepo, "git", ["remote", "set-url", "upstream", upstreamRepo]);
  } else {
    runIn(generatedRepo, "git", ["remote", "add", "upstream", upstreamRepo]);
  }
  runIn(generatedRepo, "git", ["fetch", "upstream", "main"]);
  runIn(generatedRepo, "git", ["restore", "--source", "FETCH_HEAD", "--staged", "--worktree", ":/"]);

  if (existsSync(workflowsBackup)) {
    rmSync(workflowsPath, { recursive: true, force: true });
    mkdirSync(workflowsPath, { recursive: true });
    cpSync(workflowsBackup, workflowsPath, { recursive: true });
  }
  applyCloudflareGeneratedConfig(generatedRepo, preserved);

  runIn(generatedRepo, "git", ["add", "-A"]);
  const stagedDiff = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: generatedRepo,
    encoding: "utf8",
  });
  if (stagedDiff.status === 0) {
    return false;
  }
  if (stagedDiff.status !== 1) {
    throw new Error(`Expected git diff --cached --quiet status 0 or 1, got ${stagedDiff.status}: ${stagedDiff.stderr}`);
  }

  const upstreamSha = runIn(generatedRepo, "git", ["rev-parse", "--short=12", "FETCH_HEAD"]).stdout.trim();
  runIn(generatedRepo, "git", ["commit", "-m", `chore: sync Renewlet upstream ${upstreamSha}`]);
  return true;
}

function checkSyncRenewletUpstreamWorkflow() {
  const workflowPath = join(repoRoot, ".github/workflows/sync-renewlet-upstream.yml");
  if (!existsSync(workflowPath)) {
    throw new Error("sync-renewlet-upstream.yml must exist for one-click generated repositories.");
  }

  const content = readFileSync(workflowPath, "utf8");
  for (const snippet of [
    "name: Sync Renewlet Upstream",
    "workflow_dispatch:",
    "contents: write",
    "github.repository != 'zhiyingzzhou/renewlet'",
    "https://github.com/zhiyingzzhou/renewlet.git",
    "git restore --source",
    "git push origin \"HEAD:${target_branch}\"",
  ]) {
    if (!content.includes(snippet)) {
      throw new Error(`sync-renewlet-upstream.yml must keep snippet: ${snippet}`);
    }
  }
  const onBlock = /^on:\n(?<body>(?:  .*(?:\n|$))*)/m.exec(content)?.groups?.body ?? "";
  if (!onBlock.includes("  workflow_dispatch:")) {
    throw new Error("sync-renewlet-upstream.yml must keep workflow_dispatch as the only trigger.");
  }
  for (const forbiddenTrigger of ["  push:", "  pull_request:", "  workflow_run:", "  repository_dispatch:"]) {
    if (onBlock.includes(forbiddenTrigger)) {
      throw new Error(`sync-renewlet-upstream.yml must not include trigger: ${forbiddenTrigger.trim()}`);
    }
  }
  for (const forbidden of ["schedule:", "git merge", "git rebase", "--allow-unrelated-histories", "--force"]) {
    if (content.includes(forbidden)) {
      throw new Error(`sync-renewlet-upstream.yml must not contain: ${forbidden}`);
    }
  }
}

function checkSyncRenewletUpstreamBehavior() {
  const tempDir = mkdtempSync(join(tmpdir(), "renewlet-sync-upstream-"));
  try {
    const upstreamRepo = join(tempDir, "renewlet-upstream");
    const generatedRepo = join(tempDir, "generated-repo");

    initGitRepo(upstreamRepo);
    writeText(
      join(upstreamRepo, "wrangler.jsonc"),
      `{
  "name": "renewlet",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "renewlet",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "r2_buckets": [
    {
      "binding": "ASSETS_BUCKET",
      "bucket_name": "renewlet-assets"
    }
  ],
  "vars": {
    "SETUP_ENABLED": "true",
    "NEW_DEFAULT": "from-upstream"
  }
}
`,
    );
    writeText(join(upstreamRepo, "upstream-file.txt"), "from upstream\n");
    writeText(join(upstreamRepo, ".github/workflows/release-publish.yml"), "name: Release Publish\n");
    runIn(upstreamRepo, "git", ["add", "."]);
    runIn(upstreamRepo, "git", ["commit", "-m", "upstream snapshot"]);

    initGitRepo(generatedRepo);
    writeText(
      join(generatedRepo, "wrangler.jsonc"),
      `{
  "name": "renewlet-user-worker",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "renewlet-user-db",
      "database_id": "11111111-2222-3333-4444-555555555555"
    }
  ],
  "r2_buckets": [
    {
      "binding": "ASSETS_BUCKET",
      "bucket_name": "renewlet-user-assets"
    }
  ],
  "vars": {
    "SETUP_ENABLED": "false",
    "CUSTOM_USER_VAR": "keep-me"
  }
}
`,
    );
    writeText(join(generatedRepo, "generated-only.txt"), "remove me\n");
    writeText(join(generatedRepo, ".github/workflows/sync-renewlet-upstream.yml"), "name: Sync Renewlet Upstream\n");
    runIn(generatedRepo, "git", ["add", "."]);
    runIn(generatedRepo, "git", ["commit", "-m", "generated snapshot"]);

    if (!simulateSyncRenewletUpstream(generatedRepo, upstreamRepo, tempDir)) {
      throw new Error("Sync workflow simulation must create a commit when upstream changed.");
    }

    if (existsSync(join(generatedRepo, "generated-only.txt"))) {
      throw new Error("Sync workflow must remove files absent from upstream.");
    }
    if (!existsSync(join(generatedRepo, "upstream-file.txt"))) {
      throw new Error("Sync workflow must restore files from upstream.");
    }
    if (!existsSync(join(generatedRepo, ".github/workflows/sync-renewlet-upstream.yml"))) {
      throw new Error("Sync workflow must preserve the manual sync entrypoint.");
    }
    if (existsSync(join(generatedRepo, ".github/workflows/release-publish.yml"))) {
      throw new Error("Sync workflow must preserve generated repository workflows instead of importing upstream workflows.");
    }

    const wranglerConfig = readJson(join(generatedRepo, "wrangler.jsonc"));
    const d1 = findJsonBinding(wranglerConfig, "d1_databases", "DB");
    const r2 = findJsonBinding(wranglerConfig, "r2_buckets", "ASSETS_BUCKET");
    if (
      wranglerConfig.name !== "renewlet-user-worker" ||
      d1.database_name !== "renewlet-user-db" ||
      d1.database_id !== "11111111-2222-3333-4444-555555555555" ||
      r2.bucket_name !== "renewlet-user-assets" ||
      wranglerConfig.vars.SETUP_ENABLED !== "false" ||
      wranglerConfig.vars.CUSTOM_USER_VAR !== "keep-me" ||
      wranglerConfig.vars.NEW_DEFAULT !== "from-upstream"
    ) {
      throw new Error("Sync workflow must preserve generated Wrangler resources and vars.");
    }

    const parents = runIn(generatedRepo, "git", ["rev-list", "--parents", "-n", "1", "HEAD"]).stdout.trim().split(/\s+/);
    if (parents.length !== 2) {
      throw new Error("Sync workflow must create a normal single-parent commit.");
    }

    const mergeBase = spawnSync("git", ["merge-base", "HEAD", "refs/remotes/upstream/main"], {
      cwd: generatedRepo,
      encoding: "utf8",
    });
    if (mergeBase.status === 0) {
      throw new Error("Sync workflow must not merge unrelated upstream history.");
    }
    if (mergeBase.status !== 1) {
      throw new Error(`Expected no merge base, got git status ${mergeBase.status}: ${mergeBase.stderr}`);
    }

    const commitCount = runIn(generatedRepo, "git", ["rev-list", "--count", "HEAD"]).stdout.trim();
    if (simulateSyncRenewletUpstream(generatedRepo, upstreamRepo, join(tempDir, "noop"))) {
      throw new Error("Sync workflow simulation must no-op when upstream is already applied.");
    }
    const noOpCommitCount = runIn(generatedRepo, "git", ["rev-list", "--count", "HEAD"]).stdout.trim();
    if (commitCount !== noOpCommitCount) {
      throw new Error("Sync workflow no-op must not create a commit.");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function checkSyncRenewletUpstreamDocs() {
  const docs = ["docs/cloudflare-workers-deploy.md", "docs/cloudflare-workers-deploy.zh-CN.md"];
  for (const relativePath of docs) {
    const content = readFileSync(join(repoRoot, relativePath), "utf8");
    for (const snippet of ["Sync Renewlet Upstream", "Run workflow", ".github/workflows/sync-renewlet-upstream.yml"]) {
      if (!content.includes(snippet)) {
        throw new Error(`${relativePath} must document manual upstream sync: ${snippet}`);
      }
    }
    for (const forbidden of [
      "upgrade-cloudflare-generated-repo.mjs",
      "node /tmp/renewlet-upgrade.mjs",
      "curl -fsSL https://raw.githubusercontent.com/zhiyingzzhou/renewlet/main/scripts",
      "git merge upstream/main",
      "--allow-unrelated-histories",
    ]) {
      if (content.includes(forbidden)) {
        throw new Error(`${relativePath} must not keep obsolete generated-repo upgrade flow: ${forbidden}`);
      }
    }
  }
}

run("bash", ["-n", deployScript]);
checkGeneratedSecrets();
checkInvalidExistingPBKeyIsRejected();
checkDockerSelfUpdateLayout();
checkDockerCustomHeadScriptEnv();
checkCloudflareDeployMigrationScript();
checkCloudflareStaticAssetHeadersContract();
checkCloudflareScheduledLocalRoute();
checkCloudflareLocalDevNetworkAccess();
checkCloudflareFreshD1Migrations();
checkCloudflareDeployButtonVars();
checkCloudflareDeployButtonVersionFallback();
checkCloudflareWorkflowBuildMetadata();
checkReleaseBranchWorkflowTriggers();
checkRuntimeReleaseSecretPathRemoved();
checkSyncRenewletUpstreamWorkflow();
checkSyncRenewletUpstreamBehavior();
checkSyncRenewletUpstreamDocs();
checkComposeConfig();

console.log("Deployment configuration checks passed.");
