"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFile } from "@/shared/db";
import { fileToRGBA } from "@/shared/util/fileEntry";
import type { FileEntry } from "@/shared/db/types";
import type { WasmWorkerClient } from "@/shared/wasm/client";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";

export type ShotRow = {
  ts: string;
  cams: Record<string, string>;
};

type Mode = "original" | "enhanced" | "edges";

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
  const [mode, setMode] = useState<Mode>("enhanced");
  const [ts, setTs] = useState<string>("");
  const [found, setFound] = useState<boolean | null>(null);
  const [showCorners, setShowCorners] = useState<boolean>(true);
  const [busyDetect, setBusyDetect] = useState(false);
  // Shared across previews via namespaced store so both sliders stay in sync
  const [enhanceAmt, setEnhanceAmt] = useState<number>(() => {
    const st = readNamespacedStore<{ calibPreviewEnhance?: number }>();
    const v = Number(st.calibPreviewEnhance);
    return Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 1.0;
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

      let outGray: Uint8ClampedArray;
      if (mode === "original") {
        outGray = gray;
      } else if (mode === "edges") {
        outGray = sobelEdges(gray, pW, pH);
      } else {
        outGray = unsharp(gray, pW, pH, enhanceAmt);
      }

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
          const res = await worker.cvFindChessboardCorners(rgba, width, height);
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
  }, [camRows, camName, ts, mode, showCorners, worker, enhanceAmt]);

  // Keep sliders in sync across both camera previews (same namespace)
  useEffect(() => {
    const onUpdate = () => {
      const st = readNamespacedStore<{ calibPreviewEnhance?: number }>();
      const v = Number(st.calibPreviewEnhance);
      if (Number.isFinite(v)) setEnhanceAmt(Math.max(0, Math.min(3, v)));
    };
    window.addEventListener("gw:ns:update", onUpdate as EventListener);
    return () => window.removeEventListener("gw:ns:update", onUpdate as EventListener);
  }, []);

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
        <label className="row" style={{ gap: 6 }}>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="original">Original</option>
            <option value="enhanced">Enhanced</option>
            <option value="edges">Edges</option>
          </select>
        </label>
        {mode === "enhanced" && (
          <div className="row" style={{ gap: 6, alignItems: "center", minWidth: 200 }}>
            <label style={{ opacity: 0.85 }}>Enhance</label>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={enhanceAmt}
              onChange={(e) => {
                const v = Math.max(0, Math.min(3, Number(e.target.value)));
                setEnhanceAmt(v);
                updateNamespacedStore({ calibPreviewEnhance: v });
              }}
              style={{ width: 120 }}
            />
            <span style={{ width: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {enhanceAmt.toFixed(1)}
            </span>
          </div>
        )}
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
function unsharp(gray: Uint8ClampedArray, w: number, h: number, amount = 1.0): Uint8ClampedArray {
  const blur = gaussian3x3(gray, w, h);
  const out = new Uint8ClampedArray(gray.length);
  let minV = 255, maxV = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = clamp8(gray[i] + amount * (gray[i] - blur[i]));
    out[i] = v;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  // Contrast stretch
  const range = Math.max(1, maxV - minV);
  for (let i = 0; i < out.length; i++) {
    out[i] = (((out[i] - minV) * 255) / range) | 0;
  }
  return out;
}

function sobelEdges(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const mag = Math.min(255, Math.hypot(gx, gy) | 0);
      out[i] = mag;
    }
  }
  return out;
}

function gaussian3x3(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const ks = 16;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let acc = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = gray[(y + dy) * w + (x + dx)];
          acc += v * k[ki++];
        }
      }
      out[y * w + x] = (acc / ks) | 0;
    }
  }
  return out;
}

function clamp8(x: number) {
  return x < 0 ? 0 : x > 255 ? 255 : x | 0;
}

function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 2.0, 0, Math.PI * 2);
  ctx.fill();
}
