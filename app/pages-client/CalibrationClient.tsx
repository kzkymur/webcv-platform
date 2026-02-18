"use client";

import CameraCanvas from "@/shared/components/CameraCanvas";
import DeviceSettings from "@/shared/components/DeviceSettings";
import { useCamera } from "@/shared/hooks/useCamera";
import { useEffect, useMemo, useRef, useState } from "react";
import { WasmWorkerClient } from "@/shared/wasm/client";

export default function CalibrationClient() {
  const { stream } = useCamera({ key: "camera:web" });
  const [points, setPoints] = useState<Float32Array | null>(null);
  const clientRef = useRef<WasmWorkerClient | null>(null);
  useEffect(() => {
    clientRef.current = new WasmWorkerClient();
    return () => clientRef.current?.dispose();
  }, []);

  async function captureRGBA(): Promise<{ w: number; h: number; data: Uint8ClampedArray } | null> {
    const video = document.querySelector("video");
    if (!video) return null;
    const w = 640, h = 360;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return { w, h, data };
  }

  return (
    <>
      <aside className="sidebar">
        <div className="panel"><DeviceSettings /></div>
        <div className="panel">
          <button onClick={async () => {
            const frame = await captureRGBA(); if (!frame) return;
            const client = clientRef.current; if (!client) return;
            const res = await client.cvFindChessboardCorners(frame.data, frame.w, frame.h);
            setPoints(res.found ? res.points : null);
          }}>チェスボード検出</button>
        </div>
      </aside>
      <header className="header"><b>Calibration</b></header>
      <main className="main">
        <section>
          <CameraCanvas stream={stream} width={640} height={360} />
        </section>
        {points && <CornerOverlay points={points} width={640} height={360} />}
      </main>
    </>
  );
}

function CornerOverlay({ points, width, height }: { points: Float32Array; width: number; height: number }) {
  return (
    <canvas
      className="canvasWrap"
      width={width}
      height={height}
      ref={(c) => {
        if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#ff3b3b";
        for (let i = 0; i < points.length; i += 2) {
          const x = points[i], y = points[i + 1];
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }}
    />
  );
}
