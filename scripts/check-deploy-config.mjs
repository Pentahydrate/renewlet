#!/usr/bin/env node
/**
 * 部署脚本契约检查。
 *
 * 架构位置：根 `check:deploy` 在 CI/本地检查一键部署脚本是否仍会生成必要密钥、
 * 保留已有配置，并在缺少 Docker 时给出可预测行为。
 *
 * 流程：
 *   临时目录 -> 假 docker -> 复制部署模板 -> 运行脚本 -> 检查 .env/compose
 *
 * 注意： 这里会创建临时文件但不改仓库；新增部署环境变量时要同步 env.example 和这些断言。
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
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

run("bash", ["-n", deployScript]);
checkGeneratedSecrets();
checkInvalidExistingPBKeyIsRejected();
checkComposeConfig();

console.log("Deployment configuration checks passed.");
