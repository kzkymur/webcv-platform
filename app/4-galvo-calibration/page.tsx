"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { getFile, listFiles, putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { SerialCommunicator } from "@/shared/hardware/serial";
import { RemapRenderer } from "@/shared/gl/remap";
import { useCameraIds, useCameraStream } from "@/shared/hooks/useCameraStreams";
import { formatTimestamp } from "@/shared/util/time";
import { WasmWorkerClient } from "@/shared/wasm/client";

type UndistItem = {
  runTs: string;
  cam: string; // single camera undistortion map
  mapXYPath: string;
};

async function loadRemapXY(
  path: string
): Promise<{ xy: Float32Array; width: number; height: number } | null> {
  const f = await getFile(path);
  if (!f || f.type !== "remapXY" || !f.width || !f.height) return null;
  const xy = new Float32Array(f.data);
  if (xy.length !== f.width * f.height * 2) return null;
  return { xy, width: f.width, height: f.height };
}

export default function Page() {
  const [items, setItems] = useState<UndistItem[]>([]);
  const [selKey, setSelKey] = useState<string>("");
  const selected = useMemo(
    () => items.find((x) => x.mapXYPath === selKey) || null,
    [items, selKey]
  );

  // Camera device selection
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>(
    []
  );
  const [deviceId, setDeviceId] = useState<string>("");
  const stream = useCameraStream(deviceId);

  // GL renderer (undist pass + identity pass) + overlay
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rendererRef = useRef<RemapRenderer | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const spotsRef = useRef<{ pts: { x: number; y: number }[]; last: { x: number; y: number } | null }>({ pts: [], last: null });

  // Serial
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [serialOk, setSerialOk] = useState(false);

  // Run params
  const [grid, setGrid] = useState<{ nx: number; ny: number }>({ nx: 8, ny: 8 });
  const [xRange, setXRange] = useState<{ min: number; max: number }>({
    min: 8192,
    max: 57344,
  });
  const [yRange, setYRange] = useState<{ min: number; max: number }>({
    min: 8192,
    max: 57344,
  });
  const [laserPct, setLaserPct] = useState<number>(5);
  // Timing: settle is fixed at 10 ms (no UI control)
  const [timing, setTiming] = useState<{ settleMs: number; onMs: number; offMs: number }>(
    { settleMs: 10, onMs: 120, offMs: 80 }
  );

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [fps, setFps] = useState(0);
  const rafRef = useRef<number>(0);
  const cancelRef = useRef<boolean>(false);

  const workerRef = useRef<WasmWorkerClient | null>(null);
  useEffect(() => {
    workerRef.current = new WasmWorkerClient();
    return () => {
      workerRef.current?.dispose();
      workerRef.current = null;
    };
  }, []);

  function appendLog(s: string) {
    setLog((prev) => (prev ? prev + "\n" : "") + s);
  }

  // Enumerate devices; default to first selected id
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        const vids = (list || []).filter((d) => d.kind === "videoinput");
        const vmin = vids.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }));
        if (!mounted) return;
        setDevices(vmin);
        const first = camIds.find((id) => !!id) || "";
        setDeviceId((prev) => (prev ? prev : first));
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [camIds]);

  // Wire stream to hidden <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream || null;
    if (stream) v.play().catch(() => {});
  }, [stream]);

  // Init renderer on mount
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = new RemapRenderer(c);
    rendererRef.current = r;
    return () => {
      try {
        r.dispose();
      } catch {}
      rendererRef.current = null;
    };
  }, []);

  // Push video to renderer
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setSourceVideo(videoRef.current || null);
  }, [rendererRef.current, stream]);

  // Load undist map and set identity inter map on selection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = rendererRef.current;
      if (!r || !selected) return;
      const u = await loadRemapXY(selected.mapXYPath);
      if (!u || cancelled) return;
      r.setUndistMapXY(u.xy, { width: u.width, height: u.height });
      const id = new Float32Array(u.width * u.height * 2);
      let idx = 0;
      for (let y = 0; y < u.height; y++) {
        for (let x = 0; x < u.width; x++) {
          id[idx++] = x;
          id[idx++] = y;
        }
      }
      r.setInterMapXY(id, { width: u.width, height: u.height });
      // reset overlay when selection changes
      spotsRef.current = { pts: [], last: null };
    })();
    return () => {
      cancelled = true;
    };
  }, [selKey]);

  // Render loop
  useEffect(() => {
    let mounted = true;
    let lastT = performance.now();
    let frames = 0;
    const loop = () => {
      const r = rendererRef.current;
      if (!mounted) return;
      if (r) r.render();
      drawOverlay();
      frames++;
      const now = performance.now();
      if (now - lastT >= 500) {
        setFps((frames * 1000) / (now - lastT));
        frames = 0;
        lastT = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Clear overlay when toggled off
  useEffect(() => {
    const can = overlayCanvasRef.current;
    if (!can) return;
    if (!showOverlay) {
      const ctx = can.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, can.width, can.height);
    }
  }, [showOverlay]);

  // Discover undistortion maps
  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const xy = files.filter(
        (f) => f.path.startsWith("2-calibrate-scenes/") && /_remapXY\.xy$/.test(f.path)
      );
      const out: UndistItem[] = [];
      for (const f of xy) {
        const m = f.path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
        if (m) out.push({ runTs: m[1], cam: m[2], mapXYPath: f.path });
      }
      out.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      setItems(out);
      setSelKey((prev) => (prev && out.some((x) => x.mapXYPath === prev) ? prev : out[0]?.mapXYPath || ""));
    })();
  }, []);

  async function captureFrame(): Promise<{ rgba: Uint8Array; width: number; height: number } | null> {
    const r = rendererRef.current;
    if (!r) return null;
    const rgba = r.readPixels();
    const size = r.getOutputSize();
    if (!size) return null;
    return { rgba, width: size.width, height: size.height };
  }

  function drawOverlay() {
    if (!showOverlay) return;
    const r = rendererRef.current;
    const can = overlayCanvasRef.current;
    if (!r || !can) return;
    const size = r.getOutputSize();
    if (!size) return;
    if (can.width !== size.width || can.height !== size.height) {
      can.width = size.width;
      can.height = size.height;
    }
    const ctx = can.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, can.width, can.height);
    const pts = spotsRef.current.pts;
    // Draw accumulated points
    ctx.save();
    ctx.fillStyle = "rgba(0,255,0,0.7)";
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Highlight last point
    const last = spotsRef.current.last;
    if (last) {
      ctx.strokeStyle = "rgba(255,80,80,0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Counter
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const txt = `${pts.length}/${grid.nx * grid.ny}`;
    const pad = 4;
    const w = ctx.measureText(txt).width + pad * 2;
    const h = 16;
    ctx.fillRect(8, 8, w, h);
    ctx.fillStyle = "#eaeaea";
    ctx.fillText(txt, 8 + pad, 8 + 12);
    ctx.restore();
  }

  function buildGrid(): { x: number; y: number }[] {
    const list: { x: number; y: number }[] = [];
    const xs = grid.nx;
    const ys = grid.ny;
    const xStep = xs > 1 ? Math.round((xRange.max - xRange.min) / (xs - 1)) : 0;
    const yStep = ys > 1 ? Math.round((yRange.max - yRange.min) / (ys - 1)) : 0;
    for (let j = 0; j < ys; j++) {
      for (let i = 0; i < xs; i++) {
        const x = xRange.min + i * xStep;
        const y = yRange.min + j * yStep;
        list.push({ x, y });
      }
    }
    return list;
  }

  function estimateSpot(screen: Uint8Array, shot: Uint8Array, w: number, h: number): { cx: number; cy: number } | null {
    // Simple diff on RGB sum; find brightest pixel and refine with 3x3 weighted centroid
    let bestIdx = -1;
    let bestVal = -1;
    const row = w * 4;
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p += 4) {
        const dr = Math.max(0, shot[p] - screen[p]);
        const dg = Math.max(0, shot[p + 1] - screen[p + 1]);
        const db = Math.max(0, shot[p + 2] - screen[p + 2]);
        const s = dr + dg + db;
        if (s > bestVal) {
          bestVal = s;
          bestIdx = p;
        }
      }
    }
    if (bestIdx < 0 || bestVal < 10) return null;
    const by = Math.floor(bestIdx / row);
    const bx = (bestIdx % row) / 4;
    // local centroid
    let sumW = 0;
    let cx = 0;
    let cy = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = by + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = bx + dx;
        if (xx < 0 || xx >= w) continue;
        const p = yy * row + xx * 4;
        const dr = Math.max(0, shot[p] - screen[p]);
        const dg = Math.max(0, shot[p + 1] - screen[p + 1]);
        const db = Math.max(0, shot[p + 2] - screen[p + 2]);
        const wgt = dr + dg + db;
        sumW += wgt;
        cx += wgt * xx;
        cy += wgt * yy;
      }
    }
    if (sumW <= 0) return { cx: bx, cy: by };
    return { cx: cx / sumW, cy: cy / sumW };
  }

  async function runCalibration() {
    if (!selected) return;
    if (!serial) {
      alert("Connect to the microcontroller first.");
      return;
    }
    const wrk = workerRef.current;
    if (!wrk) return;
    cancelRef.current = false;
    setBusy(true);
    setLog("");
    spotsRef.current = { pts: [], last: null };
    const ts = formatTimestamp(new Date());
    appendLog(`Run ${ts} — grid ${grid.nx}×${grid.ny}, laser ${laserPct}%`);

    // Acquire baseline screen frame (undistorted)
    const base = await captureFrame();
    if (!base) {
      appendLog("No camera frame available.");
      setBusy(false);
      return;
    }
    const basePath = `4-galvo-calibration/${ts}/screen.rgb`;
    await putFile({
      path: basePath,
      type: "rgb-image",
      data: base.rgba.buffer as ArrayBuffer,
      width: base.width,
      height: base.height,
      channels: 4,
    } satisfies FileEntry);
    appendLog(`Saved baseline: ${basePath}`);

    // Iterate grid
    const positions = buildGrid();
    const camPts: number[] = [];
    const galvoPts: number[] = [];
    let okShots = 0;
    for (let i = 0; i < positions.length; i++) {
      if (cancelRef.current) break;
      const { x, y } = positions[i];
      appendLog(`(${i + 1}/${positions.length}) Move galvo: ${x}, ${y}`);
      try {
        await serial.setGalvoPos(x, y);
      } catch (e) {
        appendLog(`Serial error on setGalvoPos: ${String(e)}`);
        break;
      }
      // Fixed settling delay (10 ms)
      await sleep(timing.settleMs);

      // Laser ON
      try {
        await serial.setLaserOutput(laserPct);
      } catch (e) {
        appendLog(`Serial error on setLaserOutput(ON): ${String(e)}`);
        break;
      }
      await sleep(timing.onMs);

      const shot = await captureFrame();
      // Laser OFF asap
      try {
        await serial.setLaserOutput(0);
      } catch {}
      await sleep(timing.offMs);

      if (!shot) {
        appendLog("Frame capture failed; skipping");
        continue;
      }

      const shotPath = `4-galvo-calibration/${ts}/x-${x}_y-${y}.rgb`;
      await putFile({
        path: shotPath,
        type: "rgb-image",
        data: shot.rgba.buffer as ArrayBuffer,
        width: shot.width,
        height: shot.height,
        channels: 4,
      } satisfies FileEntry);

      const spot = estimateSpot(base.rgba, shot.rgba, shot.width, shot.height);
      if (spot) {
        camPts.push(spot.cx, spot.cy);
        galvoPts.push(x, y);
        okShots++;
        spotsRef.current.pts.push({ x: spot.cx, y: spot.cy });
        spotsRef.current.last = { x: spot.cx, y: spot.cy };
      } else {
        appendLog("No laser spot detected in diff.");
      }
    }

    // Safety: ensure laser is off at end
    try {
      await serial.setLaserOutput(0);
    } catch {}

    appendLog(`Detected ${okShots} spots (of ${positions.length}).`);
    if (okShots >= 4) {
      const Hres = await wrk.cvCalcHomography(
        new Float32Array(galvoPts),
        new Float32Array(camPts)
      );
      const H = Array.from(Hres.H);
      const out = {
        H,
        points: {
          galvo: Array.from(galvoPts),
          camera: Array.from(camPts),
        },
        params: {
          grid,
          xRange,
          yRange,
          laserPct,
          timing,
          undistMap: selected.mapXYPath,
          cam: selected.cam,
          runTs: selected.runTs,
        },
      };
      const json = new TextEncoder().encode(JSON.stringify(out, null, 2));
      const homPath = `4-galvo-calibration/${ts}-homography.json`;
      await putFile({ path: homPath, type: "other", data: json.buffer as ArrayBuffer } as FileEntry);
      appendLog(`Saved homography: ${homPath}`);
    } else {
      appendLog("Insufficient points for homography (need ≥ 4).");
    }
    setBusy(false);
  }

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>4. Galvo Calibration</b>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <label className="row" style={{ gap: 6 }}>
              Source Camera
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                disabled={devices.length === 0}
              >
                <option value="">(unselected)</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
                ))}
              </select>
            </label>
            <span style={{ opacity: 0.75 }}>
              Expecting: <code>{selected?.cam || "-"}</code>
            </span>
            <button
              onClick={async () => {
                if (serialOk) return;
                const s = new SerialCommunicator();
                const ok = await s.connect();
                if (ok) {
                  setSerial(s);
                  setSerialOk(true);
                } else {
                  try { await s.disconnect(); } catch {}
                  setSerial(null);
                  setSerialOk(false);
                }
              }}
              disabled={serialOk}
            >
              {serialOk ? "Connected" : "Connect Microcontroller"}
            </button>
            {serialOk && (
              <button
                onClick={async () => {
                  try { await serial?.disconnect(); } catch {}
                  setSerial(null);
                  setSerialOk(false);
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>Undistortion Map (Select one)</h4>
            <div className="tree" style={{ maxHeight: 220, overflow: "auto" }}>
              {items.map((p) => (
                <div
                  key={p.mapXYPath}
                  className={`file ${p.mapXYPath === selKey ? "active" : ""}`}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                  onClick={() => setSelKey(p.mapXYPath)}
                  title={p.mapXYPath}
                >
                  <span style={{ width: 220, fontFamily: "monospace" }}>{p.runTs}</span>
                  <span>Undistort: {p.cam}</span>
                </div>
              ))}
              {items.length === 0 && (
                <div style={{ opacity: 0.7 }}>No undistortion maps found (generate in /2).</div>
              )}
            </div>
            {selected && (
              <div style={{ opacity: 0.8, fontSize: 13 }}>XY: {selected.mapXYPath}</div>
            )}
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Preview (undistorted)</h4>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <button
                onClick={async () => {
                  const f = await captureFrame();
                  if (!f) return;
                  const ts = formatTimestamp(new Date());
                  const path = `4-galvo-calibration/${ts}/manual-preview.rgb`;
                  await putFile({ path, type: "rgb-image", data: f.rgba.buffer as ArrayBuffer, width: f.width, height: f.height, channels: 4 });
                  alert(`Saved: ${path}`);
                }}
                disabled={!selected}
              >
                Save Frame
              </button>
              <span style={{ opacity: 0.75 }}>FPS: {fps.toFixed(1)}</span>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
                Show overlay
              </label>
              <button onClick={() => (spotsRef.current = { pts: [], last: null })} disabled={!showOverlay}>
                Clear overlay
              </button>
            </div>
            <div className="canvasWrap">
              <canvas ref={canvasRef} />
              <canvas ref={overlayCanvasRef} className="canvasOverlay" />
            </div>
            <video ref={videoRef} style={{ display: "none" }} />
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Run Calibration</h4>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 6 }}>
                Grid X
                <input
                  type="number"
                  min={2}
                  max={64}
                  value={grid.nx}
                  onChange={(e) => setGrid({ ...grid, nx: Math.max(2, Math.min(64, Number(e.target.value) | 0)) })}
                  style={{ width: 70 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                Grid Y
                <input
                  type="number"
                  min={2}
                  max={64}
                  value={grid.ny}
                  onChange={(e) => setGrid({ ...grid, ny: Math.max(2, Math.min(64, Number(e.target.value) | 0)) })}
                  style={{ width: 70 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                X min
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={xRange.min}
                  onChange={(e) => setXRange({ ...xRange, min: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
                  style={{ width: 90 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                X max
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={xRange.max}
                  onChange={(e) => setXRange({ ...xRange, max: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
                  style={{ width: 90 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                Y min
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={yRange.min}
                  onChange={(e) => setYRange({ ...yRange, min: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
                  style={{ width: 90 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                Y max
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={yRange.max}
                  onChange={(e) => setYRange({ ...yRange, max: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
                  style={{ width: 90 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                Laser (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={laserPct}
                  onChange={(e) => setLaserPct(Math.max(0, Math.min(100, Number(e.target.value) | 0)))}
                  style={{ width: 70 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                Laser ON (ms)
                <input
                  type="number"
                  min={10}
                  max={2000}
                  value={timing.onMs}
                  onChange={(e) => setTiming({ ...timing, onMs: Math.max(10, Math.min(2000, Number(e.target.value) | 0)) })}
                  style={{ width: 90 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                After OFF wait (ms)
                <input
                  type="number"
                  min={0}
                  max={2000}
                  value={timing.offMs}
                  onChange={(e) => setTiming({ ...timing, offMs: Math.max(0, Math.min(2000, Number(e.target.value) | 0)) })}
                  style={{ width: 110 }}
                />
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                onClick={runCalibration}
                disabled={busy || !selected || !serialOk}
                title={!serialOk ? "Connect Microcontroller first" : undefined}
              >
                {busy ? "Running…" : "Start"}
              </button>
              {busy && (
                <button
                  onClick={() => {
                    cancelRef.current = true;
                    appendLog("Cancel requested; finishing current step…");
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Log</h4>
            <pre
              style={{
                minHeight: 120,
                maxHeight: 240,
                overflow: "auto",
                background: "#111",
                color: "#eaeaea",
                padding: 8,
                borderRadius: 4,
                whiteSpace: "pre-wrap",
              }}
            >
              {log}
            </pre>
          </section>
        </div>
      </main>
    </>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
