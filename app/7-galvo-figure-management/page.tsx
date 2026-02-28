"use client";

export const dynamic = "error";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles, getFile, putFile, deleteFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { RemapRenderer, type RemapDims } from "@/shared/gl/remap";
import { useCameraIds } from "@/shared/hooks/useCameraStreams";
import { WebcamSource } from "@/shared/stream/webcam";
import { listMergedVideoInputs } from "@/shared/util/devices";
import { loadRemapXY, buildIdentityInterMap } from "@/shared/util/remap";
import { invertHomography, applyHomography } from "@/shared/util/homography";
import { sanitize } from "@/shared/util/strings";
import { fileToRGBA, jsonFile } from "@/shared/util/fileEntry";
import { formatTimestamp } from "@/shared/util/time";

type HItem = { ts: string; path: string };
type FigItem = { ts: string; path: string };
type SourceMode = "live" | "still";

class FigurePreviewController {
  private renderer: RemapRenderer;
  private overlay: HTMLCanvasElement;
  private raf = 0;
  private lastFpsT = performance.now();
  private frames = 0;
  private onFps: (v: number) => void;
  private webcam: WebcamSource | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private H: Float32Array | null = null;
  private points: number[] = [];

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, onFps: (v: number) => void) {
    this.renderer = new RemapRenderer(canvas);
    this.overlay = overlay;
    this.onFps = onFps;
    this.start();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    try { this.webcam?.dispose(); } catch {}
    this.webcam = null;
    try { this.renderer.dispose(); } catch {}
  }

  getOutputSize(): RemapDims | null { return this.renderer.getOutputSize(); }

  async attachLive(deviceId: string, camName: string) {
    try { this.webcam?.dispose(); } catch {}
    this.webcam = new WebcamSource(deviceId);
    const webgl = await this.webcam.toWebGL();
    this.videoEl = webgl?.element || null;
    this.renderer.setSourceVideo(this.videoEl);
    const applyIdentity = () => {
      const v = this.videoEl!;
      const w = v.videoWidth || 0, h = v.videoHeight || 0;
      if (!w || !h) return;
      const id = buildIdentityInterMap(w, h);
      this.renderer.setUndistMapXY(id, { width: w, height: h });
      this.renderer.setInterMapXY(id, { width: w, height: h });
    };
    const v = this.videoEl;
    if (v) {
      if (v.readyState >= 2) applyIdentity();
      else v.addEventListener("loadedmetadata", applyIdentity, { once: true });
    }
    await this.applyLatestUndist(camName);
  }

  async applyLatestUndist(camName: string) {
    const files = await listFiles();
    const xy = files.filter((f) => f.type === "remapXY" && f.path.startsWith("2-calibrate-scenes/"));
    const matches: { runTs: string; path: string }[] = [];
    for (const f of xy) {
      const m = f.path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
      if (m && m[2] === camName) matches.push({ runTs: m[1], path: f.path });
    }
    matches.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
    const best = matches[0];
    if (!best) return;
    const u = await loadRemapXY(best.path);
    if (!u) return;
    this.renderer.setUndistMapXY(u.xy, { width: u.width, height: u.height });
    const id = buildIdentityInterMap(u.width, u.height);
    this.renderer.setInterMapXY(id, { width: u.width, height: u.height });
  }

  async attachStill(file: FileEntry) {
    const { rgba, width, height } = fileToRGBA(file);
    this.renderer.setSourceImage(rgba, width, height);
    const id = buildIdentityInterMap(width, height);
    this.renderer.setUndistMapXY(id, { width, height });
    this.renderer.setInterMapXY(id, { width, height });
  }

  setHomography(H: Float32Array | null) { this.H = H; }
  setPointsGalvo(arr: number[]) { this.points = arr; }

  private start() {
    const loop = () => {
      try { this.renderer.render(); } catch {}
      this.drawOverlay();
      const now = performance.now();
      this.frames++;
      if (now - this.lastFpsT >= 500) {
        this.onFps((this.frames * 1000) / (now - this.lastFpsT));
        this.frames = 0;
        this.lastFpsT = now;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private drawOverlay() {
    const size = this.renderer.getOutputSize();
    const can = this.overlay;
    if (!size) return;
    if (can.width !== size.width || can.height !== size.height) { can.width = size.width; can.height = size.height; }
    const ctx = can.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, can.width, can.height);
    const H = this.H; const pts = this.points;
    if (!H || pts.length < 2) return;
    const poly: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) poly.push(applyHomography(H, pts[i], pts[i + 1]));
    if (poly.length === 0) return;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y); ctx.closePath();
    ctx.fillStyle = "rgba(80,160,255,0.15)"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(80,160,255,0.95)"; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.95)"; for (const p of poly) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}

