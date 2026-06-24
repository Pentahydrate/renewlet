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

type WorkerRequest = {
  id: number;
  buffer: ArrayBuffer;
  context: ImportBuildBaseContext;
  wallosUserId?: string;
};

type WorkerResponse =
  | { id: number; ok: true; prepared: PreparedImport }
  | { id: number; ok: false; error: string };

const WALLOS_TABLE_PAGE_SIZE = 500;
const WALLOS_TABLE_MAX_ROWS = 5000;

// Wallos 备份解析运行在专用 Worker 内；容量上限保护浏览器内存，也和服务端导入预览 5000 条上限对齐。
class WallosTableTooLargeError extends Error {
  constructor() {
    super(IMPORT_MESSAGE_CODES.wallosTableTooLarge);
  }
}

const WALLOS_TABLE_COLUMNS = {
  subscriptions: [
    "id",
    "user_id",
    "name",
    "price",
    "currency_id",
    "currency_code",
    "currency_symbol",
    "category_id",
    "category_name",
    "payment_method_id",
    "payment_method_name",
    "payer_user_id",
    "payer_user_name",
    "url",
    "logo",
    "start_date",
    "next_payment",
    "notes",
    "cycle",
    "frequency",
    "auto_renew",
    "inactive",
    "cancellation_date",
    "cancelation_date",
    "replacement_subscription_id",
    "notify",
    "notify_days_before",
  ],
  user: ["id", "name", "username", "email"],
  currencies: ["id", "code", "symbol"],
  categories: ["id", "name"],
  payment_methods: ["id", "name"],
  household: ["id", "name"],
} as const;
type WallosTableName = keyof typeof WALLOS_TABLE_COLUMNS;

/**
 * Worker 消息入口。
 *
 * 主线程只传 ArrayBuffer 和映射上下文；Worker 返回 PreparedImport，不直接访问网络或 Renewlet API。
 */
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

function selectRows(db: { exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }> }, table: WallosTableName): WallosTableRow[] {
  try {
    const availableColumns = selectExistingColumns(db, table);
    const selectedColumns = WALLOS_TABLE_COLUMNS[table].filter((column) => availableColumns.has(column));
    if (selectedColumns.length === 0) return [];
    const columns = selectedColumns.map(quoteSqlIdentifier).join(", ");
    const rows: WallosTableRow[] = [];
    for (let offset = 0; offset <= WALLOS_TABLE_MAX_ROWS; offset += WALLOS_TABLE_PAGE_SIZE) {
      const result = db.exec(`SELECT ${columns} FROM ${quoteSqlIdentifier(table)} LIMIT ${WALLOS_TABLE_PAGE_SIZE} OFFSET ${offset}`);
      const first = result[0];
      if (!first) return rows;
      rows.push(...first.values.map((values) => Object.fromEntries(first.columns.map((column, index) => [column, values[index]]))));
      if (rows.length > WALLOS_TABLE_MAX_ROWS) throw new WallosTableTooLargeError();
      if (first.values.length < WALLOS_TABLE_PAGE_SIZE) return rows;
    }
    throw new WallosTableTooLargeError();
  } catch (error) {
    if (error instanceof WallosTableTooLargeError) throw error;
    // Wallos 不同版本会缺少可选 lookup 表或列；容量上限之外的 SQL 结构差异降级为空表，保留可导入主订阅。
    return [];
  }
}

function selectExistingColumns(db: { exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }> }, table: WallosTableName): Set<string> {
  const result = db.exec(`PRAGMA table_info(${quoteSqlIdentifier(table)})`);
  const first = result[0];
  if (!first) return new Set();
  const nameIndex = first.columns.indexOf("name");
  if (nameIndex < 0) return new Set();
  return new Set(first.values.map((values) => String(values[nameIndex] ?? "")).filter(Boolean));
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function isSqliteBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  return new TextDecoder().decode(bytes.slice(0, 16)) === "SQLite format 3\0";
}
