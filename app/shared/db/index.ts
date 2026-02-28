// Single backend: SQLite WASM + OPFS persistence
import type { FileEntry } from "./types";

type Driver = {
  putFile: (e: FileEntry) => Promise<void>;
  putMany?: (arr: FileEntry[]) => Promise<void>;
  getFile: (p: string) => Promise<FileEntry | undefined>;
  deleteFile: (p: string) => Promise<void>;
  deleteMany?: (paths: string[]) => Promise<number>;
  listFiles: () => Promise<FileEntry[]>;
  flush?: () => Promise<void>;
};

let driverP: Promise<Driver> | null = null;
async function ensureDriver(): Promise<Driver> {
  if (driverP) return driverP;
  driverP = (async () => {
    const sqlite = await import("./sqlite-driver");
    return sqlite as unknown as Driver;
  })();
  return driverP;
}

export async function putFile(e: FileEntry) {
  return (await ensureDriver()).putFile(e);
}
export async function putMany(arr: FileEntry[]) {
  const d = await ensureDriver();
  if (typeof d.putMany === "function") return d.putMany(arr);
  // Fallback: sequential puts
  for (const e of arr) await d.putFile(e);
}
export async function getFile(p: string) {
  return (await ensureDriver()).getFile(p);
}
export async function deleteFile(p: string) {
  return (await ensureDriver()).deleteFile(p);
}
export async function deleteMany(paths: string[]) {
  const d = await ensureDriver();
  if (typeof d.deleteMany === "function") return d.deleteMany(paths);
  // Fallback: sequential deletes
  let n = 0;
  for (const p of paths) {
    await d.deleteFile(p);
    n++;
  }
  return n;
}
export async function listFiles() {
  return (await ensureDriver()).listFiles();
}
export async function flush() {
  const d = await ensureDriver();
  if (typeof d.flush === "function") return d.flush();
}
