/**
 * 服务端文案生成器。
 *
 * 触发时机：维护 `packages/shared/data/server-i18n/active.*.json` 后运行；`--check` 用于 CI 守卫。
 * 副作用：无参数会重写 Go embed catalog 和 Cloudflare Worker TS catalog。
 *
 * 契约：Go/PocketBase 与 Worker 共用同一服务端文案源，前端只消费稳定错误 code，不导入这里的翻译文本。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(rootDir, "packages/shared/data/server-i18n");
const serverOutDir = path.join(rootDir, "apps/docker-server/cmd/renewlet/i18n");
const workerOutPath = path.join(rootDir, "apps/worker/src/server-i18n-catalog.ts");
const defaultLocale = "zh-CN";
const checkMode = process.argv.includes("--check");

// 服务端 catalog 是 Go/Worker 的共同事实源；前端只消费稳定错误 code，不导入这里的文案。

function discoverLocales() {
  const locales = fs.readdirSync(sourceDir)
    .map((name) => /^active\.(.+)\.json$/.exec(name)?.[1])
    .filter(Boolean)
    .sort();
  if (!locales.includes(defaultLocale)) {
    throw new Error(`missing default server i18n catalog active.${defaultLocale}.json`);
  }
  return [defaultLocale, ...locales.filter((locale) => locale !== defaultLocale)];
}

function readCatalog(locale) {
  const filePath = path.join(sourceDir, `active.${locale}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function placeholders(message) {
  const names = new Set();
  for (const match of message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function legacyPrintfPlaceholders(message) {
  return [...message.matchAll(/%(\d+\$)?[+#0\- ]*(\*|\d+)?(?:\.(\*|\d+))?[bcdeEfgGopqstTvxXU]/g)].map((match) => match[0]);
}

function stableStringify(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value, null, 2);
  }
  const sorted = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

const locales = discoverLocales();
const catalogs = Object.fromEntries(locales.map((locale) => [locale, readCatalog(locale)]));
const sourceKeys = Object.keys(catalogs[defaultLocale]).sort();
const failures = [];

for (const locale of locales) {
  const catalog = catalogs[locale];
  const keys = Object.keys(catalog).sort();
  for (const key of sourceKeys) {
    if (!(key in catalog)) failures.push(`${locale} is missing key ${key}`);
  }
  for (const key of keys) {
    if (!sourceKeys.includes(key)) failures.push(`${locale} has extra key ${key}`);
    if (typeof catalog[key] !== "string" || catalog[key].trim() === "") {
      failures.push(`${locale} has empty server i18n message for ${key}`);
    }
    if (legacyPrintfPlaceholders(catalog[key] ?? "").length > 0) {
      failures.push(`${locale} uses legacy printf placeholder in ${key}; use named placeholders like {label}.`);
    }
  }
}

for (const key of sourceKeys) {
  const expected = placeholders(catalogs[defaultLocale][key]).join(",");
  for (const locale of locales.filter((locale) => locale !== defaultLocale)) {
    const actual = placeholders(catalogs[locale][key] ?? "").join(",");
    if (expected !== actual) {
      failures.push(`${locale} placeholder mismatch for ${key}: expected [${expected}], got [${actual}]`);
    }
  }
}

const tsSource = [
  `export const SERVER_I18N_LOCALES = ${JSON.stringify(locales, null, 2)} as const;`,
  "",
  "export type ServerI18nLocale = (typeof SERVER_I18N_LOCALES)[number];",
  "",
  `export const DEFAULT_SERVER_I18N_LOCALE: ServerI18nLocale = ${JSON.stringify(defaultLocale)};`,
  "",
  "export type ServerI18nCatalog = Record<string, string>;",
  "",
  `export const SERVER_I18N_CATALOGS = ${JSON.stringify(catalogs, null, 2)} as const satisfies Record<ServerI18nLocale, ServerI18nCatalog>;`,
  "",
  "export type ServerI18nKey = keyof (typeof SERVER_I18N_CATALOGS)[typeof DEFAULT_SERVER_I18N_LOCALE];",
  "",
].join("\n");

const outputs = [
  ...locales.map((locale) => ({
    path: path.join(serverOutDir, `active.${locale}.json`),
    source: stableStringify(catalogs[locale]),
  })),
  { path: workerOutPath, source: tsSource },
];

for (const output of outputs) {
  if (!fs.existsSync(output.path)) {
    if (checkMode) failures.push(`${path.relative(rootDir, output.path)} is missing. Run \`pnpm generate:server-i18n\`.`);
    continue;
  }
  if (checkMode && fs.readFileSync(output.path, "utf8") !== output.source) {
    failures.push(`${path.relative(rootDir, output.path)} is out of sync. Run \`pnpm generate:server-i18n\`.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

if (checkMode) {
  console.log(`server i18n catalogs OK (${sourceKeys.length} keys, ${locales.length} locales).`);
} else {
  fs.mkdirSync(serverOutDir, { recursive: true });
  for (const output of outputs) {
    fs.writeFileSync(output.path, output.source);
  }
  console.log(`generated server i18n catalogs (${sourceKeys.length} keys, ${locales.length} locales).`);
}
