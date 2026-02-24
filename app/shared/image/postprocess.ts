export type PostProcessOp =
  | { type: "contrast"; slope: number } // slope 0..3, 1 preserves original
  | { type: "invert"; enabled?: boolean };

export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const r = rgba[si];
      const g = rgba[si + 1];
      const b = rgba[si + 2];
      gray[y * width + x] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    }
  }
  return gray;
}

export function grayToRgba(gray: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const v = gray[i];
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

export function applyPostOpsGray(
  input: Uint8ClampedArray,
  _w: number,
  _h: number,
  ops: PostProcessOp[]
): Uint8ClampedArray {
  if (!ops || ops.length === 0) return input;
  let buf = new Uint8ClampedArray(input); // work on a copy
  for (const op of ops) {
    if (op.type === "contrast") {
      const slope = clampRange(op.slope ?? 1, 0, 3);
      if (Math.abs(slope - 1) < 1e-6) continue;
      const mid = 128;
      const out = new Uint8ClampedArray(buf.length);
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        const c = mid + slope * (v - mid);
        out[i] = clamp8(Math.round(c));
      }
      buf = out;
    } else if (op.type === "invert") {
      if (op.enabled === false) continue;
      const out = new Uint8ClampedArray(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = 255 - buf[i];
      buf = out;
    }
  }
  return buf;
}

export function applyPostOpsRgbaViaGray(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  ops: PostProcessOp[]
): Uint8ClampedArray {
  if (!ops || ops.length === 0) return rgba;
  const gray = rgbaToGray(rgba, width, height);
  const adj = applyPostOpsGray(gray, width, height, ops);
  return grayToRgba(adj);
}

function clamp8(x: number) {
  return x < 0 ? 0 : x > 255 ? 255 : x | 0;
}

function clampRange(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

