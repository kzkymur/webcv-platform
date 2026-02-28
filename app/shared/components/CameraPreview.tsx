"use client";

import { useEffect, useRef, useState } from "react";
import { useVideoSource } from "@/shared/hooks/useVideoSource";

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
  const source = useVideoSource(deviceId);
  const [label, setLabel] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Find and show device label
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (deviceId?.startsWith("ws://") || deviceId?.startsWith("wss://")) {
          if (mounted) setLabel(`(WS) ${deviceId}`);
          return;
        }
        const list = await navigator.mediaDevices?.enumerateDevices();
        const dev = (list || []).find((d) => d.kind === "videoinput" && d.deviceId === deviceId);
        if (mounted) setLabel(dev?.label || "");
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [deviceId]);

  // Draw preview to visible canvas via stream abstraction
  useEffect(() => {
    const c = canvasRef.current;
    if (!source || !c) return;
    let ctl: { stop: () => void; dispose: () => void } | null = null;
    (async () => {
      ctl = await source.toCanvas(c, { fitMax: 640 });
    })();
    return () => { try { ctl?.stop(); ctl?.dispose(); } catch {} };
  }, [source]);

  // Expose capture handle
  useEffect(() => {
    const handle: CameraPreviewHandle = {
      capture: async (fmt) => {
        if (!source) return null;
        const webgl = await source.toWebGL();
        const v = webgl?.element || null;
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
  }, [source, label, onReady]);

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
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
