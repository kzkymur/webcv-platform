// Scan strategies and interfaces for figure traversal

export type XY = { x: number; y: number };

export interface ScanContext {
  pointsGalvo: number[]; // [x1,y1,x2,y2,...] in galvo plane
}

export interface ScanStrategy {
  key: string; // e.g., 'outline'
  label: string; // UI label
  // Returns galvo XY at local time (seconds) within [0,durationSec]
  positionAt(ctx: ScanContext, tSec: number, durationSec: number): XY | null;
}

const DEFAULT_RASTER_ROWS = 48;
const GRID_DIV = 3;
const GRID_CENTER_IN_ORDER = [1, 9, 2, 8, 3, 7, 4, 6, 5] as const;
const DEFAULT_INWARD_OUTLINE_LOOPS = 8;

// Helper: perimeter and cumulative lengths for a closed polygon
function buildPerimeter(points: number[]): { total: number; cum: number[]; verts: XY[] } {
  const verts: XY[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) verts.push({ x: points[i], y: points[i + 1] });
  if (verts.length < 2) return { total: 0, cum: [], verts };
  let total = 0;
  const cum: number[] = [0];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]; const b = verts[(i + 1) % verts.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  return { total, cum, verts };
}

function normalizeLoopPhase(tSec: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  const m = tSec % durationSec;
  const wrapped = m < 0 ? m + durationSec : m;
  return Math.max(0, Math.min(1, wrapped / durationSec));
}

function samplePerimeterAtProgress(
  perimeter: { total: number; cum: number[]; verts: XY[] },
  progress: number,
): XY | null {
  const { total, cum, verts } = perimeter;
  if (verts.length === 0 || total <= 0) return null;

  const wrapped = progress - Math.floor(progress);
  const p = Math.max(0, Math.min(1, wrapped));
  const d = p * total;
  let seg = 0;
  while (seg + 1 < cum.length && cum[seg + 1] < d) seg++;
  const a = verts[seg % verts.length];
  const b = verts[(seg + 1) % verts.length];
  const segLen = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
  const segStart = cum[seg];
  const u = Math.max(0, Math.min(1, (d - segStart) / segLen));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function buildPolyline(points: XY[]): { total: number; cum: number[] } {
  if (points.length < 2) return { total: 0, cum: [] };
  let total = 0;
  const cum: number[] = [0];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  return { total, cum };
}

function dedupePath(points: XY[], eps = 1e-6): XY[] {
  if (points.length <= 1) return points.slice();
  const out: XY[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = out[out.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p);
  }
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) out.pop();
  }
  return out;
}

function clipAgainstEdge(
  input: XY[],
  inside: (p: XY) => boolean,
  intersect: (a: XY, b: XY) => XY,
): XY[] {
  if (input.length === 0) return [];
  const out: XY[] = [];
  let s = input[input.length - 1];
  let sInside = inside(s);
  for (const e of input) {
    const eInside = inside(e);
    if (eInside) {
      if (!sInside) out.push(intersect(s, e));
      out.push(e);
    } else if (sInside) {
      out.push(intersect(s, e));
    }
    s = e;
    sInside = eInside;
  }
  return dedupePath(out);
}

function clipPolygonToRect(
  polygon: XY[],
  rect: { left: number; right: number; top: number; bottom: number },
): XY[] {
  const vertical = (a: XY, b: XY, x: number): XY => {
    const dx = b.x - a.x;
    if (Math.abs(dx) <= 1e-9) return { x, y: a.y };
    const t = (x - a.x) / dx;
    return { x, y: a.y + (b.y - a.y) * t };
  };
  const horizontal = (a: XY, b: XY, y: number): XY => {
    const dy = b.y - a.y;
    if (Math.abs(dy) <= 1e-9) return { x: a.x, y };
    const t = (y - a.y) / dy;
    return { x: a.x + (b.x - a.x) * t, y };
  };

  let out = dedupePath(polygon);
  out = clipAgainstEdge(out, (p) => p.x >= rect.left, (a, b) => vertical(a, b, rect.left));
  out = clipAgainstEdge(out, (p) => p.x <= rect.right, (a, b) => vertical(a, b, rect.right));
  out = clipAgainstEdge(out, (p) => p.y >= rect.top, (a, b) => horizontal(a, b, rect.top));
  out = clipAgainstEdge(out, (p) => p.y <= rect.bottom, (a, b) => horizontal(a, b, rect.bottom));
  return dedupePath(out);
}

