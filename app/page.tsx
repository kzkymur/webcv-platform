"use client";

export const dynamic = "error";

import Sidebar from "@/components/Sidebar";
import { useState, useEffect } from "react";
import { FileEntry } from "@/shared/db/types";

export default function Page() {
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
  return (
    <>
      <Sidebar onSelectFile={setActiveFile} />
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h3>Feature Index</h3>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/1-syncro-checkerboard-shots"><b>1. Syncro Checkerboard Shots</b></a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Capture checkerboard or scene frames from selected cameras in sync. Each trigger saves RGBA images into the built‑in database (OPFS via SQLite Wasm) under
                  <code> 1-syncro-checkerboard_shots/&lt;timestamp&gt;_cam-&lt;name&gt;</code>. Stand‑alone tool commonly used to gather calibration inputs.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/2-calibrate-scenes"><b>2. Calibrate Scenes</b></a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Detect chessboard corners and compute per‑camera intrinsics/extrinsics (OpenCV via WebAssembly). Generates undistortion maps and optional inter‑camera mappings (undistorted domain).
                  Outputs are stored under <code>2-calibrate-scenes/</code> such as <code>_intrinsics.json</code>, <code>_distCoeffs.json</code>, <code>_remapX/Y</code>, and per‑pair <code>_H_undist.json</code>, <code>_mappingX/Y</code>.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/3-remap-realtime"><b>3. Remap Realtime</b></a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Preview and apply generated remap fields in real time (WebGL). Select a mapping pair to inspect; live application is being integrated next.
                </div>
              </div>
            </div>
          </section>
          {activeFile && (
            <section>
              <h4>Selected File: {activeFile.path}</h4>
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
