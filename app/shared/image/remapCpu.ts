export function applyRemapXYBilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  xy: Float32Array
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = (y * width + x) * 2;
      const sx = xy[j];
      const sy = xy[j + 1];
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(height - 1, Math.floor(sy)));
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const dx = Math.min(1, Math.max(0, sx - x0));
      const dy = Math.min(1, Math.max(0, sy - y0));
      const p00 = (y0 * row + x0 * 4) | 0;
      const p10 = (y0 * row + x1 * 4) | 0;
      const p01 = (y1 * row + x0 * 4) | 0;
      const p11 = (y1 * row + x1 * 4) | 0;
      const k = (y * row + x * 4) | 0;
      for (let c = 0; c < 4; c++) {
        const v =
          (1 - dx) * (1 - dy) * src[p00 + c] +
          dx * (1 - dy) * src[p10 + c] +
          (1 - dx) * dy * src[p01 + c] +
          dx * dy * src[p11 + c];
        dst[k + c] = v | 0;
      }
    }
  }
  return dst;
}

