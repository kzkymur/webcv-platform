"use client";

export const dynamic = "error";

import DeviceSettings from "@/shared/components/DeviceSettings";
import FileSystemBrowser from "@/shared/components/FileSystemBrowser";
import CameraCanvas from "@/shared/components/CameraCanvas";
import { useCameraIds, useCameraStream } from "@/shared/hooks/useCameraStreams";
import { useState, useEffect } from "react";
import { FileEntry } from "@/shared/db/types";

export default function Page() {
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
  const [ids] = useCameraIds();
  return (
    <>
      <aside className="sidebar">
        <div className="panel">
          <h3>デバイス設定</h3>
          <DeviceSettings />
        </div>
        <div className="panel">
          <h3>ファイルシステム</h3>
          <FileSystemBrowser onSelect={setActiveFile} />
        </div>
      </aside>
      <header className="header">
        <div className="col" style={{ gap: 6 }}>
          <b>webcv-platform</b>
          <div className="row" style={{ gap: 10, fontSize: 13 }}>
            <a href="/1-syncro-checkerboard-shots">1. 撮影</a>
            <span>→</span>
            <a href="/2-calibrate-scenes">2. キャリブレーション</a>
            <span>→</span>
            <a href="/3-remap-realtime">3. リアルタイム表示</a>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section>
            <h4>選択中の Web カメラ</h4>
            <div className="col" style={{ gap: 12 }}>
              {ids.length === 0 && (
                <div style={{ opacity: 0.7 }}>
                  カメラが未選択です。左の「デバイス設定」から追加してください。
                </div>
              )}
              {ids.map((id, idx) => (
                <CameraPanel key={id || idx} deviceId={id} />
              ))}
            </div>
          </section>
          {activeFile && (
            <section>
              <h4>選択中のファイル: {activeFile.path}</h4>
              <FilePreview file={activeFile} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

function CameraPanel({ deviceId }: { deviceId?: string }) {
  const stream = useCameraStream(deviceId);
  return <CameraCanvas stream={stream} width={640} />;
}

function FilePreview({ file }: { file: FileEntry }) {
  const [imgData, setImgData] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!file) return;
    if (file.type === "rgb-image" || file.type === "grayscale-image") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const u8 = new Uint8ClampedArray(file.data);
      let rgba: Uint8ClampedArray;
      if (file.type === "grayscale-image") {
        if (file.channels === 4) {
          // Stored as RGBA grayscale already
          rgba = u8;
        } else {
          // Stored as 1 channel; expand to RGBA
          const out = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) {
            const v = u8[i];
            out[i * 4 + 0] = v;
            out[i * 4 + 1] = v;
            out[i * 4 + 2] = v;
            out[i * 4 + 3] = 255;
          }
          rgba = out;
        }
      } else {
        rgba = u8;
      }
      // Ensure ImageData receives a fresh Uint8ClampedArray backed by ArrayBuffer
      setImgData(new ImageData(new Uint8ClampedArray(rgba), w, h));
    } else {
      setImgData(null);
    }
  }, [file]);
  if (!imgData) return null;
  return (
    <canvas
      className="canvasWrap"
      width={imgData.width}
      height={imgData.height}
      ref={(c) => {
        if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.putImageData(imgData, 0, 0);
      }}
    />
  );
}
