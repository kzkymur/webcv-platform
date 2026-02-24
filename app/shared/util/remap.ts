import { getFile } from "@/shared/db";

export type RemapXY = { xy: Float32Array; width: number; height: number };

export async function loadRemapXY(path: string): Promise<RemapXY | null> {
  const f = await getFile(path);
  if (!f || f.type !== "remapXY" || !f.width || !f.height) return null;
  const xy = new Float32Array(f.data);
  if (xy.length !== f.width * f.height * 2) return null;
  return { xy, width: f.width, height: f.height };
}

export function buildIdentityInterMap(width: number, height: number): Float32Array {
  const id = new Float32Array(width * height * 2);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      id[idx++] = x;
      id[idx++] = y;
    }
  }
  return id;
}

