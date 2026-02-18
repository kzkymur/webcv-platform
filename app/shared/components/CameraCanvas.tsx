"use client";

import { useEffect, useRef } from "react";

export default function CameraCanvas({
  stream,
  width = 640,
  height = 360,
}: {
  stream: MediaStream | null;
  width?: number;
  height?: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
        c.width = width;
        c.height = height;
        ctx.drawImage(v, 0, 0, width, height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <div className="canvasWrap">
      <video ref={videoRef} style={{ display: "none" }} />
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}
