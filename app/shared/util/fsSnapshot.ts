import { deleteMany, getFile, listFiles, putMany } from "@/shared/db";
import type { FileEntry, FileType } from "@/shared/db/types";

export type FsSnapshotProgress = {
  phase: "export" | "import";
  current: number;
  total: number;
  message: string;
  path?: string;
};

type SnapshotEntry = {
  path: string;
  type: FileType;
  width?: number;
  height?: number;
  channels?: number;
  dataBase64: string;
};

type SnapshotV1 = {
  schema: "gwfs-snapshot";
  version: 1;
  createdAt: string;
  entries: SnapshotEntry[];
};

const FILE_TYPE_SET: ReadonlySet<string> = new Set([
  "rgb-image",
  "grayscale-image",
  "optical-flow",
  "remap",
  "remapXY",
  "homography-json",
  "undist-json",
  "figure",
  "sequence",
  "other",
]);

function isFileType(value: unknown): value is FileType {
  return typeof value === "string" && FILE_TYPE_SET.has(value);
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const chunk = bytes.subarray(i, i + step);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

function parseSnapshot(raw: unknown): SnapshotV1 {
  if (!raw || typeof raw !== "object") throw new Error("invalid snapshot payload");
  const obj = raw as Partial<SnapshotV1>;
  if (obj.schema !== "gwfs-snapshot" || obj.version !== 1) {
    throw new Error("unsupported snapshot format");
  }
  if (!Array.isArray(obj.entries)) throw new Error("invalid snapshot entries");

  const entries: SnapshotEntry[] = obj.entries.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`entry[${i}] is invalid`);
    const e = entry as Partial<SnapshotEntry>;
    if (typeof e.path !== "string" || !e.path) throw new Error(`entry[${i}] path is invalid`);
    if (!isFileType(e.type)) throw new Error(`entry[${i}] type is invalid`);
    if (typeof e.dataBase64 !== "string") throw new Error(`entry[${i}] data is invalid`);
    return {
      path: e.path,
      type: e.type,
      width: typeof e.width === "number" ? e.width : undefined,
      height: typeof e.height === "number" ? e.height : undefined,
      channels: typeof e.channels === "number" ? e.channels : undefined,
      dataBase64: e.dataBase64,
    };
  });

  return {
    schema: "gwfs-snapshot",
    version: 1,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : "",
    entries,
  };
}

function shouldReport(index: number, total: number): boolean {
  return index === 1 || index === total || index % 20 === 0;
}

async function yieldMainThreadEvery(index: number, step = 20): Promise<void> {
  if (index % step !== 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function createFileSystemSnapshotBlob(
  onProgress?: (p: FsSnapshotProgress) => void
): Promise<Blob> {
  const metas = await listFiles();
  const entries: SnapshotEntry[] = [];
  onProgress?.({
    phase: "export",
    current: 0,
    total: metas.length,
    message: `Preparing export for ${metas.length} file(s)`,
  });
  for (const meta of metas) {
    const full = await getFile(meta.path);
    const data = full?.data ?? new ArrayBuffer(0);
    entries.push({
      path: meta.path,
      type: meta.type,
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      dataBase64: toBase64(data),
    });
    const current = entries.length;
    if (shouldReport(current, metas.length)) {
      onProgress?.({
        phase: "export",
        current,
        total: metas.length,
        path: meta.path,
        message: `Exported ${current}/${metas.length}: ${meta.path}`,
      });
    }
    await yieldMainThreadEvery(current);
  }
  const snapshot: SnapshotV1 = {
    schema: "gwfs-snapshot",
    version: 1,
    createdAt: new Date().toISOString(),
    entries,
  };
  return new Blob([JSON.stringify(snapshot)], { type: "application/json" });
}

export async function importFileSystemSnapshot(
  file: File,
  mode: "replace" | "merge" = "replace",
  onProgress?: (p: FsSnapshotProgress) => void
): Promise<{ imported: number; deleted: number }> {
  const text = await file.text();
  const raw = JSON.parse(text) as unknown;
  const snapshot = parseSnapshot(raw);

  const entries: FileEntry[] = snapshot.entries.map((e) => ({
    path: e.path,
    type: e.type,
    width: e.width,
    height: e.height,
    channels: e.channels,
    data: fromBase64(e.dataBase64),
  }));
  const total = entries.length;
  onProgress?.({
    phase: "import",
    current: 0,
    total,
    message: `Preparing import for ${total} file(s)`,
  });

  let deleted = 0;
  if (mode === "replace") {
    const current = await listFiles();
    const paths = current.map((f) => f.path);
    if (paths.length > 0) {
      onProgress?.({
        phase: "import",
        current: 0,
        total,
        message: `Deleting ${paths.length} existing file(s)`,
      });
      deleted = await deleteMany(paths);
    }
  }

  const chunkSize = 64;
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    if (chunk.length > 0) await putMany(chunk);
    const done = Math.min(total, i + chunk.length);
    if (shouldReport(done, total)) {
      onProgress?.({
        phase: "import",
        current: done,
        total,
        path: chunk[chunk.length - 1]?.path,
        message: `Imported ${done}/${total}`,
      });
    }
    await yieldMainThreadEvery(done);
  }
  return { imported: entries.length, deleted };
}