function samplePathPosition(path: XY[], tSec: number, durationSec: number): XY | null {
  if (durationSec <= 0 || path.length < 2) return null;
  const { total, cum } = buildPolyline(path);
  if (total <= 0) return null;

  const p = Math.max(0, Math.min(1, (tSec % durationSec) / durationSec));
  const d = p * total;
  let seg = 0;
  while (seg + 1 < cum.length && cum[seg + 1] < d) seg++;
  const a = path[seg];
  const b = path[Math.min(seg + 1, path.length - 1)];
  const segLen = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
  const segStart = cum[seg];
  const u = Math.max(0, Math.min(1, (d - segStart) / segLen));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function buildOutlineInwardPath(points: number[], loops = DEFAULT_INWARD_OUTLINE_LOOPS): XY[] {
  const verts: XY[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) verts.push({ x: points[i], y: points[i + 1] });
  if (verts.length < 3) return [];

  const n = verts.length;
  let cx = 0;
  let cy = 0;
  for (const v of verts) {
    cx += v.x;
    cy += v.y;
  }
  cx /= n;
  cy /= n;

  const loopCount = Math.max(1, Math.floor(loops));
  const path: XY[] = [];
  for (let loop = 0; loop < loopCount; loop++) {
    const scale = Math.max(0, (loopCount - loop) / loopCount);
    const ring: XY[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = verts[i];
      ring[i] = { x: cx + (v.x - cx) * scale, y: cy + (v.y - cy) * scale };
    }
    if (ring.length < 2) continue;
    if (path.length > 0) path.push(ring[0]);
    path.push(...ring);
    path.push(ring[0]); // one closed outline per inward loop
  }

  path.push({ x: cx, y: cy });
  return dedupePath(path);
}

function sampleDualPhasePath(path: XY[], tSec: number, durationSec: number): XY | null {
  if (durationSec <= 0 || path.length < 2) return null;
  const phase = normalizeLoopPhase(tSec, durationSec);
  const lead = samplePathPosition(path, phase, 1);
  const opposite = samplePathPosition(path, phase + 0.5, 1);
  if (!lead) return opposite;
  if (!opposite) return lead;

  const switchSlots = Math.max(2, path.length * 16);
  const lane = Math.floor(phase * switchSlots) % 2;
  return lane === 0 ? lead : opposite;
}

function buildRasterPath(points: number[], rows = DEFAULT_RASTER_ROWS): XY[] {
  const verts: XY[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) verts.push({ x: points[i], y: points[i + 1] });
  if (verts.length < 3) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return [];
  if (maxY - minY <= 1e-6 || maxX - minX <= 1e-6) return [];

  const rowCount = Math.max(2, Math.floor(rows));
  const path: XY[] = [];
  for (let row = 0; row < rowCount; row++) {
    const v = rowCount === 1 ? 0 : row / (rowCount - 1);
    const y = minY + (maxY - minY) * v;
    const xs: number[] = [];
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + (b.x - a.x) * t);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);

    const segs: Array<{ x0: number; x1: number }> = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      if (x1 - x0 > 1e-6) segs.push({ x0, x1 });
    }
    if (segs.length === 0) continue;

    if (row % 2 === 0) {
      for (const seg of segs) {
        path.push({ x: seg.x0, y });
        path.push({ x: seg.x1, y });
      }
    } else {
      for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i];
        path.push({ x: seg.x1, y });
        path.push({ x: seg.x0, y });
      }
    }
  }
  return path;
}

function buildGridRasterInwardPath(points: number[]): XY[] {
  const verts: XY[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) verts.push({ x: points[i], y: points[i + 1] });
  if (verts.length < 3) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return [];
  if (maxX - minX <= 1e-6 || maxY - minY <= 1e-6) return [];

  const stepX = (maxX - minX) / GRID_DIV;
  const stepY = (maxY - minY) / GRID_DIV;
  const byIndex = new Map<number, XY[]>();

  for (let row = 0; row < GRID_DIV; row++) {
    const top = minY + stepY * row;
    const bottom = row === GRID_DIV - 1 ? maxY : minY + stepY * (row + 1);
    for (let col = 0; col < GRID_DIV; col++) {
      const left = minX + stepX * col;
      const right = col === GRID_DIV - 1 ? maxX : minX + stepX * (col + 1);
      const index = row * GRID_DIV + col + 1;
      const clipped = clipPolygonToRect(verts, { left, right, top, bottom });
      if (clipped.length < 3) continue;

      const flat: number[] = [];
      for (const p of clipped) flat.push(p.x, p.y);
      const segmentPath = buildRasterPath(flat);
      if (segmentPath.length >= 2) byIndex.set(index, segmentPath);
    }
  }

  const merged: XY[] = [];
  for (const index of GRID_CENTER_IN_ORDER) {
    const segmentPath = byIndex.get(index);
    if (!segmentPath || segmentPath.length < 2) continue;
    if (merged.length === 0) {
      merged.push(...segmentPath);
      continue;
    }
    const last = merged[merged.length - 1];
    const firstSeg = segmentPath[0];
    const lastSeg = segmentPath[segmentPath.length - 1];
    const distToFirst = Math.hypot(last.x - firstSeg.x, last.y - firstSeg.y);
    const distToLast = Math.hypot(last.x - lastSeg.x, last.y - lastSeg.y);
    if (distToLast < distToFirst) {
      for (let i = segmentPath.length - 1; i >= 0; i--) merged.push(segmentPath[i]);
    } else {
      merged.push(...segmentPath);
    }
  }
  return merged;
}

