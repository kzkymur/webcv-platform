import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import type { FileEntry } from "./types";
import { deleteBlobFromOPFS, readBlobFromOPFS, writeBlobToOPFS } from "@/shared/db/opfs-blob";

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
  // Ensure schema v2 (no BLOB column). If a legacy schema is detected, drop table and recreate.
  await ensureSchemaV2(db);
  return db;
}

// Serialize persistence to OPFS to avoid concurrent write races
let persistChain: Promise<void> = Promise.resolve();
let persistTimer: number | null = null;
function persistNow(): Promise<void> {
  if (!db) return Promise.resolve();
  persistChain = persistChain
    .then(async () => {
      const bytes = db!.export();
      await saveToOPFS(bytes);
    })
    .catch((e) => {
      // Reset the chain on failure so subsequent writes are not blocked
      persistChain = Promise.resolve();
      throw e;
    });
  return persistChain;
}

function schedulePersist(delayMs = 250): void {
  if (typeof window === "undefined") { void persistNow(); return; }
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    // @ts-ignore – setTimeout in DOM returns number
    persistTimer = null;
  }
  // @ts-ignore – setTimeout in DOM returns number
  persistTimer = window.setTimeout(() => {
    // @ts-ignore
    persistTimer = null;
    void persistNow();
  }, delayMs);
}

// Flush on page hide to avoid losing recent writes
if (typeof window !== "undefined") {
  const flush = () => { if (persistTimer !== null) { clearTimeout(persistTimer); persistTimer = null; } void persistNow(); };
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
}

export async function putFile(entry: FileEntry): Promise<void> {
  const d = await ensureDB();
  // Write blob first if provided
  if (entry.data) await writeBlobToOPFS(entry.path, new Uint8Array(entry.data));
  // Upsert metadata
  const stmt = d.prepare(`INSERT INTO files(path, type, width, height, channels)
                          VALUES (?, ?, ?, ?, ?)
                          ON CONFLICT(path) DO UPDATE SET
                            type=excluded.type,
                            width=excluded.width,
                            height=excluded.height,
                            channels=excluded.channels`);
  try {
    stmt.run([
      entry.path,
      entry.type,
      entry.width ?? null,
      entry.height ?? null,
      entry.channels ?? null,
    ]);
  } finally {
    stmt.free();
  }
  // Notify immediately (DB state is already updated in-memory), persist lazily
  notify("put", [entry.path]);
  schedulePersist();
}

export async function putMany(entries: FileEntry[]): Promise<void> {
  if (!entries.length) return;
  const d = await ensureDB();
  // 1) Write all blobs to OPFS first (metadata-only updates allowed if data omitted)
  for (const e of entries) {
    if (e.data) await writeBlobToOPFS(e.path, new Uint8Array(e.data));
  }
  // 2) Upsert metadata in a single transaction
  d.run("BEGIN TRANSACTION");
  try {
    const stmt = d.prepare(`INSERT INTO files(path, type, width, height, channels)
                            VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(path) DO UPDATE SET
                              type=excluded.type,
                              width=excluded.width,
                              height=excluded.height,
                              channels=excluded.channels`);
    try {
      for (const e of entries) {
        stmt.run([
          e.path,
          e.type,
          e.width ?? null,
          e.height ?? null,
          e.channels ?? null,
        ]);
      }
    } finally {
      stmt.free();
    }
    d.run("COMMIT");
  } catch (e) {
    try { d.run("ROLLBACK"); } catch {}
    throw e;
  }
  notify("batch", entries.map((e) => e.path));
  schedulePersist();
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
  // Best-effort: remove blobs too
  for (const p of paths) {
    await deleteBlobFromOPFS(p);
  }
  notify("batch", paths);
  schedulePersist();
  return affected;
}

export async function getFile(path: string): Promise<FileEntry | undefined> {
  const d = await ensureDB();
  const stmt = d.prepare(`SELECT path, type, width, height, channels FROM files WHERE path = ?`);
  try {
    stmt.bind([path]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      const buf = await readBlobFromOPFS(path);
      return {
        path: row["path"] as string,
        type: row["type"] as any,
        data: buf || undefined,
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
  // Best-effort blob delete
  await deleteBlobFromOPFS(path);
  notify("delete", [path]);
  schedulePersist();
}

export async function listFiles(): Promise<FileEntry[]> {
  const d = await ensureDB();
  // metadata-only listing (no BLOBs in schema v2)
  const stmt = d.prepare(`SELECT path, type, width, height, channels FROM files ORDER BY path`);
  const out: FileEntry[] = [];
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        path: row["path"] as string,
        type: row["type"] as any,
        // data intentionally omitted for listings
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

// Optional explicit flush for callers that need durability before proceeding
export async function flush(): Promise<void> {
  if (persistTimer !== null) { clearTimeout(persistTimer); persistTimer = null; }
  await persistNow();
}

// Ensure v2 schema; drop legacy table if found (no data migration)
async function ensureSchemaV2(d: Database): Promise<void> {
  try {
    // Check existing columns
    const stmt = d.prepare(`PRAGMA table_info(files)`);
    const cols: string[] = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        cols.push((row["name"] as string) || "");
      }
    } finally {
      stmt.free();
    }
    if (cols.length > 0 && cols.includes("data")) {
      // Legacy schema: drop table (metadata only will be rebuilt by app logic)
      d.run(`DROP TABLE files`);
      try { d.run("VACUUM"); } catch {}
      try { await persistNow(); } catch {}
    }
  } catch {
    // ignore: table may not exist
  }
  // Create v2 table if missing
  d.run(`CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    channels INTEGER
  );`);
}
