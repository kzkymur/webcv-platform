"use client";

import DeviceSettings from "@/shared/components/DeviceSettings";
import FileSystemBrowser from "@/shared/components/FileSystemBrowser";
import CameraCanvas from "@/shared/components/CameraCanvas";
import { useCamera } from "@/shared/hooks/useCamera";
import { useState, useEffect } from "react";
import { FileEntry } from "@/shared/db/types";

export default function HomeClient() {
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
  const { stream: cam1 } = useCamera({ key: "camera:web" });
  const { stream: cam2 } = useCamera({ key: "camera:thermal" });
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
        <b>GalvoWeb 3.0</b>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section>
            <h4>Web カメラ</h4>
            <CameraCanvas stream={cam1} width={640} height={360} />
          </section>
          <section>
            <h4>サーモグラフィカメラ</h4>
            <CameraCanvas stream={cam2} width={640} height={360} />
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

function FilePreview({ file }: { file: FileEntry }) {
  const [imgData, setImgData] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!file) return;
    if (file.type === "rgb-image" || file.type === "grayscale-image") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const u8 = new Uint8ClampedArray(file.data);
      const rgba = file.type === "grayscale-image" ? (() => {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          const v = u8[i];
          out[i * 4 + 0] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
        }
        return out;
      })() : u8;
      setImgData(new ImageData(rgba, w, h));
    } else {
      setImgData(null);
    }
  }, [file]);
  if (!imgData) return null;
  return <canvas className="canvasWrap" width={imgData.width} height={imgData.height} ref={(c) => {
    if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return; ctx.putImageData(imgData, 0, 0);
  }} />;
}
