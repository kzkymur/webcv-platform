import type { FileEntry } from "@/shared/db/types";
import { fileToRGBA } from "@/shared/util/fileEntry";

const JSON_TYPES = new Set([
  "homography-json",
  "undist-json",
  "figure",
  "sequence",
]);

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function replaceExt(name: string, ext: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return `${name}${ext}`;
  return `${name.slice(0, i)}${ext}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function rgbaToPngBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("PNG encoding failed"));
      resolve(blob);
    }, "image/png");
  });
}

function isJsonLike(file: FileEntry): boolean {
  if (file.path.toLowerCase().endsWith(".json")) return true;
  return JSON_TYPES.has(file.type);
}

export async function exportFileEntry(file: FileEntry): Promise<void> {
  if (!file.data) throw new Error("file has no payload");

  const name = baseName(file.path);
  if (file.type === "rgb-image" || file.type === "grayscale-image") {
    const { rgba, width, height } = fileToRGBA(file);
    if (width <= 0 || height <= 0) throw new Error("invalid image size");
    const png = await rgbaToPngBlob(rgba, width, height);
    const pngName = replaceExt(name, ".png");
    downloadBlob(png, pngName);
    return;
  }

  const mime = isJsonLike(file) ? "application/json" : "application/octet-stream";
  downloadBlob(new Blob([file.data], { type: mime }), name);
}