export const OutlineStrategy: ScanStrategy = {
  key: 'outline',
  label: 'Outline (loop edges)',
  positionAt(ctx, tSec, durationSec) {
    if (durationSec <= 0) return null;
    const perimeter = buildPerimeter(ctx.pointsGalvo);
    const phase = normalizeLoopPhase(tSec, durationSec);
    return samplePerimeterAtProgress(perimeter, phase);
  },
};

export const RasterLoopEdgesStrategy: ScanStrategy = {
  key: 'raster-loop-edges',
  label: 'Raster (loop edges)',
  positionAt(ctx, tSec, durationSec) {
    if (durationSec <= 0) return null;
    const perimeter = buildPerimeter(ctx.pointsGalvo);
    if (perimeter.verts.length === 0 || perimeter.total <= 0) return null;

    const phase = normalizeLoopPhase(tSec, durationSec);
    const lead = samplePerimeterAtProgress(perimeter, phase);
    const opposite = samplePerimeterAtProgress(perimeter, phase + 0.5);
    if (!lead) return opposite;
    if (!opposite) return lead;

    // Interleave two opposite-phase loops to emulate dual-start edge scanning.
    const switchSlots = Math.max(2, perimeter.verts.length * 64);
    const lane = Math.floor(phase * switchSlots) % 2;
    return lane === 0 ? lead : opposite;
  },
};

export const OutlineInward8Strategy: ScanStrategy = {
  key: 'outline-inward-8',
  label: 'Outline (inward x8)',
  positionAt(ctx, tSec, durationSec) {
    const path = buildOutlineInwardPath(ctx.pointsGalvo, 8);
    return samplePathPosition(path, tSec, durationSec);
  },
};

export const RasterLoopEdgesInward8Strategy: ScanStrategy = {
  key: 'raster-loop-edges-inward-8',
  label: 'Raster (loop edges inward x8)',
  positionAt(ctx, tSec, durationSec) {
    const path = buildOutlineInwardPath(ctx.pointsGalvo, 8);
    return sampleDualPhasePath(path, tSec, durationSec);
  },
};

export const OutlineInward4Strategy: ScanStrategy = {
  key: 'outline-inward-4',
  label: 'Outline (inward x4)',
  positionAt(ctx, tSec, durationSec) {
    const path = buildOutlineInwardPath(ctx.pointsGalvo, 4);
    return samplePathPosition(path, tSec, durationSec);
  },
};

export const RasterLoopEdgesInward4Strategy: ScanStrategy = {
  key: 'raster-loop-edges-inward-4',
  label: 'Raster (loop edges inward x4)',
  positionAt(ctx, tSec, durationSec) {
    const path = buildOutlineInwardPath(ctx.pointsGalvo, 4);
    return sampleDualPhasePath(path, tSec, durationSec);
  },
};

export const RasterStrategy: ScanStrategy = {
  key: 'raster',
  label: 'Raster (zigzag fill)',
  positionAt(ctx, tSec, durationSec) {
    const path = buildRasterPath(ctx.pointsGalvo);
    return samplePathPosition(path, tSec, durationSec);
  },
};

export const GridRasterInwardStrategy: ScanStrategy = {
  key: 'grid-raster-inward',
  label: 'Raster 3x3 (1,9,2... center)',
  positionAt(ctx, tSec, durationSec) {
    const path = buildGridRasterInwardPath(ctx.pointsGalvo);
    return samplePathPosition(path, tSec, durationSec);
  },
};

// Strategy registry for easy extension
export const ScanStrategies: ScanStrategy[] = [
  OutlineStrategy,
  RasterLoopEdgesStrategy,
  OutlineInward8Strategy,
  RasterLoopEdgesInward8Strategy,
  OutlineInward4Strategy,
  RasterLoopEdgesInward4Strategy,
  RasterStrategy,
  GridRasterInwardStrategy,
];
