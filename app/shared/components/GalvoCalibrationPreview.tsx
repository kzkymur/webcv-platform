"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { RemapRenderer } from "@/shared/gl/remap";
import { useCameraStream } from "@/shared/hooks/useCameraStreams";
import { formatTimestamp } from "@/shared/util/time";
import { loadRemapXY, buildIdentityInterMap } from "@/shared/util/remap";
import { putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import type { GridParams, UndistItem } from "@/shared/calibration/galvoTypes";

export type PreviewHandle = {
  captureFrame: () => Promise<
    { rgba: Uint8Array; width: number; height: number } | null
  >;
};

type Props = {
  deviceId: string;
  selected: UndistItem | null;
  grid: GridParams;
  showOverlay: boolean;
  setShowOverlay: (v: boolean) => void;
  spots: { x: number; y: number }[];
  last: { x: number; y: number } | null;
  onClearOverlay: () => void;
  onFps: (fps: number) => void;
};

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { deviceId, selected, grid, showOverlay, setShowOverlay, spots, last, onClearOverlay, onFps },
  ref
) {
  const stream = useCameraStream(deviceId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rendererRef = useRef<RemapRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const propsRef = useRef({ grid, showOverlay, spots, last });

  useEffect(() => {
    propsRef.current = { grid, showOverlay, spots, last };
  }, [grid, showOverlay, spots, last]);

  // Wire stream to hidden <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream || null;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  // Init renderer on mount
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = new RemapRenderer(c);
    rendererRef.current = r;
    return () => {
      try {
        r.dispose();
      } catch {}
      rendererRef.current = null;
    };
  }, []);

  // Push video to renderer
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setSourceVideo(videoRef.current || null);
  }, [rendererRef.current, stream]);

  // Load undist map and set identity inter map on selection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = rendererRef.current;
      if (!r || !selected) return;
      const u = await loadRemapXY(selected.mapXYPath);
      if (!u || cancelled) return;
      r.setUndistMapXY(u.xy, { width: u.width, height: u.height });
      const id = buildIdentityInterMap(u.width, u.height);
      r.setInterMapXY(id, { width: u.width, height: u.height });
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.mapXYPath]);

  // Clear overlay when toggled off
  useEffect(() => {
    const can = overlayCanvasRef.current;
    if (!can) return;
    if (!showOverlay) {
      const ctx = can.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, can.width, can.height);
    }
  }, [showOverlay]);

  // Render loop
  useEffect(() => {
    let mounted = true;
    let lastT = performance.now();
    let frames = 0;
    const loop = () => {
      const r = rendererRef.current;
      if (!mounted) return;
      if (r) r.render();
      drawOverlay();
      frames++;
      const now = performance.now();
      if (now - lastT >= 500) {
        onFps((frames * 1000) / (now - lastT));
        frames = 0;
        lastT = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    captureFrame: async () => {
      const r = rendererRef.current;
      if (!r) return null;
      const rgba = r.readPixels();
      const size = r.getOutputSize();
      if (!size) return null;
      return { rgba, width: size.width, height: size.height };
    },
  }));

  function drawOverlay() {
    const { grid: g, showOverlay: show, spots: spts, last: lst } = propsRef.current;
    if (!show) return;
    const r = rendererRef.current;
    const can = overlayCanvasRef.current;
    if (!r || !can) return;
    const size = r.getOutputSize();
    if (!size) return;
    if (can.width !== size.width || can.height !== size.height) {
      can.width = size.width;
      can.height = size.height;
    }
    const ctx = can.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, can.width, can.height);

    // Draw accumulated points
    ctx.save();
    ctx.fillStyle = "rgba(0,255,0,0.7)";
    for (const p of spts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Highlight last point
    if (lst) {
      ctx.strokeStyle = "rgba(255,80,80,0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(lst.x, lst.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Counter
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const txt = `${spts.length}/${g.nx * g.ny}`;
    const pad = 4;
    const w = ctx.measureText(txt).width + pad * 2;
    const h = 16;
    ctx.fillRect(8, 8, w, h);
    ctx.fillStyle = "#eaeaea";
    ctx.fillText(txt, 8 + pad, 8 + 12);
    ctx.restore();
  }

  return (
    <section className="col" style={{ gap: 8 }}>
      <h4>Preview (undistorted)</h4>
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <button
          onClick={async () => {
            if (!selected) return;
            const r = rendererRef.current;
            if (!r) return;
            const rgba = r.readPixels();
            const size = r.getOutputSize();
            if (!size) return;
            const ts = formatTimestamp(new Date());
            const path = `4-galvo-calibration/${ts}/manual-preview.rgb`;
            await putFile({
              path,
              type: "rgb-image",
              data: rgba.buffer as ArrayBuffer,
              width: size.width,
              height: size.height,
              channels: 4,
            } as FileEntry);
            alert(`Saved: ${path}`);
          }}
          disabled={!selected}
        >
          Save Frame
        </button>
        <span style={{ opacity: 0.75 }}>FPS updates in header</span>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)}
          />
          Show overlay
        </label>
        <button onClick={onClearOverlay} disabled={!showOverlay}>
          Clear overlay
        </button>
      </div>
      <div className="canvasWrap">
        <canvas ref={canvasRef} />
        <canvas ref={overlayCanvasRef} className="canvasOverlay" />
      </div>
      <video ref={videoRef} style={{ display: "none" }} />
    </section>
  );
});
