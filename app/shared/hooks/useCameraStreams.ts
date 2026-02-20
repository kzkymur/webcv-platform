"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readNamespacedStore,
  updateNamespacedStore,
} from "@/shared/module/loaclStorage";

export function useCameraIds(): [string[], (next: string[]) => void] {
  // Start with an SSR-safe value to avoid hydration mismatches
  const [ids, setIds] = useState<string[]>([]);

  // Hydrate from namespaced store after mount
  useEffect(() => {
    const st = readNamespacedStore<{
      cameraIds?: string[];
      webCamId?: string | null;
      thermalCamId?: string | null;
    }>();
    if (st.cameraIds && Array.isArray(st.cameraIds)) {
      setIds(st.cameraIds);
    } else {
      const legacy = [st.webCamId, st.thermalCamId].filter(
        (v): v is string => !!v
      );
      if (legacy.length > 0) setIds(legacy);
    }
  }, []);

  useEffect(() => {
    const onUpdate = () => {
      const st = readNamespacedStore<{ cameraIds?: string[] }>();
      if (Array.isArray(st.cameraIds)) setIds(st.cameraIds);
    };
    window.addEventListener("gw:ns:update", onUpdate as EventListener);
    return () =>
      window.removeEventListener("gw:ns:update", onUpdate as EventListener);
  }, []);

  const set = (next: string[]) => {
    setIds(next);
    updateNamespacedStore({ cameraIds: next });
  };

  return [ids, set];
}

