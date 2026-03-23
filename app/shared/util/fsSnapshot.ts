import { deleteMany, flush, getFile, listFiles, putMany } from "@/shared/db";
import type { FileEntry, FileType } from "@/shared/db/types";

export type FsSnapshotProgress = {
  phase: "export" | "import";
  current: number;
  total: number;
  message: string;
  path?: string;
};

type JsonSnapshotEntry = {
  path: string;
  type: FileType;
  width?: number;
  height?: number;
  channels?: number;
  dataBase64: string;
};

type JsonSnapshotV1 = {
  schema: "gwfs-snapshot";
  version: 1;
  createdAt: string;
  entries: JsonSnapshotEntry[];
};

type BinarySnapshotEntry = {
  path: string;
  type: FileType;
  width?: number;
  height?: number;
  channels?: number;
  offset: number;
  length: number;
};

type BinarySnapshotManifestV1 = {
  schema: "gwfs-binary-snapshot";
  version: 1;
  createdAt: string;
  entries: BinarySnapshotEntry[];
};

type ExportFileMeta = {
  path: string;
  type: FileType;
  width?: number;
  height?: number;
  channels?: number;
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

const BINARY_MAGIC = "GWFSBIN1";
const BINARY_HEADER_SIZE = BINARY_MAGIC.length + 4;
const MAX_GZIP_BYTES = 128 * 1024 * 1024;

function isFileType(value: unknown): value is FileType {
  return typeof value === "string" && FILE_TYPE_SET.has(value);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

function parseJsonSnapshot(raw: unknown): JsonSnapshotV1 {
  if (!raw || typeof raw !== "object") throw new Error("invalid JSON snapshot payload");
  const obj = raw as Partial<JsonSnapshotV1>;
  if (obj.schema !== "gwfs-snapshot" || obj.version !== 1) {
    throw new Error("unsupported JSON snapshot format");
  }
  if (!Array.isArray(obj.entries)) throw new Error("invalid JSON snapshot entries");
  const entries = obj.entries.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`entry[${i}] is invalid`);
    const e = entry as Partial<JsonSnapshotEntry>;
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
    } satisfies JsonSnapshotEntry;
  });
  return {
    schema: "gwfs-snapshot",
    version: 1,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : "",
    entries,
  };
}

function parseBinaryManifest(raw: unknown): BinarySnapshotManifestV1 {
  if (!raw || typeof raw !== "object") throw new Error("invalid binary snapshot manifest");
  const obj = raw as Partial<BinarySnapshotManifestV1>;
  if (obj.schema !== "gwfs-binary-snapshot" || obj.version !== 1) {
    throw new Error("unsupported binary snapshot format");
  }
  if (!Array.isArray(obj.entries)) throw new Error("invalid binary snapshot entries");
  const entries = obj.entries.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`entry[${i}] is invalid`);
    const e = entry as Partial<BinarySnapshotEntry>;
    if (typeof e.path !== "string" || !e.path) throw new Error(`entry[${i}] path is invalid`);
    if (!isFileType(e.type)) throw new Error(`entry[${i}] type is invalid`);
    if (!Number.isInteger(e.offset) || (e.offset as number) < 0) throw new Error(`entry[${i}] offset is invalid`);
    if (!Number.isInteger(e.length) || (e.length as number) < 0) throw new Error(`entry[${i}] length is invalid`);
    return {
      path: e.path,
      type: e.type,
      width: typeof e.width === "number" ? e.width : undefined,
      height: typeof e.height === "number" ? e.height : undefined,
      channels: typeof e.channels === "number" ? e.channels : undefined,
      offset: e.offset as number,
      length: e.length as number,
    } satisfies BinarySnapshotEntry;
  });
  return {
    schema: "gwfs-binary-snapshot",
    version: 1,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : "",
    entries,
  };
}

function isGzip(buffer: ArrayBuffer): boolean {
  const u8 = new Uint8Array(buffer);
  return u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}

async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not available");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function isLikelyJson(buffer: ArrayBuffer): boolean {
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    return c === 0x7b || c === 0x5b;
  }
  return false;
}

function decodeBinarySnapshot(buffer: ArrayBuffer): FileEntry[] {
  if (buffer.byteLength < BINARY_HEADER_SIZE) throw new Error("binary snapshot header is too short");
  const u8 = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(u8.subarray(0, BINARY_MAGIC.length));
  if (magic !== BINARY_MAGIC) throw new Error("binary snapshot magic mismatch");
  const view = new DataView(buffer);
  const manifestLength = view.getUint32(BINARY_MAGIC.length, true);
  const manifestStart = BINARY_HEADER_SIZE;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestEnd > buffer.byteLength) throw new Error("binary snapshot manifest size is invalid");
  const manifestText = new TextDecoder().decode(u8.subarray(manifestStart, manifestEnd));
  const manifestRaw = JSON.parse(manifestText) as unknown;
  const manifest = parseBinaryManifest(manifestRaw);
  const payloadBase = manifestEnd;
  return manifest.entries.map((e, i) => {
    const start = payloadBase + e.offset;
    const end = start + e.length;
    if (end > buffer.byteLength) throw new Error(`entry[${i}] payload range is invalid`);
    return {
      path: e.path,
      type: e.type,
      width: e.width,
      height: e.height,
      channels: e.channels,
      data: buffer.slice(start, end),
    } satisfies FileEntry;
  });
}

