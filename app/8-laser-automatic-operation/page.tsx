"use client";

export const dynamic = "error";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles, getFile, putFile, deleteFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { formatTimestamp } from "@/shared/util/time";
import { jsonFile } from "@/shared/util/fileEntry";
import { IndependentSequencer, IndependentFragment } from "@kzkymur/sequencer";
import { ScanStrategies, OutlineStrategy, type ScanStrategy } from "@/shared/scan/strategies";
import { SerialCommunicator } from "@/shared/module/serialInterface";
import { RemapRenderer } from "@/shared/gl/remap";
import { listMergedVideoInputs } from "@/shared/util/devices";
import { useCameraIds } from "@/shared/hooks/useCameraStreams";
import { useVideoSource } from "@/shared/hooks/useVideoSource";
import { sanitize } from "@/shared/util/strings";
import { buildIdentityInterMap, loadRemapXY } from "@/shared/util/remap";
import { applyHomography } from "@/shared/util/homography";

type HItem = { ts: string; path: string };
type FigItem = { ts: string; path: string };
type SeqItem = { ts: string; path: string };
const TIMELINE_CSS_WIDTH = 720;
const TIMELINE_CSS_HEIGHT = 100;
type OverlayFigure = { pointsGalvo: number[]; startMs: number; durationMs: number };

type SequenceV1 = {
  schemaVersion: 1;
  notes?: string;
  fragments: ({
    type: "scan-figure";
    t: number; // sec from 0
    duration: number; // sec
    figurePath: string;
    mode?: string; // 'outline' | 'raster' | 'grid-raster-inward'
    cycleSec?: number; // mode cycle period in sec (default: 1)
    rateHz?: number;
    laserPct?: number; // optional laser output during scan
  })[];
};

function parseFigurePointsFromFile(file: FileEntry | null | undefined): number[] {
  if (!file?.data) return [];
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(file.data)));
    if (!Array.isArray(json?.pointsGalvo)) return [];
    const pts = json.pointsGalvo as number[];
    const out: number[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = Number(pts[i]);
      const y = Number(pts[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push(x, y);
    }
    return out;
  } catch {
    return [];
  }
}

