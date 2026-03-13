// Image scaling helpers used by previews and export.
// Policy: when exporting (and for certain previews), the longest side must be 640px.

export type ScaledImage = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
};

export function fitToLongest(width: number, height: number, longest = 640) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { outW: 0, outH: 0, scale: 0 };
  }
  const scale = longest / Math.max(width, height);
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  return { outW, outH, scale };
}

// Canvas-based resample (preferred in browser). Falls back to nearest-neighbor CPU if canvas is unavailable.
export function resampleRgbaToSize(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  outW: number,
  outH: number
): ScaledImage {
  try {
    if (typeof document !== "undefined") {
      const src = document.createElement("canvas");
      src.width = Math.max(1, Math.floor(width));
      src.height = Math.max(1, Math.floor(height));
      const sctx = src.getContext("2d");
      if (!sctx) throw new Error("2d ctx");
      const srcData = new Uint8ClampedArray(width * height * 4);
      srcData.set(rgba.subarray(0, srcData.length));
      sctx.putImageData(new ImageData(srcData, width, height), 0, 0);
      const dst = document.createElement("canvas");
      dst.width = outW;
      dst.height = outH;
      const dctx = dst.getContext("2d");
      if (!dctx) throw new Error("2d ctx");
      dctx.imageSmoothingEnabled = true;
      dctx.imageSmoothingQuality = "high";
      dctx.drawImage(src, 0, 0, outW, outH);
      const out = dctx.getImageData(0, 0, outW, outH).data;
      return { rgba: out, width: outW, height: outH };
    }
  } catch {
    // fall through to CPU path
  }
  // Nearest-neighbor CPU fallback
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sx = width / outW;
  const sy = height / outH;
  for (let y = 0; y < outH; y++) {
    const iy = Math.min(height - 1, Math.floor(y * sy));
    for (let x = 0; x < outW; x++) {
      const ix = Math.min(width - 1, Math.floor(x * sx));
      const si = (iy * width + ix) * 4;
      const di = (y * outW + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: outW, height: outH };
}

export function resampleRgbaToLongest(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  longest = 640
): ScaledImage {
  const { outW, outH } = fitToLongest(width, height, longest);
  return resampleRgbaToSize(rgba, width, height, outW, outH);
}
