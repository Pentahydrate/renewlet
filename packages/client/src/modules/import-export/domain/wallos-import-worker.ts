import { renewletExportV1Schema } from "@/lib/api/schemas/import-export";
import { IMPORT_MESSAGE_CODES } from "./import-export-model";
import type { PreparedImport } from "./import-export-model";
import {
  buildFromRenewletExport,
  buildFromWallosDatabase,
  rowsById,
  type ImportBuildBaseContext,
  type ImportAssetSource,
  type WallosDatabaseModel,
  type WallosTableRow,
} from "./wallos-import-mapping";
import { buildPreparedLegacyRenewletImport } from "./renewlet-legacy-import";

type WorkerRequest = {
  id: number;
  buffer: ArrayBuffer;
  context: ImportBuildBaseContext;
  wallosUserId?: string;
};

type WorkerResponse =
  | { id: number; ok: true; prepared: PreparedImport }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      // sql.js 的 Wasm 编译只发生在 Worker 内；主线程只拿结构化结果，避免大 DB/ZIP 阻塞弹窗交互。
      const bytes = new Uint8Array(request.buffer);
      const prepared = await parseImportBytes(bytes, request.context, request.wallosUserId);
      postMessage({ id: request.id, ok: true, prepared } satisfies WorkerResponse);
    } catch (error) {
      postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : IMPORT_MESSAGE_CODES.workerParseFailed } satisfies WorkerResponse);
    }
  })();
};

async function parseImportBytes(
  bytes: Uint8Array,
  context: ImportBuildBaseContext,
  wallosUserId?: string,
): Promise<PreparedImport> {
  if (isZipBytes(bytes)) {
    return await parseZipBytes(bytes, context, wallosUserId);
  }
  if (isSqliteBytes(bytes)) {
    return buildFromWallosDatabase(await readWallosDatabase(bytes, new Map()), context, wallosUserId);
  }
  throw new Error(IMPORT_MESSAGE_CODES.unrecognizedFile);
}

async function parseZipBytes(
  bytes: Uint8Array,
  context: ImportBuildBaseContext,
  wallosUserId?: string,
): Promise<PreparedImport> {
  const { default: JSZip } = await import("jszip");
  // ZIP 初次解析只索引条目；JSZip 的 CRC 校验会读取全部文件，大备份会抵消 Logo 懒加载收益。
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const dataJson = zip.file("data.json");
  if (dataJson) {
    const data = JSON.parse(await dataJson.async("string")) as unknown;
    const assetEntries = collectRenewletAssetEntries(zip);
    const renewletExport = renewletExportV1Schema.safeParse(data);
    if (renewletExport.success) return buildFromRenewletExport(renewletExport.data, context, assetEntries);
    // Worker 里的 legacy data.json 桥接和主线程入口同寿命；迁移窗口结束后两边一起删，避免后台解析永久背双格式。
    const legacyRenewletPrepared = buildPreparedLegacyRenewletImport(data, context, assetEntries);
    if (legacyRenewletPrepared) return legacyRenewletPrepared;
  }
  const dbEntry = zip.file(/(^|\/)wallos\.db$/i)[0];
  if (!dbEntry) throw new Error(IMPORT_MESSAGE_CODES.unrecognizedFile);
  const logoFiles = collectWallosLogoEntries(zip);
  const model = await readWallosDatabase(new Uint8Array(await dbEntry.async("arraybuffer")), logoFiles);
  return buildFromWallosDatabase(model, context, wallosUserId);
}

function collectRenewletAssetEntries(zip: { file: (pattern: RegExp) => Array<{ name: string }> }): Map<string, ImportAssetSource> {
  const result = new Map<string, ImportAssetSource>();
  for (const file of zip.file(/^assets\//)) {
    result.set(file.name, file.name);
  }
  return result;
}

function collectWallosLogoEntries(zip: { file: (pattern: RegExp) => Array<{ name: string }> }): Map<string, ImportAssetSource> {
  const result = new Map<string, ImportAssetSource>();
  for (const file of zip.file(/(^|\/)logos\/[^/]+$/i)) {
    const filename = file.name.split("/").pop();
    if (!filename) continue;
    result.set(filename, file.name);
  }
  return result;
}

async function readWallosDatabase(bytes: Uint8Array, logoFiles: Map<string, ImportAssetSource>): Promise<WallosDatabaseModel> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(bytes);
  try {
    const subscriptions = selectRows(db, "subscriptions");
    const users = selectRows(db, "user").map((row) => ({
      id: String(row["id"] ?? "1"),
      label: String(row["username"] ?? row["email"] ?? `Wallos User ${row["id"] ?? 1}`),
    }));
    return {
      users: users.length > 0 ? users : [{ id: "1", label: "Wallos User 1" }],
      subscriptions,
      currencies: rowsById(selectRows(db, "currencies")),
      categories: rowsById(selectRows(db, "categories")),
      paymentMethods: rowsById(selectRows(db, "payment_methods")),
      members: rowsById(selectRows(db, "household")),
      logoFiles,
    };
  } finally {
    db.close();
  }
}

function selectRows(db: { exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }> }, table: string): WallosTableRow[] {
  try {
    const result = db.exec(`SELECT * FROM ${table}`);
    const first = result[0];
    if (!first) return [];
    return first.values.map((values) => Object.fromEntries(first.columns.map((column, index) => [column, values[index]])));
  } catch {
    return [];
  }
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function isSqliteBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  return new TextDecoder().decode(bytes.slice(0, 16)) === "SQLite format 3\0";
}
