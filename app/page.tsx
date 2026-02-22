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
                  Outputs are stored under <code>2-calibrate-scenes/</code> such as per‑camera <code>_calibration.json</code>, per‑camera <code>_remapXY.xy</code>, and per‑pair <code>_H_undist.json</code>, <code>_mappingXY.xy</code>.
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
  const [jsonText, setJsonText] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;

    // JSON preview: pretty-print .json files
    const isJson = file.path.toLowerCase().endsWith(".json");
    if (isJson) {
      try {
        const raw = new TextDecoder("utf-8").decode(new Uint8Array(file.data));
        try {
          const parsed = JSON.parse(raw);
          setJsonText(JSON.stringify(parsed, null, 2));
        } catch {
          // Not valid JSON? Show as plain text
          setJsonText(raw);
        }
      } catch {
        setJsonText("<unable to decode JSON file>");
      }
      setImgData(null);
      return;
    }

    setJsonText(null);

    // Vector field preview: optical-flow / remapXY as HSV color wheel
    if (file.type === "optical-flow" || file.type === "remapXY") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const n = w * h;
      if (n === 0) { setImgData(null); return; }
      const xy = new Float32Array(file.data);
      if (xy.length !== n * 2) { setImgData(null); return; }
      const rgba = new Uint8ClampedArray(n * 4);
      // Determine magnitude scale using a percentile to avoid outliers
      const mags: number[] = new Array(n);
      // For remapXY, visualize displacement (sx-x, sy-y); for optical-flow assume (u,v)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const j = i * 2;
          const vx = file.type === "remapXY" ? (xy[j] - x) : xy[j];
          const vy = file.type === "remapXY" ? (xy[j + 1] - y) : xy[j + 1];
          mags[i] = Math.hypot(vx, vy);
        }
      }
      const sorted = mags.slice().sort((a, b) => a - b);
      const max = sorted[Math.floor(sorted.length * 0.98)] || 1; // 98th percentile
      // Map angle→hue, magnitude→value
      function hsv2rgb(h: number, s: number, v: number) {
        const c = v * s;
        const hp = h / 60;
        const x = c * (1 - Math.abs((hp % 2) - 1));
        let r = 0, g = 0, b = 0;
        if (hp >= 0 && hp < 1) { r = c; g = x; b = 0; }
        else if (hp < 2) { r = x; g = c; b = 0; }
        else if (hp < 3) { r = 0; g = c; b = x; }
        else if (hp < 4) { r = 0; g = x; b = c; }
        else if (hp < 5) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }
        const m = v - c;
        return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const j = i * 2;
          const vx = file.type === "remapXY" ? (xy[j] - x) : xy[j];
          const vy = file.type === "remapXY" ? (xy[j + 1] - y) : xy[j + 1];
          const ang = Math.atan2(vy, vx); // -pi..pi
          const deg = (ang * 180) / Math.PI; // -180..180
          const hue = (deg + 360) % 360; // 0..360
          const mag = Math.min(1, mags[i] / (max || 1));
          const [r, g, b] = hsv2rgb(hue, 1, mag);
          const k = i * 4;
          rgba[k + 0] = r;
          rgba[k + 1] = g;
          rgba[k + 2] = b;
          rgba[k + 3] = 255;
        }
      }
      setImgData(new ImageData(rgba, w, h));
      return;
    }

    // Image preview: RGBA/grayscale → RGBA ImageData
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

  if (jsonText !== null) {
    return (
      <pre
        style={{
          border: "1px solid #3333",
          borderRadius: 8,
          padding: 10,
          margin: 0,
          overflow: "auto",
          maxHeight: 480,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          whiteSpace: "pre",
          background: "transparent",
        }}
      >
        {jsonText}
      </pre>
    );
  }

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
