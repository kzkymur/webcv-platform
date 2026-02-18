// DB facade: uses SQLite Wasm when available and enabled, otherwise IndexedDB.
import * as idb from "./indexeddb";
import type { FileEntry } from "./types";

const useSQLiteFlag = typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_USE_SQLITE_WASM === "1";

type Driver = {
  putFile: (e: FileEntry) => Promise<void>;
  getFile: (p: string) => Promise<FileEntry | undefined>;
  deleteFile: (p: string) => Promise<void>;
  listFiles: () => Promise<FileEntry[]>;
};

let driver: Driver | null = null;

async function ensureDriver(): Promise<Driver> {
  if (!useSQLiteFlag) return idb as unknown as Driver;
  if (driver) return driver;
  try {
    const sqlite = await import("./sqlite-driver");
    driver = sqlite as unknown as Driver;
    return driver;
  } catch (e) {
    console.warn("SQLite Wasm unavailable, falling back to IndexedDB", e);
    return (idb as unknown) as Driver;
  }
}

export async function putFile(e: FileEntry) {
  const d = await ensureDriver();
  return d.putFile(e);
}
export async function getFile(p: string) {
  const d = await ensureDriver();
  return d.getFile(p);
}
export async function deleteFile(p: string) {
  const d = await ensureDriver();
  return d.deleteFile(p);
}
export async function listFiles() {
  const d = await ensureDriver();
  return d.listFiles();
}
