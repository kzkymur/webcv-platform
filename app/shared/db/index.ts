// Single backend: SQLite WASM + OPFS persistence
import type { FileEntry } from "./types";

type Driver = {
  putFile: (e: FileEntry) => Promise<void>;
  getFile: (p: string) => Promise<FileEntry | undefined>;
  deleteFile: (p: string) => Promise<void>;
  deleteMany?: (paths: string[]) => Promise<number>;
  listFiles: () => Promise<FileEntry[]>;
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
