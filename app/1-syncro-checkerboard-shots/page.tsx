"use client";

export const dynamic = "error";

import { useEffect, useRef, useState, useMemo } from "react";
import Sidebar from "@/components/Sidebar";
import { useCameraIds, useCameraStream } from "@/shared/hooks/useCameraStreams";
import { putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";

type CaptureFormat = "rgba8" | "gray8"; // gray16 can be added when available

export default function Page() {
  const [ids] = useCameraIds();
  // Per-camera capture format
  const [fmtById, setFmtById] = useState<Record<string, CaptureFormat>>(() => {
    const st = readNamespacedStore<{ shotOptions?: Record<string, { fmt: CaptureFormat }> }>();
    const map: Record<string, CaptureFormat> = {};
    if (st.shotOptions) {
      for (const [k, v] of Object.entries(st.shotOptions)) map[k] = v.fmt;
    }
    return map;
  });
  const [busy, setBusy] = useState(false);
  const panelsRef = useRef<Map<string, CameraPreviewHandle>>(new Map());

  // Helper to register child preview handles by deviceId
  const register = (deviceId: string | undefined, handle: CameraPreviewHandle | null) => {
    if (!deviceId) return;
    const map = panelsRef.current;
    if (handle) map.set(deviceId, handle);
    else map.delete(deviceId);
  };

  async function shootAll() {
    if (busy) return;
    setBusy(true);
    try {
      // Build timestamp once to ensure files from the same trigger share it
      const ts = formatTimestamp(new Date());
      const tasks: Promise<void>[] = [];
      for (const id of ids) {
        if (!id) continue;
        const h = panelsRef.current.get(id);
        if (!h) continue;
        tasks.push(
          (async () => {
            const perFmt = fmtById[id] || "rgba8";
            const shot = await h.capture(perFmt);
            if (!shot) return;
            const name = sanitize(shot.label || id);
            const baseDir = "1-syncro-checkerboard_shots";
            const filePath = `${baseDir}/${ts}_cam-${name}`;
            const entry: FileEntry = {
              path: filePath,
              type: perFmt === "gray8" ? "grayscale-image" : "rgb-image",
              data: shot.data.buffer as ArrayBuffer,
              width: shot.width,
              height: shot.height,
              channels: 4, // stored as RGBA for both modes
            };
            await putFile(entry);
          })()
        );
      }
      await Promise.all(tasks);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sidebar onSelectFile={() => { /* page 1: no file preview */ }} />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>1. Syncro Checkerboard Shots</b>
          <div className="row" style={{ gap: 12 }}>
            <button onClick={shootAll} disabled={busy || ids.length === 0}>
              Capture All ({ids.length})
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 12 }}>
            <h4>Selected Cameras</h4>
            {ids.length === 0 && (
              <div style={{ opacity: 0.7 }}>No cameras selected. Add from Device Settings in the sidebar.</div>
            )}
            {ids.map((id, idx) => (
              <CameraPreview
                key={id || idx}
                deviceId={id}
                format={fmtById[id] || "rgba8"}
                onChangeFormat={(fmt) => {
                  setFmtById((prev) => {
                    const next = { ...prev, [id || ""]: fmt };
                    // persist
                    const st = readNamespacedStore<{ shotOptions?: Record<string, { fmt: CaptureFormat }> }>();
                    const shotOptions = { ...(st.shotOptions || {}) } as Record<string, { fmt: CaptureFormat }>;
                    if (id) shotOptions[id] = { fmt };
                    updateNamespacedStore({ shotOptions });
                    return next;
                  });
                }}
                onReady={(h) => register(id, h)}
              />
            ))}
          </section>
        </div>
      </main>
    </>
  );
}

function formatTimestamp(d: Date) {
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function sanitize(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
}

type CameraPreviewHandle = {
  capture: (fmt: CaptureFormat) => Promise<{ width: number; height: number; data: Uint8ClampedArray; label?: string } | null>;
};

function CameraPreview({
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
        const dev = (list || []).find((d) => d.kind === "videoinput" && d.deviceId === deviceId);
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

  // Draw preview to visible canvas: width fixed (640), height adapts to aspect (no crop)
  useEffect(() => {
    let raf = 0;
    const v = videoRef.current;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!v || !ctx || !c) return;
    const W = 640;
    const loop = () => {
      if (v.readyState >= 2) {
        const vw = v.videoWidth || W;
        const vh = v.videoHeight || 1;
        const cssW = W;
        const cssH = Math.max(1, Math.round((cssW * vh) / (vw || 1)));
        c.style.width = `${cssW}px`;
        c.style.height = "auto";
        c.style.aspectRatio = `${vw}/${vh}`;
        const dpr = (window.devicePixelRatio || 1);
        const bufW = Math.max(1, Math.round(cssW * dpr));
        const bufH = Math.max(1, Math.round(cssH * dpr));
        if (c.width !== bufW || c.height !== bufH) {
          c.width = bufW; c.height = bufH;
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
        off.width = w; off.height = h;
        const octx = off.getContext("2d");
        if (!octx) return null;
        octx.drawImage(v, 0, 0, w, h);
        const img = octx.getImageData(0, 0, w, h);
        if (fmt === "gray8") {
          // Convert to grayscale but keep RGBA layout for viewer compatibility
          const rgba = img.data;
          for (let i = 0; i < rgba.length; i += 4) {
            const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
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
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{label || deviceId || "(unselected)"}</div>
        <label className="row" style={{ gap: 6 }}>
          Save Format
          <select value={format} onChange={(e) => onChangeFormat(e.target.value as CaptureFormat)} disabled={!deviceId}>
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

// (Note) File preview is intentionally omitted on this page per requirements.
