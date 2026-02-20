"use client";

import { useEffect, useRef } from "react";

export default function CameraCanvas({
  stream,
  width = 640,
}: {
  stream: MediaStream | null;
  width?: number; // fixed width in CSS pixels; height adapts to aspect
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSize = useRef<{ w: number; h: number }>({ w: width, h: Math.round((width * 9) / 16) });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream || null;
    if (stream) {
      v.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    let raf = 0;
    const v = videoRef.current;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!v || !ctx || !c) return;

    const draw = () => {
      if (v.readyState >= 2) {
        const vidW = v.videoWidth || lastSize.current.w;
        const vidH = v.videoHeight || lastSize.current.h;
        const cssW = width;
        const cssH = Math.max(1, Math.round((cssW * vidH) / (vidW || 1)));
        // CSS sizing
        c.style.width = `${cssW}px`;
        c.style.height = "auto"; // auto height with aspect-ratio below
        c.style.aspectRatio = `${vidW}/${vidH}`;
        // Backing store sizing (for HiDPI crispness)
        const dpr = (window.devicePixelRatio || 1);
        const bufW = Math.max(1, Math.round(cssW * dpr));
        const bufH = Math.max(1, Math.round(cssH * dpr));
        if (c.width !== bufW || c.height !== bufH) {
          c.width = bufW;
          c.height = bufH;
          lastSize.current = { w: cssW, h: cssH };
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
        }
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.drawImage(v, 0, 0, cssW, cssH);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, stream]);

  return (
    <div className="canvasWrap">
      <video ref={videoRef} style={{ display: "none" }} />
      <canvas ref={canvasRef} width={lastSize.current.w} height={lastSize.current.h} />
    </div>
  );
}