// --- Preview controller: Live undist + overlay dot of current galvo pos ---
class AutoPreviewController {
  private renderer: RemapRenderer | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private raf = 0;
  private videoEl: HTMLVideoElement | null = null;
  private lastFpsT = performance.now();
  private frames = 0;
  private onFps: (v: number) => void;
  private H: Float32Array | null = null; // galvo->camera
  private dotGalvo: { x: number; y: number } | null = null;
  private overlayFigures: OverlayFigure[] = [];
  private playbackTimeMs = 0;
  private isPlaying = false;
  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, onFps: (v: number) => void) {
    this.renderer = new RemapRenderer(canvas);
    this.overlay = overlay;
    this.onFps = onFps;
    this.start();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    try { this.renderer?.dispose(); } catch {}
    this.renderer = null; this.overlay = null; this.videoEl = null;
  }
  async attachVideo(element: HTMLVideoElement | null) {
    this.videoEl = element;
    this.renderer?.setSourceVideo(element);
  }
  setUndistMap(u: { xy: Float32Array; width: number; height: number } | null) {
    if (!this.renderer) return;
    if (!u) return;
    this.renderer.setUndistMapXY(u.xy, { width: u.width, height: u.height });
    const id = buildIdentityInterMap(u.width, u.height);
    this.renderer.setInterMapXY(id, { width: u.width, height: u.height });
  }
  setIdentityByVideo() {
    if (!this.renderer || !this.videoEl) return;
    const w = this.videoEl.videoWidth || 0; const h = this.videoEl.videoHeight || 0;
    if (!w || !h) return;
    const id = buildIdentityInterMap(w, h);
    this.renderer.setUndistMapXY(id, { width: w, height: h });
    this.renderer.setInterMapXY(id, { width: w, height: h });
  }
  setHomography(H: Float32Array | null) { this.H = H; }
  setDotGalvo(p: { x: number; y: number } | null) { this.dotGalvo = p; }
  setOverlayFigures(figures: OverlayFigure[]) { this.overlayFigures = figures; }
  setPlaybackTimeMs(timeMs: number) { this.playbackTimeMs = Math.max(0, timeMs); }
  setPlaying(v: boolean) { this.isPlaying = v; }
  private start() {
    const loop = () => {
      try { this.renderer?.render(); } catch {}
      this.drawOverlay();
      const now = performance.now(); this.frames++; if (now - this.lastFpsT >= 500) { this.onFps((this.frames * 1000) / (now - this.lastFpsT)); this.frames = 0; this.lastFpsT = now; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  private drawOverlay() {
    const can = this.overlay; const r = this.renderer; if (!can || !r) return;
    const size = r.getOutputSize(); if (!size) return;
    if (can.width !== size.width || can.height !== size.height) { can.width = size.width; can.height = size.height; }
    const ctx = can.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, can.width, can.height);
    const H = this.H; const dot = this.dotGalvo;
    if (!H) return;
    if (this.overlayFigures.length > 0) {
      for (const fig of this.overlayFigures) {
        if (fig.pointsGalvo.length < 6) continue;
        const poly: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < fig.pointsGalvo.length; i += 2) {
          const p = applyHomography(H, fig.pointsGalvo[i], fig.pointsGalvo[i + 1]);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          poly.push(p);
        }
        if (poly.length < 3) continue;
        const isActive = this.isPlaying &&
          this.playbackTimeMs >= fig.startMs &&
          this.playbackTimeMs < fig.startMs + fig.durationMs;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        if (isActive) {
          ctx.fillStyle = "rgba(255,180,80,0.22)";
          ctx.strokeStyle = "rgba(255,180,80,0.95)";
          ctx.lineWidth = 2.5;
        } else {
          ctx.fillStyle = "rgba(80,160,255,0.10)";
          ctx.strokeStyle = "rgba(80,160,255,0.60)";
          ctx.lineWidth = 1.5;
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    if (dot) {
      const cam = applyHomography(H, dot.x, dot.y);
      if (Number.isFinite(cam.x) && Number.isFinite(cam.y)) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,80,80,0.95)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cam.x, cam.y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }
}

export default function Page() {
  // -------- Sequencer & fragments --------
  const [seq, setSeq] = useState<IndependentSequencer | null>(null);
  const [rateHz, setRateHz] = useState<number>(200); // default
  const [isPlaying, setIsPlaying] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [seqItems, setSeqItems] = useState<SeqItem[]>([]);
  const [saveName, setSaveName] = useState<string>("");

  // strategies
  const [strategy, setStrategy] = useState<ScanStrategy>(OutlineStrategy);

  // Serial
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [serialOk, setSerialOk] = useState(false);

  // Homography
  const [hItems, setHItems] = useState<HItem[]>([]);
  const [hSel, setHSel] = useState<string>("");
  const [HMat, setHMat] = useState<Float32Array | null>(null);

  // Figures to choose
  const [figItems, setFigItems] = useState<FigItem[]>([]);
  const [figSel, setFigSel] = useState<string>("");

  // Add panel – scan-figure fields
  const [addT, setAddT] = useState(0);
  const [addDur, setAddDur] = useState(5);
  const [addCycleSec, setAddCycleSec] = useState(1);
  const [addLaserPct, setAddLaserPct] = useState<number | "">("");

  // Add panel – set-laser fields
  // removed: set-laser fragment UI (integrated into scan)

  // Sequencer timeline canvas
  const tlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tlRaf = useRef<number>(0);
  const [nowSec, setNowSec] = useState(0);
  const playingSeqRef = useRef<IndependentSequencer | null>(null);

  

  // -------- Live preview --------
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctrlRef = useRef<AutoPreviewController | null>(null);
  const [fps, setFps] = useState(0);

  // camera
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const source = useVideoSource(deviceId);

  // -- init sequencer --
  useEffect(() => {
    const s = new IndependentSequencer(1000 / rateHz, 1.0, false);
    setSeq(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pitch update on slider change
  useEffect(() => {
    if (!seq) return;
    try { seq.setPitch(Math.max(1, Math.floor(1000 / Math.max(1, rateHz)))); } catch {}
  }, [rateHz, seq]);

  // timeline render loop（@kzkymur/sequencer の描画を使用）
  useEffect(() => {
    const can = tlCanvasRef.current; if (!can || !seq) return;
    const ctx = can.getContext("2d"); if (!ctx) return;
    let mounted = true;
    const loop = () => {
      if (!mounted) return;
      try {
        const rect = can.getBoundingClientRect();
        const cssW = Math.max(1, Math.floor(rect.width));
        const cssH = Math.max(1, Math.floor(rect.height));
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const bufferW = Math.max(1, Math.floor(cssW * dpr));
        const bufferH = Math.max(1, Math.floor(cssH * dpr));
        if (can.width !== bufferW || can.height !== bufferH) {
          can.width = bufferW;
          can.height = bufferH;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        seq.renderToCanvas(ctx, { width: cssW, height: cssH, activeColor: '#5b9afe', inactiveColor: '#9994', timeIndicatorColor: '#ff4757' });
        const currentMs = seq.getCurrentTime?.() || 0;
        setNowSec(currentMs / 1000);
        ctrlRef.current?.setPlaybackTimeMs(currentMs);
      } catch {}
      tlRaf.current = requestAnimationFrame(loop);
    };
    tlRaf.current = requestAnimationFrame(loop);
    return () => { mounted = false; cancelAnimationFrame(tlRaf.current); };
  }, [seq]);

  // -- device enumeration --
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const vids = await listMergedVideoInputs();
        if (!mounted) return;
        setDevices(vids.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId })));
        const first = camIds.find((id) => !!id) || "";
        setDeviceId((prev) => (prev ? prev : first));
      } catch {}
    })();
    return () => { mounted = false; };
  }, [camIds]);

  // -- preview controller --
  useEffect(() => {
    if (!canvasRef.current || !overlayCanvasRef.current) return;
    const ctrl = new AutoPreviewController(canvasRef.current, overlayCanvasRef.current, setFps);
    ctrlRef.current = ctrl;
    return () => { ctrl.dispose(); ctrlRef.current = null; };
  }, []);

  // connect source to renderer; ensure identity mapping if no undist
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!source) { await ctrlRef.current?.attachVideo(null); return; }
      const webgl = await source.toWebGL(); if (cancelled) return;
      await ctrlRef.current?.attachVideo(webgl?.element || null);
      // ensure identity once metadata is ready
      const v = webgl?.element;
      if (v) {
        const applyIdentity = () => { if (!cancelled) ctrlRef.current?.setIdentityByVideo(); };
        if (v.readyState >= 2) applyIdentity(); else v.addEventListener("loadedmetadata", applyIdentity, { once: true });
      }
      // auto-apply latest undist by camera label
      const vids = devices; const label = vids.find((d) => d.deviceId === deviceId)?.label || deviceId;
      const camName = sanitize(label);
      const files = await listFiles();
      const xy = files.filter((f) => f.type === "remapXY" && f.path.startsWith("2-calibrate-scenes/"));
      const matches: { runTs: string; path: string }[] = [];
      for (const f of xy) {
        const m = f.path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
        if (m && m[2] === camName) matches.push({ runTs: m[1], path: f.path });
      }
      matches.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      const best = matches[0];
      if (best) { const u = await loadRemapXY(best.path); if (u) ctrlRef.current?.setUndistMap(u); }
    })();
    return () => { cancelled = true; };
  }, [source, deviceId, devices]);

  // -- list H & figures & sequences --
  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const hs = files.filter((f) => f.type === "homography-json");
      const hout: HItem[] = hs.map((f) => ({
        ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path),
        path: f.path,
      }))
      // Sort: prefer galvo (4-galvo-calibration) first, then by timestamp desc
      .sort((a, b) => {
        const ag = a.path.startsWith('4-galvo-calibration/') ? 0 : 1;
        const bg = b.path.startsWith('4-galvo-calibration/') ? 0 : 1;
        if (ag !== bg) return ag - bg;
        return a.ts < b.ts ? 1 : -1;
      });
      setHItems(hout);
      setHSel((prev) => (prev && hout.some((x) => x.path === prev) ? prev : hout[0]?.path || ""));
      const figs = files.filter((f) => f.type === "figure");
      const fout: FigItem[] = figs.map((f) => ({ ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path), path: f.path }))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setFigItems(fout); if (!figSel && fout[0]) setFigSel(fout[0].path);
      const seqs = files.filter((f) => f.type === "sequence");
      const sout: SeqItem[] = seqs.map((f) => ({ ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path), path: f.path }))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setSeqItems(sout);
    })();
  }, []);

  // load selected homography
  useEffect(() => {
    (async () => {
      const path = hSel; if (!path) { setHMat(null); ctrlRef.current?.setHomography(null); return; }
      const fe = await getFile(path); if (!fe || !fe.data) { setHMat(null); ctrlRef.current?.setHomography(null); return; }
      try {
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(fe.data)));
        const arr: number[] | undefined = Array.isArray(json?.H) ? json.H : (Array.isArray(json?.homography3x3) ? json.homography3x3 : undefined);
        if (arr && arr.length === 9) { const h = new Float32Array(arr); setHMat(h); ctrlRef.current?.setHomography(h); }
        else { setHMat(null); ctrlRef.current?.setHomography(null); }
      } catch { setHMat(null); ctrlRef.current?.setHomography(null); }
    })();
  }, [hSel]);

  // ---- Build fragments from JSON into the sequencer (idempotent: rebuild seq instance) ----
  async function applySequenceToSequencer(seqJson: SequenceV1): Promise<IndependentSequencer | undefined> {
    if (!seqJson) return;
    // Recreate sequencer to drop previous fragments
    const pitch = seq?.getPitch?.() ?? Math.max(1, Math.floor(1000 / Math.max(1, rateHz)));
    const fresh = new IndependentSequencer(pitch, 1.0, false);
    const overlayFigures: OverlayFigure[] = [];
    for (const fr of seqJson.fragments) {
      if (fr.type === "scan-figure") {
        const ctxFig = await getFile(fr.figurePath);
        const arr = parseFigurePointsFromFile(ctxFig);
        const startMs = Math.max(0, Math.floor(fr.t * 1000));
        const durationMs = Math.max(0, Math.floor(fr.duration * 1000));
        if (arr.length >= 6) overlayFigures.push({ pointsGalvo: arr, startMs, durationMs });
        const cycleSec = Math.max(0.01, Number(fr.cycleSec ?? 1));
        const modeKey = fr.mode || strategy.key;
        const strat: ScanStrategy = ScanStrategies.find((s) => s.key === modeKey) || strategy;
        const laserPct = fr.laserPct;
        let didSetLaser = false;
        const frag = new IndependentFragment("scan-figure", durationMs, startMs, (tMs?: number) => {
          const localSec = Math.max(0, ((tMs || 0) - startMs) / 1000);
          const p = strat.positionAt({ pointsGalvo: arr }, localSec, cycleSec);
          if (!p) return;
          ctrlRef.current?.setDotGalvo(p);
          if (serialOk) {
            if (!didSetLaser && typeof laserPct === 'number') { try { serial?.setLaserOutput(laserPct); didSetLaser = true; } catch {} }
            try { serial?.setGalvoPos(p.x, p.y); } catch {}
          }
        });
        fresh.push(frag);
      }
    }
    ctrlRef.current?.setOverlayFigures(overlayFigures);
    return fresh;
  }

  // Build JSON from UI controls (append fragment)
  function currentSequence(): SequenceV1 {
    let json: SequenceV1 | null = null;
    try { const parsed = JSON.parse(jsonText) as SequenceV1; if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.fragments)) json = parsed; } catch {}
    if (!json) json = { schemaVersion: 1, fragments: [] };
    return json;
  }

  function setSequence(json: SequenceV1) {
    setJsonText(JSON.stringify(json, null, 2));
  }

  // Add fragments via UI
  async function addScanFigure() {
    if (!figSel) return;
    const json = currentSequence();
    json.fragments.push({ type: "scan-figure", t: Math.max(0, addT), duration: Math.max(0.1, addDur), figurePath: figSel, mode: strategy.key, cycleSec: Math.max(0.01, addCycleSec), rateHz: rateHz, laserPct: typeof addLaserPct === 'number' ? addLaserPct : undefined });
    setSequence(json);
    const fresh = await applySequenceToSequencer(json);
    if (fresh) setSeq(fresh);
  }

  // Save / Load
  async function saveSequence() {
    const name = saveName || `8-laser-automatic-operation/${formatTimestamp(new Date())}.seq`;
    let parsed: SequenceV1 | null = null;
    try { parsed = JSON.parse(jsonText); } catch {}
    if (!parsed) { alert('Invalid JSON'); return; }
    await putFile(jsonFile(name, parsed, "sequence"));
    const files = await listFiles();
    const seqs = files.filter((f) => f.type === "sequence");
    const sout: SeqItem[] = seqs.map((f) => ({ ts: (f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path), path: f.path }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    setSeqItems(sout);
  }

  async function loadSequence(path: string) {
    const fe = await getFile(path); if (!fe || !fe.data) return;
    try {
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(fe.data)));
      setSequence(json);
      const fresh = await applySequenceToSequencer(json);
      if (fresh) { setSeq(fresh); }
    } catch {}
  }

  async function deleteSequence(path: string) {
    await deleteFile(path); setSeqItems((prev) => prev.filter((x) => x.path !== path));
  }

  function finalizePlayback() {
    setIsPlaying(false);
    ctrlRef.current?.setPlaying(false);
    ctrlRef.current?.setDotGalvo(null);
    playingSeqRef.current = null;
    try { serial?.setLaserOutput(0); } catch {}
  }

  // Start/Stop
  async function handleStart() {
    if (!seq || isPlaying) return;
    // apply built JSON to sequencer
    let parsed: SequenceV1 | null = null; try { parsed = JSON.parse(jsonText); } catch {}
    if (!parsed || !Array.isArray(parsed.fragments)) { alert('Invalid sequence JSON'); return; }
    const fresh = await applySequenceToSequencer(parsed);
    if (!fresh) return; setSeq(fresh);
    try {
      playingSeqRef.current = fresh;
      const completion = fresh.play(0);
      setIsPlaying(true);
      ctrlRef.current?.setPlaying(true);
      completion
        .catch((e) => { console.warn(e); })
        .finally(() => { finalizePlayback(); });
    } catch (e) {
      console.warn(e);
      finalizePlayback();
    }
  }
  function handleStop() {
    const running = playingSeqRef.current ?? seq;
    if (!running) return;
    try { running.stop(0); } catch {}
    finalizePlayback();
  }

  // Init empty JSON
  useEffect(() => {
    setSequence({ schemaVersion: 1, fragments: [] });
    ctrlRef.current?.setOverlayFigures([]);
  }, []);

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>8. Laser Automatic Operation</b>
          <div className="row" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 6 }} title="Sequencer tick rate (Hz)">
              Rate (Hz)
              <input type="range" min={20} max={1000} step={10} value={rateHz} onChange={(e) => setRateHz(Number(e.target.value))} />
              <input type="number" min={1} max={2000} value={rateHz} onChange={(e) => setRateHz(Math.max(1, Math.min(2000, Number(e.target.value))))} style={{ width: 72 }} />
            </label>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Now: {nowSec.toFixed(2)}s</span>
            <button onClick={async () => { if (serialOk) return; const s = new SerialCommunicator(); const ok = await s.connect(); if (ok) { setSerial(s); setSerialOk(true); } else { try { await s.disconnect(); } catch {}; setSerial(null); setSerialOk(false); } }} disabled={serialOk}>{serialOk ? 'Connected' : 'Connect Microcontroller'}</button>
            {serialOk && (<button onClick={async () => { try { await serial?.disconnect(); } catch {}; setSerial(null); setSerialOk(false); }}>Disconnect</button>)}
            <button onClick={handleStart} disabled={!seq || isPlaying || !serialOk}>Start</button>
            <button onClick={handleStop} disabled={!seq || !isPlaying}>Stop</button>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          {/* 1) Add Fragment */}
          <section className="col panel" style={{ gap: 8 }}>
            <h4>Add Fragment – Figure Scan</h4>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <label className="row" style={{ gap: 6 }}>
                Figure
                <select value={figSel} onChange={(e) => setFigSel(e.target.value)}>
                  <option value="">(unselected)</option>
                  {figItems.map((f) => (<option key={f.path} value={f.path}>{f.path}</option>))}
                </select>
              </label>
              <label className="row" style={{ gap: 6 }}>Start (s)<input type="number" value={addT} min={0} onChange={(e) => setAddT(Math.max(0, Number(e.target.value))) } style={{ width: 100 }} /></label>
              <label className="row" style={{ gap: 6 }}>Duration (s)<input type="number" value={addDur} min={0.1} step={0.1} onChange={(e) => setAddDur(Math.max(0.1, Number(e.target.value))) } style={{ width: 110 }} /></label>
              <label className="row" style={{ gap: 6 }}>Cycle (s)<input type="number" value={addCycleSec} min={0.01} step={0.01} onChange={(e) => setAddCycleSec(Math.max(0.01, Number(e.target.value))) } style={{ width: 100 }} /></label>
              <label className="row" style={{ gap: 6 }}>mode
                <select value={strategy.key} onChange={(e) => { const s = ScanStrategies.find(x => x.key === e.target.value) || OutlineStrategy; setStrategy(s); }}>
                  {ScanStrategies.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
                </select>
              </label>
              <label className="row" style={{ gap: 6 }}>Laser (%)<input type="number" min={0} max={100} value={addLaserPct === '' ? '' : addLaserPct} onChange={(e) => { const v = e.target.value; setAddLaserPct(v === '' ? '' : Math.max(0, Math.min(100, Number(v)))); }} style={{ width: 90 }} /></label>
              <button onClick={addScanFigure} disabled={!figSel}>Add</button>
            </div>
          </section>

          {/* 2) Timeline */}
          <section className="col panel" style={{ gap: 8 }}>
            <h4>Timeline</h4>
            <canvas ref={tlCanvasRef} style={{ width: TIMELINE_CSS_WIDTH, height: TIMELINE_CSS_HEIGHT, maxWidth: "100%" }} />
          </section>

          {/* 3) Preview */}
          <section className="col panel" style={{ gap: 8 }}>
            <h4>Live Preview</h4>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <span style={{ opacity: 0.75 }}>FPS: {fps.toFixed(1)}</span>
              <label className="row" style={{ gap: 6 }}>Source Camera
                <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={devices.length === 0}>
                  <option value="">(unselected)</option>
                  {devices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>))}
                </select>
              </label>
              <label className="row" style={{ gap: 6 }}>Homography
                <select value={hSel} onChange={(e) => setHSel(e.target.value)}>
                  <option value="">(unselected)</option>
                  {hItems.map((h) => (<option key={h.path} value={h.path}>{h.ts}</option>))}
                </select>
              </label>
              <span style={{ fontSize: 12, opacity: 0.7 }}>H: {HMat ? 'loaded' : '-'}</span>
            </div>
            <div className="canvasWrap">
              <canvas ref={canvasRef} />
              <canvas ref={overlayCanvasRef} className="canvasOverlay" />
            </div>
          </section>

          {/* 4) Sequencer Save / Load */}
          <section className="col panel" style={{ gap: 8 }}>
            <h4>Sequence – Save / Load</h4>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <label className="row" style={{ gap: 6 }}>file name<input type="text" placeholder="8-laser-automatic-operation/....seq" value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ width: 380 }} /></label>
              <button onClick={saveSequence}>Save</button>
            </div>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={10} style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }} />
            <div className="col" style={{ gap: 4 }}>
              <h5>Saved Sequences</h5>
              <div className="tree" style={{ maxHeight: 200, overflow: 'auto' }}>
                {seqItems.map((s) => (
                  <div key={s.path} className="file" title={s.path}>
                    <span style={{ width: 220, fontFamily: 'monospace' }}>{s.ts}</span>
                    <span style={{ flex: 1 }}>{s.path}</span>
                    <button onClick={() => loadSequence(s.path)}>Load</button>
                    <button onClick={() => deleteSequence(s.path)}>Delete</button>
                  </div>
                ))}
                {seqItems.length === 0 && <div style={{ opacity: 0.7 }}>No sequences saved yet.</div>}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