async function decodeSnapshotEntries(file: File): Promise<FileEntry[]> {
  const raw = await file.arrayBuffer();
  const unpacked = isGzip(raw) ? await gunzip(raw) : raw;
  if (isLikelyJson(unpacked)) {
    const text = new TextDecoder().decode(new Uint8Array(unpacked));
    const json = parseJsonSnapshot(JSON.parse(text) as unknown);
    return json.entries.map((e) => ({
      path: e.path,
      type: e.type,
      width: e.width,
      height: e.height,
      channels: e.channels,
      data: fromBase64(e.dataBase64),
    }));
  }
  return decodeBinarySnapshot(unpacked);
}

function isNotReadableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === "NotReadableError") return true;
  return typeof e.message === "string" && e.message.includes("could not be read");
}

async function listFilesWithRetry(retry = 2): Promise<FileEntry[]> {
  for (let i = 0; ; i++) {
    try {
      return await listFiles();
    } catch (error: unknown) {
      if (!isNotReadableError(error) || i >= retry) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 80 * (i + 1)));
    }
  }
}

function buildBinaryContainerBlob(files: ExportFileMeta[], payloads: Uint8Array[]): Blob {
  let offset = 0;
  const entries: BinarySnapshotEntry[] = files.map((f, i) => {
    const bytes = payloads[i];
    const entry: BinarySnapshotEntry = {
      path: f.path,
      type: f.type,
      width: f.width,
      height: f.height,
      channels: f.channels,
      offset,
      length: bytes.byteLength,
    };
    offset += bytes.byteLength;
    return entry;
  });
  const manifest: BinarySnapshotManifestV1 = {
    schema: "gwfs-binary-snapshot",
    version: 1,
    createdAt: new Date().toISOString(),
    entries,
  };
  const encoder = new TextEncoder();
  const header = new Uint8Array(BINARY_HEADER_SIZE);
  header.set(encoder.encode(BINARY_MAGIC), 0);
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  new DataView(header.buffer).setUint32(BINARY_MAGIC.length, manifestBytes.byteLength, true);
  return new Blob(
    [header, manifestBytes, ...payloads.map((p) => p.buffer as ArrayBuffer)],
    { type: "application/octet-stream" }
  );
}

async function maybeGzip(
  blob: Blob,
  onProgress?: (p: FsSnapshotProgress) => void
): Promise<{ blob: Blob; compressed: boolean }> {
  if (blob.size > MAX_GZIP_BYTES) {
    onProgress?.({
      phase: "export",
      current: 0,
      total: 0,
      message: `skip gzip (snapshot too large: ${blob.size} bytes)`,
    });
    return { blob, compressed: false };
  }
  if (typeof CompressionStream === "undefined") {
    onProgress?.({
      phase: "export",
      current: 0,
      total: 0,
      message: "skip gzip (CompressionStream unavailable)",
    });
    return { blob, compressed: false };
  }
  onProgress?.({
    phase: "export",
    current: 0,
    total: 0,
    message: "Compressing snapshot",
  });
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).blob();
  onProgress?.({
    phase: "export",
    current: 0,
    total: 0,
    message: "gzip complete",
  });
  return { blob: compressed, compressed: true };
}

export async function createFileSystemSnapshotBlob(
  onProgress?: (p: FsSnapshotProgress) => void
): Promise<{ blob: Blob; compressed: boolean }> {
  await flush().catch(() => {});
  const files = (await listFilesWithRetry()).map((f) => ({
    path: f.path,
    type: f.type,
    width: f.width,
    height: f.height,
    channels: f.channels,
  }));
  onProgress?.({
    phase: "export",
    current: 0,
    total: files.length,
    message: `Preparing export for ${files.length} file(s)`,
  });

  const payloads: Uint8Array[] = [];
  for (let i = 0; i < files.length; i++) {
    const meta = files[i];
    const full = await getFile(meta.path);
    payloads.push(new Uint8Array(full?.data ?? new ArrayBuffer(0)));
    const current = i + 1;
    if (current === 1 || current === files.length || current % 20 === 0) {
      onProgress?.({
        phase: "export",
        current,
        total: files.length,
        path: meta.path,
        message: `Read ${current}/${files.length}: ${meta.path}`,
      });
    }
    if (current % 20 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  const raw = buildBinaryContainerBlob(files, payloads);
  return await maybeGzip(raw, onProgress);
}

export async function importFileSystemSnapshot(
  file: File,
  mode: "replace" | "merge" = "replace",
  onProgress?: (p: FsSnapshotProgress) => void
): Promise<{ imported: number; deleted: number }> {
  const entries = await decodeSnapshotEntries(file);
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
    if (done === 1 || done === total || done % 20 === 0) {
      onProgress?.({
        phase: "import",
        current: done,
        total,
        path: chunk[chunk.length - 1]?.path,
        message: `Imported ${done}/${total}`,
      });
    }
    if (done % 20 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { imported: total, deleted };
}
