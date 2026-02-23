export function fitWithinBox(
  width: number,
  height: number,
  max: number
): { w: number; h: number; scale: number } {
  const w = Math.max(1, width || 1);
  const h = Math.max(1, height || 1);
  const s = Math.min(max / w, max / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
}

