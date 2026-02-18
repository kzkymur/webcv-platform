import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import type { FileEntry } from "./types";

let SQLP: Promise<SqlJsStatic> | null = null;
let db: Database | null = null;

const IDB_NAME = "galvoweb-sqlite";
const STORE = "dbfile";
const KEY = "main";

async function openIDB(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIDB(): Promise<Uint8Array | null> {
  const idb = await openIDB();
  return await new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const val = req.result as ArrayBuffer | undefined;
      resolve(val ? new Uint8Array(val) : null);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveToIDB(bytes: Uint8Array) {
  const idb = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(bytes, KEY);
  });
}

async function ensureDB(): Promise<Database> {
  if (db) return db;
  if (!SQLP) {
    SQLP = initSqlJs({
      locateFile: (f) => new URL("sql.js/dist/sql-wasm.wasm", import.meta.url).toString(),
    });
  }
  const SQL = await SQLP;
  const file = await loadFromIDB();
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

async function persist() {
  if (!db) return;
  const bytes = db.export();
  await saveToIDB(bytes);
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
  d.run(`DELETE FROM files WHERE path = ?`, [path]);
  await persist();
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
