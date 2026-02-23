"use client";

import { useEffect, useRef, useState } from "react";
import { useCameraStream } from "@/shared/hooks/useCameraStreams";
import { fitWithinBox } from "@/shared/util/fit";

export type CaptureFormat = "rgba8" | "gray8"; // gray16 can be added when available

export type CameraPreviewHandle = {
  capture: (fmt: CaptureFormat) => Promise<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
    label?: string;
  } | null>;
};

export default function CameraPreview({
  deviceId,
  format,
  onChangeFormat,
  onReady,
}: {
  deviceId?: string;
  format: CaptureFormat;
  onChangeFormat: (f: CaptureFormat) => void;
  onReady: (h: CameraPreviewHandle | null) => void;
}) {
  const stream = useCameraStream(deviceId);
  const [label, setLabel] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Find and show device label
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        const dev = (list || []).find(
          (d) => d.kind === "videoinput" && d.deviceId === deviceId
        );
        if (mounted) setLabel(dev?.label || "");
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [deviceId]);

  // Wire stream to hidden <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream || null;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  // Draw preview to visible canvas: fit within 640x640 box (no crop)
  useEffect(() => {
    let raf = 0;
    const v = videoRef.current;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!v || !ctx || !c) return;
    const MAX = 640;
    const loop = () => {
      if (v.readyState >= 2) {
        const vw = v.videoWidth || MAX;
        const vh = v.videoHeight || 1;
        // CSS sizing handled globally; only adjust backing store to CSS size * DPR
        const { w: cssW, h: cssH } = fitWithinBox(vw || MAX, vh || 1, MAX);
        const dpr = window.devicePixelRatio || 1;
        const bufW = Math.max(1, Math.round(cssW * dpr));
        const bufH = Math.max(1, Math.round(cssH * dpr));
        if (c.width !== bufW || c.height !== bufH) {
          c.width = bufW;
          c.height = bufH;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
        }
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.drawImage(v, 0, 0, cssW, cssH);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stream]);

  // Expose capture handle
  useEffect(() => {
    const handle: CameraPreviewHandle = {
      capture: async (fmt) => {
        const v = videoRef.current;
        if (!v || v.readyState < 2) return null;
        // Use native frame size
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (w <= 0 || h <= 0) return null;
        let off = offscreenRef.current;
        if (!off) {
          off = document.createElement("canvas");
          offscreenRef.current = off;
        }
        off.width = w;
        off.height = h;
        const octx = off.getContext("2d");
        if (!octx) return null;
        octx.drawImage(v, 0, 0, w, h);
        const img = octx.getImageData(0, 0, w, h);
        if (fmt === "gray8") {
          // Convert to grayscale but keep RGBA layout for viewer compatibility
          const rgba = img.data;
          for (let i = 0; i < rgba.length; i += 4) {
            const r = rgba[i],
              g = rgba[i + 1],
              b = rgba[i + 2];
            const v8 = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            rgba[i] = rgba[i + 1] = rgba[i + 2] = v8;
            rgba[i + 3] = 255;
          }
          return { width: w, height: h, data: img.data, label };
        }
        return { width: w, height: h, data: img.data, label };
      },
    };
    onReady(handle);
    return () => onReady(null);
  }, [stream, label, onReady]);

  return (
    <div className="col" style={{ gap: 6 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          {label || deviceId || "(unselected)"}
        </div>
        <label className="row" style={{ gap: 6 }}>
          Save Format
          <select
            value={format}
            onChange={(e) => onChangeFormat(e.target.value as CaptureFormat)}
            disabled={!deviceId}
          >
            <option value="rgba8">RGBA 8-bit</option>
            <option value="gray8">Grayscale 8-bit</option>
          </select>
        </label>
      </div>
      <div className="canvasWrap">
        <video ref={videoRef} style={{ display: "none" }} />
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
