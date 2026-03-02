"use client";

export const dynamic = "error";

import Sidebar from "@/components/Sidebar";
import { useMemo, useState } from "react";
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
                <a href="/1-syncro-checkerboard-shots">
                  <b>1. Syncro Checkerboard Shots</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Capture checkerboard or scene frames from selected cameras in
                  sync. Each trigger saves RGBA images into the built‑in
                  database (OPFS via SQLite Wasm) under
                  <code>
                    {" "}
                    1-syncro-checkerboard_shots/&lt;timestamp&gt;/cam-&lt;name&gt;.rgb
                  </code>
                  . Stand‑alone tool commonly used to gather calibration inputs.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/2-calibrate-scenes">
                  <b>2. Calibrate Scenes</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Detect chessboard corners and compute per‑camera intrinsics
                  and undistortion maps (single‑camera workflow). Outputs are
                  stored under <code>2-calibrate-scenes/&lt;runTs&gt;/</code> such
                  as per‑camera <code>cam-&lt;name&gt;_calibration.json</code> and
                  <code>cam-&lt;name&gt;_remapXY.xy</code>.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/3-remap-realtime">
                  <b>3. Remap Realtime</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Preview and apply generated remap fields in real time (WebGL).
                  Select an undistortion map (and future inter‑camera options);
                  live application is being integrated next.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/4-galvo-calibration">
                  <b>4. Galvo Calibration</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Calibrate galvo XY to camera coordinates. Uses an
                  undistorted live camera feed, drives the microcontroller to
                  scan a grid (laser ON/OFF per step), detects laser spots via
                  pixel diff, and solves a homography (OpenCV/WASM). Outputs
                  frames under <code>4-galvo-calibration/&lt;ts&gt;/</code> and a
                  homography JSON at
                  <code>4-galvo-calibration/&lt;ts&gt;-homography.json</code>.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/5-laser-manual-operation">
                  <b>5. Laser Manual Operation</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Manually drive the galvo and laser using a live, undistorted
                  camera preview. Select a per‑camera undistortion map and a
                  homography from galvo→camera (from step 4). When “Galvo Sync”
                  is enabled, clicking on the canvas maps that pixel to galvo
                  coordinates and moves the mirrors; adjust laser power with the
                  percentage control (0–100).
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/6-cameras-homography">
                  <b>6. Cameras Homography</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Choose Camera A/B and a common timestamp; previews show
                  undistorted frames (using page 2 maps). Computes a homography
                  in the undistorted domain from the single selected pair and
                  saves frames and JSON under
                  <code>6-cameras-homography/&lt;runTs&gt;/</code>.
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="col" style={{ gap: 6 }}>
                <a href="/7-galvo-figure-management">
                  <b>7. Galvo Figure Management</b>
                </a>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  Create and manage target polygons directly in the galvo plane.
                  Click on the preview to add vertices (auto‑closed polygon) and
                  save as <code>7-galvo-figure-management/&lt;timestamp&gt;.fig</code>
                  with type <code>figure</code>. Supports both live camera (with
                  the latest per‑camera undistortion map) and still images; uses
                  a selected homography only for projection/preview.
                </div>
              </div>
            </div>
          </section>
          {activeFile && (
            <section>
              <FilePreview file={activeFile} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

function FilePreview({ file }: { file: FileEntry }) {
  const { imgData, jsonText, jsonObj } = useMemo(() => {
    if (!file || !file.data) return { imgData: null, jsonText: null, jsonObj: null };

    const isJson = file.path.toLowerCase().endsWith(".json");
    if (isJson) {
      try {
        const raw = new TextDecoder("utf-8").decode(new Uint8Array(file.data));
        try {
          const parsed = JSON.parse(raw);
          return { imgData: null, jsonText: JSON.stringify(parsed, null, 2), jsonObj: parsed };
        } catch {
          return { imgData: null, jsonText: raw, jsonObj: null };
        }
      } catch {
        return { imgData: null, jsonText: "<unable to decode JSON file>", jsonObj: null };
      }
    }

    // Vector field preview: optical-flow / remapXY as HSV color wheel
    if (file.type === "optical-flow" || file.type === "remapXY") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const n = w * h;
      if (n === 0) return { imgData: null, jsonText: null, jsonObj: null };
      const xy = new Float32Array(file.data);
      if (xy.length !== n * 2) return { imgData: null, jsonText: null, jsonObj: null };
      const rgba = new Uint8ClampedArray(n * 4);
      const mags: number[] = new Array(n);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const j = i * 2;
          const vx = file.type === "remapXY" ? xy[j] - x : xy[j];
          const vy = file.type === "remapXY" ? xy[j + 1] - y : xy[j + 1];
          mags[i] = Math.hypot(vx, vy);
        }
      }
      const sorted = mags.slice().sort((a, b) => a - b);
      const max = sorted[Math.floor(sorted.length * 0.98)] || 1; // 98th percentile
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
          const vx = file.type === "remapXY" ? xy[j] - x : xy[j];
          const vy = file.type === "remapXY" ? xy[j + 1] - y : xy[j + 1];
          const ang = Math.atan2(vy, vx);
          const deg = (ang * 180) / Math.PI;
          const hue = (deg + 360) % 360;
          const mag = Math.min(1, mags[i] / (max || 1));
          const [r, g, b] = hsv2rgb(hue, 1, mag);
          const k = i * 4;
          rgba[k] = r as number;
          rgba[k + 1] = g as number;
          rgba[k + 2] = b as number;
          rgba[k + 3] = 255;
        }
      }
      return { imgData: new ImageData(rgba, w, h), jsonText: null, jsonObj: null };
    }

    // Image preview: RGBA/grayscale → RGBA ImageData
    if (file.type === "rgb-image" || file.type === "grayscale-image") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const u8 = new Uint8ClampedArray(file.data);
      let rgba: Uint8ClampedArray;
      if (file.type === "grayscale-image") {
        if (file.channels === 4) {
          rgba = u8;
        } else {
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
      return { imgData: new ImageData(new Uint8ClampedArray(rgba), w, h), jsonText: null, jsonObj: null };
    }
    return { imgData: null, jsonText: null, jsonObj: null };
  }, [file]);

  function shapeLabel(): string {
    // Binary types with width/height
    if (file.type === "rgb-image" || file.type === "grayscale-image") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const c = file.channels ?? 4;
      return `uint8 [${h}×${w}${c ? `×${c}` : ""}]`;
    }
    if (file.type === "remapXY") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      return `float32 [${h}×${w}×2]`;
    }
    if (file.type === "remap") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      return `float32 [${h}×${w}]`;
    }
    if (file.type === "optical-flow") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      return `float32 [${h}×${w}×2]`;
    }
    // JSON and others
    if (jsonObj && typeof jsonObj === "object") {
      if (
        Array.isArray(jsonObj.homography3x3) &&
        jsonObj.homography3x3.length === 9
      ) {
        return "homography3x3: [3×3]";
      }
      if (
        Array.isArray(jsonObj.intrinsics3x3) &&
        jsonObj.intrinsics3x3.length === 9
      ) {
        const w = jsonObj.width ?? file.width ?? "?";
        const h = jsonObj.height ?? file.height ?? "?";
        const distN = Array.isArray(jsonObj.distCoeffs)
          ? jsonObj.distCoeffs.length
          : "?";
        return `calibration: image [${h}×${w}], intrinsics [3×3], distCoeffs [${distN}]`;
      }
    }
    // Fallback
    return "(shape unknown)";
  }


  const header = (
    <div
      className="row"
      style={{ gap: 8, alignItems: "baseline", marginBottom: 6 }}
    >
      <h4 style={{ margin: 0, fontWeight: 600 }}>Selected File:</h4>
      <code style={{ fontSize: 12 }}>{file.path}</code>
      <span style={{ opacity: 0.7, fontSize: 12 }}>· {shapeLabel()}</span>
    </div>
  );

  if (jsonText !== null) {
    return (
      <>
        {header}
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
      </>
    );
  }

  if (!imgData) return null;
  return (
    <>
      {header}
      <div className="canvasWrap">
        <canvas
          width={imgData.width}
          height={imgData.height}
          ref={(c) => {
            if (!c) return;
            const ctx = c.getContext("2d");
            if (!ctx) return;
            ctx.putImageData(imgData, 0, 0);
          }}
        />
      </div>
    </>
  );
}
