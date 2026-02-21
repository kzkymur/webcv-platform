import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import type { FileEntry } from "./types";

let SQLP: Promise<SqlJsStatic> | null = null;
let db: Database | null = null;

// Simple change notification (same-tab + cross-tab)
type FileChangeOp = "put" | "delete" | "batch";
const bc: BroadcastChannel | null =
  typeof window !== "undefined" && (window as any).BroadcastChannel
    ? new BroadcastChannel("gw-files")
    : null;
function notify(op: FileChangeOp, paths: string[]) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("gw:files:update", { detail: { op, paths } })
    );
  }
  bc?.postMessage({ op, paths });
}

// OPFS storage (Origin Private File System)
const OPFS_DIR = "galvoweb";
const OPFS_FILE = "files.sqlite";

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  // `navigator.storage.getDirectory()` is the OPFS entry point
  const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory();
  return root;
}

async function ensureDir(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  // create = true makes it idempotent
  // @ts-ignore – TS lib may lag behind spec
  return await parent.getDirectoryHandle(name, { create: true });
}

async function getDbFileHandle(create: boolean): Promise<FileSystemFileHandle | null> {
  const root = await getOpfsRoot();
  const dir = await ensureDir(root, OPFS_DIR);
  try {
    // @ts-ignore
    return await dir.getFileHandle(OPFS_FILE, { create });
  } catch (e: any) {
    if (!create && (e?.name === "NotFoundError" || e?.code === 8)) return null;
    throw e;
  }
}

async function loadFromOPFS(): Promise<Uint8Array | null> {
  const fh = await getDbFileHandle(false);
  if (!fh) return null;
  const file = await fh.getFile();
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

async function saveToOPFS(bytes: Uint8Array) {
  const fh = (await getDbFileHandle(true))!;
  // @ts-ignore: older TS lib.dom types might not include options
  const w: FileSystemWritableFileStream = await fh.createWritable({ keepExistingData: false });
  try {
    await w.seek(0);
    await w.write(new Blob([bytes]));
    await w.truncate(bytes.length);
  } finally {
    await w.close();
  }
}

async function ensureDB(): Promise<Database> {
  if (db) return db;
  if (!SQLP) {
    SQLP = initSqlJs({
      locateFile: (f) => new URL("sql.js/dist/sql-wasm.wasm", import.meta.url).toString(),
    });
  }
  const SQL = await SQLP;
  const file = await loadFromOPFS();
  db = file ? new SQL.Database(file) : new SQL.Database();
  // schema
  db.run(`CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data BLOB NOT NULL,
    width INTEGER,
    height INTEGER,
    channels INTEGER
  );`);
  return db;
}

// Serialize persistence to OPFS to avoid concurrent write races
let persistChain: Promise<void> = Promise.resolve();
function persist(): Promise<void> {
  if (!db) return Promise.resolve();
  persistChain = persistChain.then(async () => {
    const bytes = db!.export();
    await saveToOPFS(bytes);
  }).catch((e) => {
    // Reset the chain on failure so subsequent writes are not blocked
    persistChain = Promise.resolve();
    throw e;
  });
  return persistChain;
}

export async function putFile(entry: FileEntry): Promise<void> {
  const d = await ensureDB();
  const stmt = d.prepare(`INSERT INTO files(path, type, data, width, height, channels)
                          VALUES (?, ?, ?, ?, ?, ?)
                          ON CONFLICT(path) DO UPDATE SET
                            type=excluded.type,
                            data=excluded.data,
                            width=excluded.width,
                            height=excluded.height,
                            channels=excluded.channels`);
  try {
    stmt.run([
      entry.path,
      entry.type,
      new Uint8Array(entry.data),
      entry.width ?? null,
      entry.height ?? null,
      entry.channels ?? null,
    ]);
  } finally {
    stmt.free();
  }
  await persist();
  notify("put", [entry.path]);
}

export async function deleteMany(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const d = await ensureDB();
  d.run("BEGIN TRANSACTION");
  let affected = 0;
  try {
    const stmt = d.prepare(`DELETE FROM files WHERE path = ?`);
    try {
      for (const p of paths) {
        stmt.run([p]);
        // Count changes after each run
        // @ts-ignore sql.js exposes getRowsModified
        const c = typeof d.getRowsModified === "function" ? d.getRowsModified() : 1;
        affected += c;
      }
    } finally {
      stmt.free();
    }
    d.run("COMMIT");
  } catch (e) {
    try { d.run("ROLLBACK"); } catch {}
    throw e;
  }
  await persist();
  notify("batch", paths);
  return affected;
}

export async function getFile(path: string): Promise<FileEntry | undefined> {
  const d = await ensureDB();
  const stmt = d.prepare(`SELECT path, type, data, width, height, channels FROM files WHERE path = ?`);
  try {
    stmt.bind([path]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      const data = row["data"] as Uint8Array;
      const view = data.slice();
      return {
        path: row["path"] as string,
        type: row["type"] as any,
        data: view.buffer as ArrayBuffer,
        width: (row["width"] as number) ?? undefined,
        height: (row["height"] as number) ?? undefined,
        channels: (row["channels"] as number) ?? undefined,
      };
    }
  } finally {
    stmt.free();
  }
  return undefined;
}

export async function deleteFile(path: string): Promise<void> {
  const d = await ensureDB();
  const stmt = d.prepare(`DELETE FROM files WHERE path = ?`);
  try {
    stmt.run([path]);
  } finally {
    stmt.free();
  }
  await persist();
  notify("delete", [path]);
}

export async function listFiles(): Promise<FileEntry[]> {
  const d = await ensureDB();
  const stmt = d.prepare(`SELECT path, type, data, width, height, channels FROM files ORDER BY path`);
  const out: FileEntry[] = [];
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const blob = row["data"] as Uint8Array;
      const view = blob.slice();
      out.push({
        path: row["path"] as string,
        type: row["type"] as any,
        data: view.buffer as ArrayBuffer,
        width: (row["width"] as number) ?? undefined,
        height: (row["height"] as number) ?? undefined,
        channels: (row["channels"] as number) ?? undefined,
      });
    }
  } finally {
    stmt.free();
  }
  return out;
}