export default function Page() {
  // Source mode
  const [mode, setMode] = useState<SourceMode>("live");

  // Live camera selection
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");

  // Still selection
  const [stillItems, setStillItems] = useState<FileEntry[]>([]);
  const [stillSel, setStillSel] = useState<string>("");

  // GL + controller
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctrlRef = useRef<FigurePreviewController | null>(null);
  const [fps, setFps] = useState(0);

  // Homography selection
  const [hItems, setHItems] = useState<HItem[]>([]);
  const [hSel, setHSel] = useState<string>("");
  const [HMat, setHMat] = useState<Float32Array | null>(null);

  // Figure list
  const [figItems, setFigItems] = useState<FigItem[]>([]);

  // Create state
  const [creating, setCreating] = useState(false);
  const [pointsGalvo, setPointsGalvo] = useState<number[]>([]);

  // Mount: init controller + initial lists
  useEffect(() => {
    if (!canvasRef.current || !overlayCanvasRef.current) return;
    const ctrl = new FigurePreviewController(canvasRef.current, overlayCanvasRef.current, setFps);
    ctrlRef.current = ctrl;
    (async () => {
      // Devices
      try {
        const vids = await listMergedVideoInputs();
        setDevices(vids.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId })));
        const first = camIds.find((id) => !!id) || vids[0]?.deviceId || "";
        if (first) {
          setDeviceId(first);
          const camName = sanitize(vids.find((v) => v.deviceId === first)?.label || first);
          await ctrl.attachLive(first, camName);
        }
      } catch {}
      // Files: list once
      const files = await listFiles();
      const imgs = files.filter((f) => f.type === "rgb-image" || f.type === "grayscale-image");
      const items = imgs
        .map((f) => ({ f, ts: f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path }))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .map(({ f }) => f);
      setStillItems(items);
      if (!stillSel && items[0]) setStillSel(items[0].path);
      const hs = files.filter((f) => f.type === "homography-json");
      const hout: HItem[] = hs.map((f) => ({ ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path), path: f.path }))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setHItems(hout);
      setHSel((prev) => (prev && hout.some((x) => x.path === prev) ? prev : hout[0]?.path || ""));
      const figs = files.filter((f) => f.type === "figure");
      const fout: FigItem[] = figs.map((f) => ({ ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path), path: f.path }))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setFigItems(fout);
    })();
    return () => { ctrl.dispose(); ctrlRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDeviceChange(id: string) {
    setDeviceId(id);
    const label = devices.find((d) => d.deviceId === id)?.label || id;
    const camName = sanitize(label);
    if (ctrlRef.current && id) await ctrlRef.current.attachLive(id, camName);
  }

  async function handleStillChange(path: string) {
    setStillSel(path);
    const fe = path ? await getFile(path) : null;
    if (fe && ctrlRef.current) await ctrlRef.current.attachStill(fe);
  }

  function onCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (!creating) return;
    const can = canvasRef.current; const ctrl = ctrlRef.current;
    if (!ctrl || !can) return;
    const rect = can.getBoundingClientRect();
    const size = ctrl.getOutputSize();
    if (!size) return;
    const sx = (ev.clientX - rect.left) * (can.width / rect.width);
    const sy = (ev.clientY - rect.top) * (can.height / rect.height);
    if (!HMat) return;
    const Hinv = invertHomography(HMat);
    const g = applyHomography(Hinv, sx, sy);
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) return;
    setPointsGalvo((prev) => { const next = prev.concat([g.x, g.y]); ctrl.setPointsGalvo(next); return next; });
  }

  async function saveFigure() {
    if (pointsGalvo.length < 6) { alert("Need at least 3 points (closed polygon)."); return; }
    const ts = formatTimestamp(new Date());
    const path = `7-galvo-figure-management/${ts}.fig`;
    const payload = { pointsGalvo: Array.from(pointsGalvo) };
    await putFile(jsonFile(path, payload, "figure"));
    const files = await listFiles();
    const figs = files.filter((f) => f.type === "figure");
    const out: FigItem[] = figs.map((f) => ({ ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path), path: f.path }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    setFigItems(out);
    setCreating(false);
  }

  async function loadFigure(path: string) {
    const fe = await getFile(path);
    if (!fe) return;
    try {
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(fe.data)));
      const arr: number[] | undefined = Array.isArray(json?.pointsGalvo) ? json.pointsGalvo : undefined;
      if (arr && arr.length >= 2) { setPointsGalvo(arr); ctrlRef.current?.setPointsGalvo(arr); }
    } catch {}
  }

  async function deleteFigure(path: string) {
    await deleteFile(path);
    setFigItems((prev) => prev.filter((x) => x.path !== path));
  }

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>7. Galvo Figure Management</b>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <label className="row" style={{ gap: 6 }}>
              Source
              <select
                value={mode}
                onChange={async (e) => {
                  const m = e.target.value as SourceMode; setMode(m);
                  if (m === "still") {
                    if (!stillSel && stillItems[0]) await handleStillChange(stillItems[0].path);
                  } else if (m === "live" && deviceId) {
                    await handleDeviceChange(deviceId);
                  }
                }}
              >
                <option value="live">Live Camera</option>
                <option value="still">Still Image</option>
              </select>
            </label>
            {mode === "live" && (
              <label className="row" style={{ gap: 6 }}>
                Camera
                <select value={deviceId} onChange={(e) => handleDeviceChange(e.target.value)} disabled={devices.length === 0}>
                  <option value="">(unselected)</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || d.deviceId}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === "still" && (
              <label className="row" style={{ gap: 6 }}>
                Still Image
                <select value={stillSel} onChange={(e) => handleStillChange(e.target.value)}>
                  <option value="">(unselected)</option>
                  {stillItems.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>Homography (Select one)</h4>
            <div className="tree" style={{ maxHeight: 160, overflow: "auto" }}>
              {hItems.map((h) => (
                <div
                  key={h.path}
                  className={`file ${h.path === hSel ? "active" : ""}`}
                  onClick={async () => {
                    setHSel(h.path);
                    const fe = await getFile(h.path);
                    if (!fe) { setHMat(null); ctrlRef.current?.setHomography(null); return; }
                    try {
                      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(fe.data)));
                      const arr: number[] | undefined = Array.isArray(json?.H) ? json.H : (Array.isArray(json?.homography3x3) ? json.homography3x3 : undefined);
                      if (arr && arr.length === 9) {
                        const hmat = new Float32Array(arr);
                        setHMat(hmat);
                        ctrlRef.current?.setHomography(hmat);
                      } else { setHMat(null); ctrlRef.current?.setHomography(null); }
                    } catch { setHMat(null); ctrlRef.current?.setHomography(null); }
                  }}
                  title={h.path}
                >
                  <span style={{ width: 220, fontFamily: "monospace" }}>{h.ts}</span>
                  <span>{h.path}</span>
                </div>
              ))}
              {hItems.length === 0 && (
                <div style={{ opacity: 0.7 }}>No homography files found.</div>
              )}
            </div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>H: {HMat ? "loaded" : "-"}</div>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Preview & Create</h4>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <span style={{ opacity: 0.75 }}>FPS: {fps.toFixed(1)}</span>
              <button
                onClick={() => { setCreating(true); setPointsGalvo([]); ctrlRef.current?.setPointsGalvo([]); }}
                disabled={!HMat}
                title={!HMat ? "Load a homography first" : ""}
              >
                Create Start
              </button>
              <button
                onClick={saveFigure}
                disabled={!creating || pointsGalvo.length < 6}
                title={!creating ? "Click Create Start" : pointsGalvo.length < 6 ? "Add ≥ 3 points" : ""}
              >
                Create End
              </button>
              <button onClick={() => { setPointsGalvo([]); ctrlRef.current?.setPointsGalvo([]); }} disabled={!creating}>Clear</button>
              {mode === "still" && (
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  Note: still image is assumed undistorted.
                </span>
              )}
            </div>
            <div className="canvasWrap">
              <canvas ref={canvasRef} onClick={onCanvasClick} />
              <canvas ref={overlayCanvasRef} className="canvasOverlay" />
            </div>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Figures</h4>
            <div className="tree" style={{ maxHeight: 200, overflow: "auto" }}>
              {figItems.map((f) => (
                <div key={f.path} className="file" title={f.path}>
                  <span style={{ width: 220, fontFamily: "monospace" }}>{f.ts}</span>
                  <span style={{ flex: 1 }}>{f.path}</span>
                  <button onClick={() => loadFigure(f.path)}>Load</button>
                  <button onClick={() => deleteFigure(f.path)}>Delete</button>
                </div>
              ))}
              {figItems.length === 0 && <div style={{ opacity: 0.7 }}>No figures saved yet.</div>}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