export function useCameraStream(deviceId?: string | null): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [y16, setY16] = useState(false);
  const stopRef = useRef<null | (() => void)>(null);

  // Observe per-camera Y16 flag from namespaced store
  useEffect(() => {
    const read = () => {
      if (!deviceId) return setY16(false);
      const st = readNamespacedStore<{
        cameraOptions?: Record<string, { y16?: boolean }>;
      }>();
      const flag = !!st.cameraOptions?.[deviceId]?.y16;
      setY16(flag);
    };
    read();
    const onUpdate = () => read();
    window.addEventListener("gw:ns:update", onUpdate as EventListener);
    return () =>
      window.removeEventListener("gw:ns:update", onUpdate as EventListener);
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    async function open() {
      if (!deviceId) {
        setStream((s) => {
          s?.getTracks().forEach((t) => t.stop());
          return null;
        });
        return;
      }
      try {
        const baseVideo: MediaTrackConstraints = {
          deviceId: { exact: deviceId } as any,
        };
        // Prefer 16:9 to avoid defaulting to 4:3 on some browsers
        const prefer16x9: MediaTrackConstraints = {
          aspectRatio: { ideal: 16 / 9 },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
        const s = await navigator.mediaDevices.getUserMedia({
          video: { ...baseVideo, ...(prefer16x9 as any) },
          audio: false,
        });
        // Try enforcing aspect after capture when supported
        try {
          const vt = s.getVideoTracks()[0];
          await vt.applyConstraints({ aspectRatio: 16 / 9 } as any);
        } catch {}
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        // If Y16 conversion is requested, wrap the stream via canvas.captureStream()
        if (y16) {
          const { processed, stop } = await toY16ProcessedStream(s);
          if (!active) {
            stop();
            return;
          }
          stopRef.current = stop;
          setStream((prev) => {
            prev?.getTracks().forEach((t) => t.stop());
            return processed;
          });
        } else {
          // passthrough
          stopRef.current?.();
          stopRef.current = null;
          setStream((prev) => {
            prev?.getTracks().forEach((t) => t.stop());
            return s;
          });
        }
      } catch (e) {
        console.warn("getUserMedia error", e);
        setStream((s) => {
          s?.getTracks().forEach((t) => t.stop());
          return null;
        });
      }
    }
    open();
    return () => {
      active = false;
      try {
        stopRef.current?.();
      } catch {}
      setStream((s) => {
        s?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, [deviceId, y16]);

  return stream;
}

async function toY16ProcessedStream(
  src: MediaStream
): Promise<{ processed: MediaStream; stop: () => void }> {
  const track = src.getVideoTracks()[0];

  if (!track) return { processed: src, stop: () => {} };
  const Processor = await ensureProcessor();
  if (!Processor) return { processed: src, stop: () => {} };

  await waitForLive(track);
  const settings = track.getSettings?.() || {};
  const hintedW = (settings.width as number | undefined) || undefined;
  const hintedH = (settings.height as number | undefined) || undefined;

  const processor = new (Processor as any)({ track });
  const reader: ReadableStreamDefaultReader<any> =
    processor.readable.getReader();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { processed: src, stop: () => {} };
  let running = true;

  // Start capture from canvas
  const out = canvas.captureStream();

  let img: ImageData | null = null;
  (async () => {
    try {
      while (running) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        try {
          const w =
            (frame.displayWidth as number) ||
            (frame.codedWidth as number) ||
            hintedW ||
            0;
          const h =
            (frame.displayHeight as number) ||
            (frame.codedHeight as number) ||
            hintedH ||
            0;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            img = null;
          }
          const fmt = String((frame as any).format || "").toUpperCase();
          if (fmt === "Y16" || fmt.includes("GRAY16")) {
            // === Y16 → 8bit 疑似グレイ ===
            const alloc = (frame as any).allocationSize as number | undefined;
            const buf = new Uint16Array((alloc && alloc / 2) || w * h);
            await (frame as any).copyTo(buf, {
              layout: [{ offset: 0, stride: w * 2 }],
            });
            let mn = 0xffff,
              mx = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = buf[i];
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
            const rng = mx - mn || 1;
            if (!img) img = ctx.createImageData(w, h);
            const data = img.data;
            for (let i = 0, p = 0; i < w * h; i++, p += 4) {
              const g = (((buf[i] - mn) * 255) / rng) | 0;
              data[p] = data[p + 1] = data[p + 2] = g;
              data[p + 3] = 255;
            }
            ctx.putImageData(img, 0, 0);
          } else if (fmt === "NV12" || fmt === "I420" || !fmt) {
            const bmp = await createImageBitmap(frame as any);
            ctx.drawImage(bmp, 0, 0, w, h);
            bmp.close();
          } else {
            // その他のフォーマットはブラウザ変換に委ねる
            const bmp = await createImageBitmap(frame as any);
            ctx.drawImage(bmp, 0, 0, w, h);
            bmp.close();
          }
        } finally {
          try {
            (frame as any).close?.();
          } catch {}
        }
      }
    } catch (err) {
      console.warn("Y16 processor stopped", err);
    } finally {
      try {
        reader.releaseLock?.();
      } catch {}
    }
  })();

  const stop = () => {
    running = false;
    try {
      reader.cancel?.();
    } catch {}
    try {
      track.stop();
    } catch {}
    try {
      out.getTracks().forEach((t) => t.stop());
    } catch {}
  };

  return { processed: out, stop };
}

async function ensureProcessor(): Promise<any | null> {
  if ((window as any).MediaStreamTrackProcessor)
    return (window as any).MediaStreamTrackProcessor;
  const url = "https://unpkg.com/mediastreamtrack-insertable@0.3.1";
  try {
    const dynImport = new Function("u", "return import(u)");
    const mod: any = await (dynImport as any)(url);
    return (
      mod?.MediaStreamTrackProcessor ||
      mod?.default ||
      (window as any).MediaStreamTrackProcessor ||
      null
    );
  } catch (e) {
    console.warn("Processor dynamic import failed", e);
    return (window as any).MediaStreamTrackProcessor || null;
  }
}

function waitForLive(track: MediaStreamTrack, timeoutMs = 3000): Promise<void> {
  if (track.readyState === "live") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      cleanup();
      reject(new Error("unmute timeout"));
    }, timeoutMs);
    const cleanup = () => {
      try {
        clearTimeout(to);
      } catch {}
      track.removeEventListener("unmute", onUnmute as any);
      track.removeEventListener("ended", onEnded as any);
    };
    const onUnmute = () => {
      cleanup();
      resolve();
    };
    const onEnded = () => {
      cleanup();
      reject(new Error("track ended"));
    };
    track.addEventListener("unmute", onUnmute as any, { once: true } as any);
    track.addEventListener("ended", onEnded as any, { once: true } as any);
  });
}
