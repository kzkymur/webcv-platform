import type { FileEntry } from "@/shared/db/types";

export function fileToRGBA(file: FileEntry): { rgba: Uint8ClampedArray; width: number; height: number } {
  const w = file.width ?? 0;
  const h = file.height ?? 0;
  const u8 = new Uint8ClampedArray(file.data);
  if (file.type === "grayscale-image") {
    if (file.channels === 4) return { rgba: u8, width: w, height: h };
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = u8[i];
      out[i * 4 + 0] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    return { rgba: out, width: w, height: h };
  }
  return { rgba: u8, width: w, height: h };
}

export function jsonFile(path: string, obj: any): FileEntry {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  return { path, type: "other", data: data.buffer as ArrayBuffer };
}

export function remapFile(path: string, arr: Float32Array, width: number, height: number): FileEntry {
  return { path, type: "remap", data: arr.buffer as ArrayBuffer, width, height, channels: 1 };
}

export function remapXYFile(
  path: string,
  mapX: Float32Array,
  mapY: Float32Array,
  width: number,
  height: number
): FileEntry {
  const n = width * height;
  if (mapX.length !== n || mapY.length !== n) {
    throw new Error(`remapXYFile: map sizes mismatch (got ${mapX.length}, ${mapY.length}, expected ${n})`);
  }
  const interleaved = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const j = i * 2;
    interleaved[j] = mapX[i];
    interleaved[j + 1] = mapY[i];
  }
  return { path, type: "remapXY", data: interleaved.buffer as ArrayBuffer, width, height, channels: 2 };
}
