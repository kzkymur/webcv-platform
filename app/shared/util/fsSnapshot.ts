import { deleteMany, getFile, listFiles, putMany } from "@/shared/db";
import type { FileEntry, FileType } from "@/shared/db/types";

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

export async function createFileSystemSnapshotBlob(): Promise<Blob> {
  const metas = await listFiles();
  const entries: SnapshotEntry[] = [];
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
  mode: "replace" | "merge" = "replace"
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

  let deleted = 0;
  if (mode === "replace") {
    const current = await listFiles();
    const paths = current.map((f) => f.path);
    if (paths.length > 0) {
      deleted = await deleteMany(paths);
    }
  }

  if (entries.length > 0) await putMany(entries);
  return { imported: entries.length, deleted };
}
