import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";
import type { PostProcessOp } from "@/shared/image/postprocess";

type StoreShape = {
  calibPostOps?: PostProcessOp[];
  calibPostOpsByCam?: Record<string, PostProcessOp[]>;
};

export function getPostOpsForCam(cam: string): PostProcessOp[] {
  const st = readNamespacedStore<StoreShape>();
  // Prefer structured per-camera
  const byCam = st.calibPostOpsByCam?.[cam];
  if (Array.isArray(byCam)) return normalizeOps(byCam);
  // Fallback to global structured
  if (Array.isArray(st.calibPostOps)) return normalizeOps(st.calibPostOps);
  return [];
}

export function setContrastForCam(cam: string, slope: number) {
  // Helper used by UI slider to write structured config
  const st = readNamespacedStore<StoreShape>();
  const prev = st.calibPostOpsByCam || {};
  const ops = normalizeOps(prev[cam] || []);
  const other = ops.filter((o) => o.type !== "contrast");
  const nextOps = Math.abs(slope - 1) < 1e-6 ? other : [...other, { type: "contrast", slope: clampRange(slope, 0, 3) }];
  updateNamespacedStore({ calibPostOpsByCam: { ...prev, [cam]: nextOps } });
}

export function setOpsForCam(cam: string, ops: PostProcessOp[]) {
  const st = readNamespacedStore<StoreShape>();
  const prev = st.calibPostOpsByCam || {};
  const nextOps = normalizeOps(ops || []);
  updateNamespacedStore({ calibPostOpsByCam: { ...prev, [cam]: nextOps } });
}

export function normalizeOps(arr: PostProcessOp[]): PostProcessOp[] {
  const out: PostProcessOp[] = [];
  let contrastSeen = false;
  for (const op of arr) {
    if (!op || typeof (op as any).type !== "string") continue;
    if (op.type === "contrast") {
      if (contrastSeen) continue; // keep first occurrence
      contrastSeen = true;
      const slope = clampRange(Number((op as any).slope ?? 1), 0, 3);
      if (Math.abs(slope - 1) < 1e-6) continue; // drop no-op
      out.push({ type: "contrast", slope });
    } else if (op.type === "invert") {
      if ((op as any).enabled === false) continue; // drop disabled
      out.push({ type: "invert" });
    }
  }
  // Invariant: contrast must come before invert if both exist
  const ci = out.findIndex((o) => o.type === "contrast");
  const ii = out.findIndex((o) => o.type === "invert");
  if (ci >= 0 && ii >= 0 && ci > ii) {
    const tmp = out[ci];
    out[ci] = out[ii];
    out[ii] = tmp;
  }
  return out;
}

function clampRange(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
