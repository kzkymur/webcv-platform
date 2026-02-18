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
        // Fix aspect ratio by letterboxing/pillarboxing into the target canvas size
        const vidW = v.videoWidth || width;
        const vidH = v.videoHeight || height;
        c.width = width;
        c.height = height;
        const scale = Math.min(width / vidW, height / vidH);
        const drawW = Math.round(vidW * scale);
        const drawH = Math.round(vidH * scale);
        const dx = Math.floor((width - drawW) / 2);
        const dy = Math.floor((height - drawH) / 2);
        // Clear and fill background to visualize letterbox bars
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(v, dx, dy, drawW, drawH);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, stream]);

  return (
    <div className="canvasWrap">
      <video ref={videoRef} style={{ display: "none" }} />
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}
