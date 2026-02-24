"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFile } from "@/shared/db";
import { fileToRGBA } from "@/shared/util/fileEntry";
import type { FileEntry } from "@/shared/db/types";
import type { WasmWorkerClient } from "@/shared/wasm/client";
// storage helpers are encapsulated in postprocessConfig
import { applyPostOpsGray, applyPostOpsRgbaViaGray } from "@/shared/image/postprocess";
import { getPostOpsForCam, setContrastForCam, setOpsForCam } from "@/shared/calibration/postprocessConfig";

export type ShotRow = {
  ts: string;
  cams: Record<string, string>;
};


export default function CheckerboardEnhancePreview({
  camName,
  rows,
  selectedTs,
  worker,
}: {
  camName: string;
  rows: ShotRow[];
  selectedTs: Set<string>;
  worker: WasmWorkerClient | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ts, setTs] = useState<string>("");
  const [found, setFound] = useState<boolean | null>(null);
  const [showCorners, setShowCorners] = useState<boolean>(true);
  const [busyDetect, setBusyDetect] = useState(false);
  const [ops, setOps] = useState(() => getPostOpsForCam(camName));
  // Per-camera contrast tuning (persisted per namespace)
  const [enhanceAmt, setEnhanceAmt] = useState<number>(() => {
    const ops = getPostOpsForCam(camName);
    const c = ops.find((o) => o.type === "contrast") as any;
    return c ? Math.max(0, Math.min(3, Number(c.slope) || 1)) : 1.0;
  });

  const camRows = useMemo(() => rows.filter((r) => !!r.cams[camName]), [rows, camName]);
  const tsList = useMemo(() => camRows.map((r) => r.ts), [camRows]);

  // Default TS: latest selected, else latest available
  useEffect(() => {
    let next = "";
    const sel = Array.from(selectedTs.values()).filter((t) => tsList.includes(t));
    if (sel.length > 0) next = sel[sel.length - 1];
    else if (tsList.length > 0) next = tsList[tsList.length - 1];
    setTs((prev) => (prev && tsList.includes(prev) ? prev : next));
  }, [selectedTs, tsList.join("|")]);

  // Render pipeline
  useEffect(() => {
    (async () => {
      const c = canvasRef.current;
      if (!c || !ts) return;
      const row = camRows.find((r) => r.ts === ts);
      if (!row) return;
      const path = row.cams[camName];
      if (!path) return;
      const fe = await getFile(path);
      if (!fe) return;
      const { rgba, width, height } = fileToRGBA(fe as FileEntry);

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
          const r = rgba[si];
          const g = rgba[si + 1];
          const b = rgba[si + 2];
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

      // Optional: draw detected corners (on downscaled coords)
      if (showCorners && worker) {
        setBusyDetect(true);
        try {
          // Always apply configured postprocess stack for detection
          const detRgba = ops.length ? applyPostOpsRgbaViaGray(rgba, width, height, ops) : rgba;
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
    })();
  }, [camRows, camName, ts, showCorners, worker, ops]);

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
          <select value={ts} onChange={(e) => setTs(e.target.value)} disabled={tsList.length === 0}>
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
        <canvas ref={canvasRef} />
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

// order invariant is enforced in config normalization; no local checks

// (no smoothstep needed; highlight tuning removed)
