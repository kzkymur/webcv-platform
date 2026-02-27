"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFile, listFiles } from "@/shared/db";
import { fileToRGBA } from "@/shared/util/fileEntry";
import type { FileEntry } from "@/shared/db/types";
import type { WasmWorkerClient } from "@/shared/wasm/client";
// storage helpers are encapsulated in postprocessConfig
import { applyPostOpsGray, applyPostOpsRgbaViaGray } from "@/shared/image/postprocess";
import { getPostOpsForCam, setContrastForCam, setOpsForCam } from "@/shared/calibration/postprocessConfig";
import { loadRemapXY } from "@/shared/util/remap";
import { sanitize } from "@/shared/util/strings";
import { applyRemapXYBilinear } from "@/shared/image/remapCpu";

export type ShotRow = {
  ts: string;
  cams: Record<string, string>;
};


export default function CheckerboardEnhancePreview({
  camName,
  rows,
  selectedTs,
  worker,
  undistort = false,
  tsValue,
  onTsChange,
  tsOptions,
  onClickOriginal,
  marker,
}: {
  camName: string;
  rows: ShotRow[];
  selectedTs: Set<string>;
  worker: WasmWorkerClient | null;
  undistort?: boolean;
  tsValue?: string;
  onTsChange?: (ts: string) => void;
  tsOptions?: string[];
  // When provided, clicking the canvas reports the original (undist) pixel coords
  onClickOriginal?: (x: number, y: number) => void;
  // Optional overlay marker in original (undist) pixel coords
  marker?: { x: number; y: number; color?: string; cross?: boolean } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ts, setTs] = useState<string>("");
  const [found, setFound] = useState<boolean | null>(null);
  const [showCorners, setShowCorners] = useState<boolean>(true);
  const [busyDetect, setBusyDetect] = useState(false);
  const [ops, setOps] = useState(() => getPostOpsForCam(camName));
  const lastScaleRef = useRef(1);
  const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // Per-camera contrast tuning (persisted per namespace)
  const [enhanceAmt, setEnhanceAmt] = useState<number>(() => {
    const ops = getPostOpsForCam(camName);
    const c = ops.find((o) => o.type === "contrast") as any;
    return c ? Math.max(0, Math.min(3, Number(c.slope) || 1)) : 1.0;
  });

  const camRows = useMemo(() => rows.filter((r) => !!r.cams[camName]), [rows, camName]);
  const tsList = useMemo(() => (tsOptions && tsOptions.length ? tsOptions : camRows.map((r) => r.ts)), [camRows, tsOptions?.join("|")]);

  // Load latest undist map for this camera when enabled
  const [mapXY, setMapXY] = useState<{ xy: Float32Array; width: number; height: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!undistort) { setMapXY(null); return; }
      const files = await listFiles();
      const name = sanitize(camName);
      const candidates = files
        .filter((f) => /^2-calibrate-scenes\//.test(f.path) && new RegExp(`/cam-${name}_remapXY\\.xy$`).test(f.path))
        .map((f) => f.path)
        .sort();
      const latest = candidates[candidates.length - 1];
      if (!latest) { setMapXY(null); return; }
      const m = await loadRemapXY(latest);
      if (!cancelled) setMapXY(m);
    })();
    return () => { cancelled = true; };
  }, [camName, undistort]);

  const tsEff = typeof tsValue === "string" ? tsValue : ts;

  // Default TS: latest selected, else latest available
  useEffect(() => {
    // Skip defaulting when controlled from parent
    if (typeof tsValue === "string") return;
    let next = "";
    const sel = Array.from(selectedTs.values()).filter((t) => tsList.includes(t));
    if (sel.length > 0) next = sel[sel.length - 1];
    else if (tsList.length > 0) next = tsList[tsList.length - 1];
    setTs((prev) => (prev && tsList.includes(prev) ? prev : next));
  }, [selectedTs, tsList.join("|"), tsValue]);

  // Render pipeline
  useEffect(() => {
    (async () => {
      const c = canvasRef.current;
      if (!c || !tsEff) return;
      const row = camRows.find((r) => r.ts === tsEff);
      if (!row) return;
      const path = row.cams[camName];
      if (!path) return;
      const fe = await getFile(path);
      if (!fe) return;
      const { rgba, width, height } = fileToRGBA(fe as FileEntry);
      const useRgba = undistort && mapXY && mapXY.width === width && mapXY.height === height
        ? applyRemapXYBilinear(rgba, width, height, mapXY.xy)
        : rgba;

      // Downscale for preview to keep CPU light
      const maxW = 640;
      const scale = Math.min(1, maxW / Math.max(1, width));
      const pW = Math.max(1, Math.round(width * scale));
      const pH = Math.max(1, Math.round(height * scale));

      // Build small grayscale buffer via nearest sampling
      const gray = new Uint8ClampedArray(pW * pH);
      for (let y = 0; y < pH; y++) {
        const sy = Math.min(height - 1, Math.floor(y / scale));
        for (let x = 0; x < pW; x++) {
          const sx = Math.min(width - 1, Math.floor(x / scale));
          const si = (sy * width + sx) * 4;
          const r = useRgba[si];
          const g = useRgba[si + 1];
          const b = useRgba[si + 2];
          gray[y * pW + x] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        }
      }
      const outGray = applyPostOpsGray(gray, pW, pH, ops);

      // Pack RGBA
      const out = new Uint8ClampedArray(pW * pH * 4);
      for (let i = 0, j = 0; i < outGray.length; i++, j += 4) {
        const v = outGray[i];
        out[j] = v;
        out[j + 1] = v;
        out[j + 2] = v;
        out[j + 3] = 255;
      }

      const ctx = c.getContext("2d", { willReadFrequently: false });
      if (!ctx) return;
      c.width = pW;
      c.height = pH;
      ctx.putImageData(new ImageData(out, pW, pH), 0, 0);
      lastScaleRef.current = scale;
      lastSizeRef.current = { w: width, h: height };

      // Optional: draw detected corners (on downscaled coords)
      if (showCorners && worker) {
        setBusyDetect(true);
        try {
          // Always apply configured postprocess stack for detection on undist or raw
          const detSrc = useRgba;
          const detRgba = ops.length ? applyPostOpsRgbaViaGray(detSrc, width, height, ops) : detSrc;
          const res = await worker.cvFindChessboardCorners(detRgba, width, height);
          setFound(res.found);
          if (res.found) {
            ctx.save();
            ctx.strokeStyle = "#00ff88";
            ctx.fillStyle = "#00ff88";
            ctx.lineWidth = 2;
            const pts = res.points;
            for (let i = 0; i < pts.length; i += 2) {
              const x = pts[i] * scale;
              const y = pts[i + 1] * scale;
              drawPoint(ctx, x, y);
            }
            ctx.restore();
          }
        } catch {
          setFound(false);
        } finally {
          setBusyDetect(false);
        }
      } else {
        setFound(null);
      }

      // Draw user marker if given (after corners so marker stays on top)
      if (marker && isFinite(marker.x) && isFinite(marker.y)) {
        const mx = marker.x * scale;
        const my = marker.y * scale;
        if (mx >= 0 && my >= 0 && mx < pW && my < pH) {
          ctx.save();
          const color = marker.color || "#00ffff";
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 2;
          drawMarker(ctx, mx, my, marker.cross !== false);
          ctx.restore();
        }
      }
    })();
  }, [camRows, camName, tsEff, showCorners, worker, ops, undistort, mapXY?.width, mapXY?.height, marker?.x, marker?.y, marker?.color, marker?.cross]);

  // Respond to namespace updates; only adopt value for this cam
  useEffect(() => {
    const onUpdate = () => {
      const nextOps = getPostOpsForCam(camName);
      setOps(nextOps);
      const c = nextOps.find((o) => o.type === "contrast") as any;
      setEnhanceAmt(c ? Math.max(0, Math.min(3, Number(c.slope) || 1)) : 1.0);
    };
    window.addEventListener("gw:ns:update", onUpdate as EventListener);
    return () => window.removeEventListener("gw:ns:update", onUpdate as EventListener);
  }, [camName]);

  // When cam changes, reload its saved value (with global fallback once)
  useEffect(() => {
    const nextOps = getPostOpsForCam(camName);
    setOps(nextOps);
    const c = nextOps.find((o) => o.type === "contrast") as any;
    setEnhanceAmt(c ? Math.max(0, Math.min(3, Number(c.slope) || 1)) : 1.0);
  }, [camName]);

  return (
    <div className="col" style={{ gap: 8, minWidth: 360 }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <b style={{ minWidth: 80 }}>{camName || "(cam)"}</b>
        <label className="row" style={{ gap: 6 }}>
          Frame
          <select
            value={typeof tsValue === "string" ? tsValue : ts}
            onChange={(e) => (onTsChange ? onTsChange(e.target.value) : setTs(e.target.value))}
            disabled={tsList.length === 0}
          >
            {tsList.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {/* Mode selector removed to simplify UI; preview shows postprocessed output */}
        {
          <div className="row" style={{ gap: 6, alignItems: "center", minWidth: 200 }}>
            <label style={{ opacity: 0.85 }}>Contrast</label>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={enhanceAmt}
              onChange={(e) => {
                const v = Math.max(0, Math.min(3, Number(e.target.value)));
                setEnhanceAmt(v);
                // Update local ops immediately and persist
                const other = ops.filter((o) => o.type !== "contrast");
                const next = Math.abs(v - 1) < 1e-6 ? other : [...other, { type: "contrast" as const, slope: v }];
                setOps(next);
                // Write structured ops (keep other ops intact)
                setContrastForCam(camName, v);
              }}
              style={{ width: 120 }}
            />
            <span style={{ width: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {enhanceAmt.toFixed(1)}
            </span>
          </div>
        }
        {/* Simple toggles for pre-detection tuning */}
        <label className="row" style={{ gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={ops.some((o) => o.type === "invert")}
            onChange={(e) => {
              const on = e.target.checked;
              const next = on ? [...ops.filter((o) => o.type !== "invert"), { type: "invert" as const }] : ops.filter((o) => o.type !== "invert");
              setOps(next);
              setOpsForCam(camName, next);
            }}
          />
          Invert
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={showCorners}
            onChange={(e) => setShowCorners(e.target.checked)}
            disabled={!worker}
          />
          Show corners
        </label>
      </div>
      <div className="canvasWrap" style={{ border: "1px solid #333", borderRadius: 4 }}>
        <canvas
          ref={canvasRef}
          style={{ cursor: onClickOriginal ? "crosshair" : undefined }}
          onClick={(ev) => {
            if (!onClickOriginal) return;
            const c = canvasRef.current;
            if (!c) return;
            const rect = c.getBoundingClientRect();
            const cx = (ev.clientX - rect.left) * (c.width / Math.max(1, rect.width));
            const cy = (ev.clientY - rect.top) * (c.height / Math.max(1, rect.height));
            const scale = lastScaleRef.current || 1;
            const { w, h } = lastSizeRef.current;
            const ox = Math.max(0, Math.min(w - 1e-6, cx / scale));
            const oy = Math.max(0, Math.min(h - 1e-6, cy / scale));
            onClickOriginal(ox, oy);
          }}
        />
      </div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {busyDetect ? "Detecting…" : found == null ? "" : found ? "Corners found" : "Corners not found"}
      </div>
    </div>
  );
}

// --- Image helpers ---


function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 2.0, 0, Math.PI * 2);
  ctx.fill();
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, cross: boolean) {
  // small circle
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  if (cross) {
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, y + 7);
    ctx.stroke();
  }
}

// order invariant is enforced in config normalization; no local checks

// (no smoothstep needed; highlight tuning removed)
