// OPFS helpers for storing binary payloads per file path.
// Layout: navigator.storage.getDirectory()/galvoweb/data/<path>

const OPFS_DIR = "galvoweb";
const DATA_SUBDIR = "data";

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root: FileSystemDirectoryHandle = await (navigator as any).storage.getDirectory();
  return root;
}

async function ensureDir(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  // @ts-ignore lib.dom types may lag behind
  return await parent.getDirectoryHandle(name, { create: true });
}

async function getDataRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await getOpfsRoot();
  const app = await ensureDir(root, OPFS_DIR);
  const data = await ensureDir(app, DATA_SUBDIR);
  return data;
}

function splitPath(p: string): { dir: string[]; name: string } {
  const parts = p.split("/").filter(Boolean);
  const name = parts.pop() || "";
  return { dir: parts, name };
}

async function ensureDirPath(root: FileSystemDirectoryHandle, parts: string[]): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const part of parts) {
    cur = await ensureDir(cur, part);
  }
  return cur;
}

export async function writeBlobToOPFS(path: string, bytes: Uint8Array): Promise<void> {
  const root = await getDataRoot();
  const { dir, name } = splitPath(path);
  const parent = await ensureDirPath(root, dir);
  // @ts-ignore
  const fh: FileSystemFileHandle = await parent.getFileHandle(name, { create: true });
  // @ts-ignore
  const w: FileSystemWritableFileStream = await fh.createWritable({ keepExistingData: false });
  try {
    await w.write(new Blob([bytes]));
  } finally {
    await w.close();
  }
}

export async function readBlobFromOPFS(path: string): Promise<ArrayBuffer | null> {
  try {
    const root = await getDataRoot();
    const { dir, name } = splitPath(path);
    const parent = await ensureDirPath(root, dir);
    // @ts-ignore
    const fh: FileSystemFileHandle = await parent.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch (e: any) {
    // NotFoundError etc.
    return null;
  }
}

export async function deleteBlobFromOPFS(path: string): Promise<void> {
  try {
    const root = await getDataRoot();
    const { dir, name } = splitPath(path);
    const parent = await ensureDirPath(root, dir);
    // @ts-ignore
    await parent.removeEntry(name, { recursive: false });
  } catch {
    // ignore missing
  }
}

export async function blobExistsInOPFS(path: string): Promise<boolean> {
  const buf = await readBlobFromOPFS(path);
  return !!buf;
}

