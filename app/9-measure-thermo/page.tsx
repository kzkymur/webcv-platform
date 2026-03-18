"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles, getFile, putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { formatTimestamp } from "@/shared/util/time";
import { IndependentSequencer, IndependentFragment } from "@kzkymur/sequencer";
import { ScanStrategies, OutlineStrategy, type ScanStrategy } from "@/shared/scan/strategies";
import { createLoopAwareLaserSetter } from "@/shared/scan/laserLoop";
import { SerialCommunicator } from "@/shared/module/serialInterface";
import { RemapRenderer } from "@/shared/gl/remap";
import { listMergedVideoInputs } from "@/shared/util/devices";
import { useCameraIds } from "@/shared/hooks/useCameraStreams";
import { useVideoSource } from "@/shared/hooks/useVideoSource";
import { sanitize } from "@/shared/util/strings";
import { buildIdentityInterMap, loadRemapXY } from "@/shared/util/remap";
import { applyHomography, invertHomography } from "@/shared/util/homography";
import type { VideoStreamSource } from "@/shared/stream/types";
import { WebSocketY16Source } from "@/shared/stream/wsY16";

type DeviceItem = { deviceId: string; label: string };
type HItem = { ts: string; path: string };
type SeqItem = { ts: string; path: string };
type Point = { x: number; y: number };
type OverlayFigure = { pointsGalvo: number[]; startMs: number; durationMs: number };
type TempSample = { elapsedMs: number; pointTempC: number | null; maxTempC: number };

type SequenceV1 = {
  schemaVersion: 1;
  notes?: string;
  fragments: ({
    type: "scan-figure";
    t: number;
    duration: number;
    figurePath: string;
    mode?: string;
    cycleSec?: number;
    rateHz?: number;
    laserPct?: number;
  })[];
};

const TIMELINE_CSS_WIDTH = 720;
const TIMELINE_CSS_HEIGHT = 50;
const GRAPH_CSS_WIDTH = 720;
const GRAPH_CSS_HEIGHT = 180;
const SAMPLE_INTERVAL_MS = 33;

function isWsDeviceId(id: string | undefined | null): id is string {
  return !!id && (id.startsWith("ws://") || id.startsWith("wss://"));
}

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

function multiply3x3(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3 + 0] * b[0 * 3 + c] +
        a[r * 3 + 1] * b[1 * 3 + c] +
        a[r * 3 + 2] * b[2 * 3 + c];
    }
  }
  return out;
}

function parseHomographyFromFile(file: FileEntry | null | undefined): Float32Array | null {
  if (!file?.data) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(file.data)));
    const arr: number[] | undefined = Array.isArray(json?.H)
      ? json.H
      : Array.isArray(json?.homography3x3)
        ? json.homography3x3
        : undefined;
    if (!arr || arr.length !== 9) return null;
    return new Float32Array(arr);
  } catch {
    return null;
  }
}

function parsePairFromPath(path: string): { from: string; to: string } | null {
  const m = path.match(/cam-(.+?)_to_cam-(.+?)_H_undist\.json$/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

function getCanvasPoint(e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) * canvas.width) / Math.max(1, rect.width);
  const y = ((e.clientY - rect.top) * canvas.height) / Math.max(1, rect.height);
  return { x, y };
}

function toTempC(raw: number, scale: number): number {
  const s = scale > 0 ? scale : 1;
  return raw / s - 273.15;
}

class OverlayPreviewController {
  private renderer: RemapRenderer | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private raf = 0;
  private videoEl: HTMLVideoElement | null = null;
  private lastFpsT = performance.now();
  private frames = 0;
  private onFps: (v: number) => void;

  private H: Float32Array | null = null; // galvo -> this preview's camera space
  private dotGalvo: Point | null = null;
  private observationPoint: Point | null = null;
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
    try {
      this.renderer?.dispose();
    } catch {}
    this.renderer = null;
    this.overlay = null;
    this.videoEl = null;
  }

  async attachVideo(element: HTMLVideoElement | null) {
    this.videoEl = element;
    this.renderer?.setSourceVideo(element);
  }

  setUndistMap(u: { xy: Float32Array; width: number; height: number } | null) {
    if (!this.renderer || !u) return;
    this.renderer.setUndistMapXY(u.xy, { width: u.width, height: u.height });
    const id = buildIdentityInterMap(u.width, u.height);
    this.renderer.setInterMapXY(id, { width: u.width, height: u.height });
  }

  setIdentityByVideo() {
    if (!this.renderer || !this.videoEl) return;
    const w = this.videoEl.videoWidth || 0;
    const h = this.videoEl.videoHeight || 0;
    if (!w || !h) return;
    const id = buildIdentityInterMap(w, h);
    this.renderer.setUndistMapXY(id, { width: w, height: h });
    this.renderer.setInterMapXY(id, { width: w, height: h });
  }

  setHomography(H: Float32Array | null) {
    this.H = H;
  }

  setDotGalvo(p: Point | null) {
    this.dotGalvo = p;
  }

  setObservationPoint(p: Point | null) {
    this.observationPoint = p;
  }

  setOverlayFigures(figures: OverlayFigure[]) {
    this.overlayFigures = figures;
  }

  setPlaybackTimeMs(timeMs: number) {
    this.playbackTimeMs = Math.max(0, timeMs);
  }

  setPlaying(v: boolean) {
    this.isPlaying = v;
  }

  private start() {
    const loop = () => {
      try {
        this.renderer?.render();
      } catch {}
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
    const can = this.overlay;
    const r = this.renderer;
    if (!can || !r) return;
    const size = r.getOutputSize();
    if (!size) return;
    if (can.width !== size.width || can.height !== size.height) {
      can.width = size.width;
      can.height = size.height;
    }
    const ctx = can.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, can.width, can.height);

    const H = this.H;
    if (H) {
      for (const fig of this.overlayFigures) {
        if (fig.pointsGalvo.length < 6) continue;
        const poly: Point[] = [];
        for (let i = 0; i + 1 < fig.pointsGalvo.length; i += 2) {
          const p = applyHomography(H, fig.pointsGalvo[i], fig.pointsGalvo[i + 1]);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          poly.push(p);
        }
        if (poly.length < 3) continue;
        const isActive =
          this.isPlaying &&
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

      if (this.dotGalvo) {
        const cam = applyHomography(H, this.dotGalvo.x, this.dotGalvo.y);
        if (Number.isFinite(cam.x) && Number.isFinite(cam.y)) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,80,80,0.95)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cam.x, cam.y, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    if (this.observationPoint) {
      const p = this.observationPoint;
      ctx.save();
      ctx.strokeStyle = "rgba(40,255,220,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 10, p.y);
      ctx.lineTo(p.x + 10, p.y);
      ctx.moveTo(p.x, p.y - 10);
      ctx.lineTo(p.x, p.y + 10);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawTemperatureGraph(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  samples: TempSample[],
  xMaxMs: number,
  currentMs: number,
) {
  ctx.clearRect(0, 0, width, height);

  const left = 48;
  const right = 12;
  const top = 10;
  const bottom = 24;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (Number.isFinite(s.maxTempC)) {
      minY = Math.min(minY, s.maxTempC);
      maxY = Math.max(maxY, s.maxTempC);
    }
    if (s.pointTempC !== null && Number.isFinite(s.pointTempC)) {
      minY = Math.min(minY, s.pointTempC);
      maxY = Math.max(maxY, s.pointTempC);
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = 0;
    maxY = 1;
  }
  if (maxY - minY < 0.5) {
    const c = (maxY + minY) * 0.5;
    minY = c - 0.25;
    maxY = c + 0.25;
  }

  const toX = (ms: number) => left + (Math.max(0, Math.min(xMaxMs, ms)) / Math.max(1, xMaxMs)) * plotW;
  const toY = (tempC: number) => top + ((maxY - tempC) / Math.max(1e-6, maxY - minY)) * plotH;

  ctx.save();
  ctx.strokeStyle = "rgba(180,180,180,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, plotW, plotH);

  ctx.fillStyle = "rgba(180,180,180,0.85)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`${maxY.toFixed(2)}C`, left - 6, top + 2);
  ctx.fillText(`${minY.toFixed(2)}C`, left - 6, top + plotH - 2);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("0.0s", left, top + plotH + 6);
  ctx.fillText(`${(xMaxMs / 1000).toFixed(2)}s`, left + plotW, top + plotH + 6);

  ctx.lineWidth = 1.75;

  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,90,90,0.95)";
  let hasMax = false;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const x = toX(s.elapsedMs);
    const y = toY(s.maxTempC);
    if (!hasMax) {
      ctx.moveTo(x, y);
      hasMax = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (hasMax) ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "rgba(70,220,255,0.95)";
  let hasPoint = false;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.pointTempC === null || !Number.isFinite(s.pointTempC)) {
      hasPoint = false;
      continue;
    }
    const x = toX(s.elapsedMs);
    const y = toY(s.pointTempC);
    if (!hasPoint) {
      ctx.moveTo(x, y);
      hasPoint = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  const cx = toX(currentMs);
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.setLineDash([4, 4]);
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top + plotH);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,90,90,0.95)";
  ctx.fillText("max temp", left + 6, top + 4);
  ctx.fillStyle = "rgba(70,220,255,0.95)";
  ctx.fillText("point temp", left + 6, top + 20);

  ctx.restore();
}

export default function Page() {
  const [seq, setSeq] = useState<IndependentSequencer | null>(null);
  const [rateHz, setRateHz] = useState<number>(200);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [nowSec, setNowSec] = useState(0);

  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [serialOk, setSerialOk] = useState(false);
  const serialRef = useRef<SerialCommunicator | null>(null);
  const serialOkRef = useRef(false);

  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [camIds] = useCameraIds();
  const [webCamId, setWebCamId] = useState("");
  const [thermalCamId, setThermalCamId] = useState("");

  const webSource = useVideoSource(webCamId);
  const thermalSource = useVideoSource(thermalCamId);
  const thermalSourceRef = useRef<VideoStreamSource | null>(null);

  const [hGalvoItems, setHGalvoItems] = useState<HItem[]>([]);
  const [hWtItems, setHWtItems] = useState<HItem[]>([]);
  const [seqItems, setSeqItems] = useState<SeqItem[]>([]);

  const [hGalvoSel, setHGalvoSel] = useState("");
  const [hWtSel, setHWtSel] = useState("");
  const [seqSel, setSeqSel] = useState("");

  const [hGalvo, setHGalvo] = useState<Float32Array | null>(null);
  const [hWebToThermal, setHWebToThermal] = useState<Float32Array | null>(null);

  const hGalvoToThermal = useMemo(() => {
    if (!hGalvo || !hWebToThermal) return null;
    return multiply3x3(hWebToThermal, hGalvo);
  }, [hGalvo, hWebToThermal]);

  const hThermalToWeb = useMemo(() => {
    if (!hWebToThermal) return null;
    try {
      return invertHomography(hWebToThermal);
    } catch {
      return null;
    }
  }, [hWebToThermal]);

  const [sequenceJson, setSequenceJson] = useState<SequenceV1 | null>(null);
  const [sequenceDurationMs, setSequenceDurationMs] = useState(0);
  const sequenceDurationMsRef = useRef(0);

  const [obsWeb, setObsWeb] = useState<Point | null>(null);
  const [obsThermal, setObsThermal] = useState<Point | null>(null);
  const obsThermalRef = useRef<Point | null>(null);

  const [fpsWeb, setFpsWeb] = useState(0);
  const [fpsThermal, setFpsThermal] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  const [lastSavedCsvPath, setLastSavedCsvPath] = useState("");

  const tlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const webCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const webOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const thermalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const thermalOverlayRef = useRef<HTMLCanvasElement | null>(null);

  const webCtrlRef = useRef<OverlayPreviewController | null>(null);
  const thermalCtrlRef = useRef<OverlayPreviewController | null>(null);

  const playingSeqRef = useRef<IndependentSequencer | null>(null);
  const finalizeGuardRef = useRef(false);

  const samplesRef = useRef<TempSample[]>([]);
  const sampleTickRef = useRef(0);
  const sampleTimerRef = useRef<number | null>(null);
  const runStartPerfRef = useRef(0);
  const runTsRef = useRef("");

  useEffect(() => {
    serialRef.current = serial;
    serialOkRef.current = serialOk;
  }, [serial, serialOk]);

  useEffect(() => {
    thermalSourceRef.current = thermalSource;
  }, [thermalSource]);

  useEffect(() => {
    obsThermalRef.current = obsThermal;
  }, [obsThermal]);

  const webDevices = useMemo(() => devices.filter((d) => !isWsDeviceId(d.deviceId)), [devices]);
  const thermalDevices = useMemo(() => devices.filter((d) => isWsDeviceId(d.deviceId)), [devices]);

  async function refreshSelectableFiles() {
    const files = await listFiles();

    const homos = files.filter((f) => f.type === "homography-json");

    const galvo = homos
      .filter((f) => f.path.startsWith("4-galvo-calibration/"))
      .map((f) => ({
        ts: f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path,
        path: f.path,
      }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));

    const wt = homos
      .filter((f) => /_H_undist\.json$/i.test(f.path))
      .map((f) => ({
        ts: f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path,
        path: f.path,
      }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));

    const seqs = files
      .filter((f) => f.type === "sequence")
      .map((f) => ({
        ts: f.path.match(/(\d{4}-\d{2}-\d{2}_[0-9-]{8,})/)?.[1] || f.path,
        path: f.path,
      }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));

    setHGalvoItems(galvo);
    setHWtItems(wt);
    setSeqItems(seqs);

    setHGalvoSel((prev) => (prev && galvo.some((x) => x.path === prev) ? prev : galvo[0]?.path || ""));
    setHWtSel((prev) => (prev && wt.some((x) => x.path === prev) ? prev : wt[0]?.path || ""));
    setSeqSel((prev) => (prev && seqs.some((x) => x.path === prev) ? prev : seqs[0]?.path || ""));
  }

  async function refreshDevices() {
    try {
      const vids = await listMergedVideoInputs();
      const mapped = vids.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId }));
      setDevices(mapped);

      setWebCamId((prev) => {
        if (prev && mapped.some((d) => d.deviceId === prev && !isWsDeviceId(d.deviceId))) return prev;
        const fromPrefs = camIds.find((id) => !!id && !isWsDeviceId(id));
        if (fromPrefs && mapped.some((d) => d.deviceId === fromPrefs)) return fromPrefs;
        return mapped.find((d) => !isWsDeviceId(d.deviceId))?.deviceId || "";
      });

      setThermalCamId((prev) => {
        if (prev && mapped.some((d) => d.deviceId === prev && isWsDeviceId(d.deviceId))) return prev;
        const fromPrefs = camIds.find((id) => !!id && isWsDeviceId(id));
        if (fromPrefs && mapped.some((d) => d.deviceId === fromPrefs)) return fromPrefs;
        return mapped.find((d) => isWsDeviceId(d.deviceId))?.deviceId || "";
      });
    } catch {}
  }

  function getDeviceLabel(deviceId: string): string {
    return devices.find((d) => d.deviceId === deviceId)?.label || deviceId;
  }

  useEffect(() => {
    void refreshDevices();
  }, [camIds]);

  useEffect(() => {
    void refreshSelectableFiles();
  }, []);

  useEffect(() => {
    if (!webCanvasRef.current || !webOverlayRef.current) return;
    const ctrl = new OverlayPreviewController(webCanvasRef.current, webOverlayRef.current, setFpsWeb);
    webCtrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      webCtrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!thermalCanvasRef.current || !thermalOverlayRef.current) return;
    const ctrl = new OverlayPreviewController(thermalCanvasRef.current, thermalOverlayRef.current, setFpsThermal);
    thermalCtrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      thermalCtrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    webCtrlRef.current?.setHomography(hGalvo);
  }, [hGalvo]);

  useEffect(() => {
    thermalCtrlRef.current?.setHomography(hGalvoToThermal);
  }, [hGalvoToThermal]);

  useEffect(() => {
    webCtrlRef.current?.setObservationPoint(obsWeb);
    thermalCtrlRef.current?.setObservationPoint(obsThermal);
  }, [obsWeb, obsThermal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!webSource) {
        await webCtrlRef.current?.attachVideo(null);
        return;
      }
      const webgl = await webSource.toWebGL();
      if (cancelled) return;
      await webCtrlRef.current?.attachVideo(webgl?.element || null);

      const v = webgl?.element;
      if (v) {
        const applyIdentity = () => {
          if (!cancelled) webCtrlRef.current?.setIdentityByVideo();
        };
        if (v.readyState >= 2) applyIdentity();
        else v.addEventListener("loadedmetadata", applyIdentity, { once: true });
      }

      const label = getDeviceLabel(webCamId);
      const camName = sanitize(label);
      const files = await listFiles();
      const xy = files.filter((f) => f.type === "remapXY" && f.path.startsWith("2-calibrate-scenes/"));
      const matches: { runTs: string; path: string }[] = [];
      for (let i = 0; i < xy.length; i++) {
        const m = xy[i].path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
        if (m && m[2] === camName) matches.push({ runTs: m[1], path: xy[i].path });
      }
      matches.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      const best = matches[0];
      if (best) {
        const u = await loadRemapXY(best.path);
        if (u) webCtrlRef.current?.setUndistMap(u);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webSource, webCamId, devices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!thermalSource) {
        await thermalCtrlRef.current?.attachVideo(null);
        return;
      }
      const webgl = await thermalSource.toWebGL();
      if (cancelled) return;
      await thermalCtrlRef.current?.attachVideo(webgl?.element || null);
      const v = webgl?.element;
      if (v) {
        const applyIdentity = () => {
          if (!cancelled) thermalCtrlRef.current?.setIdentityByVideo();
        };
        if (v.readyState >= 2) applyIdentity();
        else v.addEventListener("loadedmetadata", applyIdentity, { once: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thermalSource]);

  useEffect(() => {
    setObsWeb(null);
    setObsThermal(null);
  }, [webCamId, thermalCamId, hWtSel]);

  useEffect(() => {
    (async () => {
      if (!hGalvoSel) {
        setHGalvo(null);
        return;
      }
      const fe = await getFile(hGalvoSel);
      setHGalvo(parseHomographyFromFile(fe));
    })();
  }, [hGalvoSel]);

  useEffect(() => {
    (async () => {
      if (!hWtSel) {
        setHWebToThermal(null);
        return;
      }
      const fe = await getFile(hWtSel);
      const base = parseHomographyFromFile(fe);
      if (!base) {
        setHWebToThermal(null);
        return;
      }

      const webName = sanitize(getDeviceLabel(webCamId));
      const thermalName = sanitize(getDeviceLabel(thermalCamId));

      let oriented = base;
      const pathPair = parsePairFromPath(hWtSel);
      if (pathPair) {
        if (pathPair.from === webName && pathPair.to === thermalName) {
          oriented = base;
        } else if (pathPair.from === thermalName && pathPair.to === webName) {
          oriented = invertHomography(base);
        }
      }
      setHWebToThermal(oriented);
    })();
  }, [hWtSel, webCamId, thermalCamId, devices]);

  async function rebuildSequencerFromJson(json: SequenceV1): Promise<IndependentSequencer | null> {
    if (!json || !Array.isArray(json.fragments)) return null;

    const pitch = Math.max(1, Math.floor(1000 / Math.max(1, rateHz)));
    const fresh = new IndependentSequencer(pitch, 1.0, false);

    const fragments = await Promise.all(
      json.fragments.map(async (fr) => {
        if (fr.type !== "scan-figure") return null;
        const fig = await getFile(fr.figurePath);
        const pts = parseFigurePointsFromFile(fig);
        return { fr, points: pts };
      }),
    );

    const overlayFigures: OverlayFigure[] = [];
    let endMs = 0;

    for (let i = 0; i < fragments.length; i++) {
      const item = fragments[i];
      if (!item) continue;
      const fr = item.fr;
      const arr = item.points;
      const startMs = Math.max(0, Math.floor(fr.t * 1000));
      const durationMs = Math.max(0, Math.floor(fr.duration * 1000));
      if (arr.length >= 6) {
        overlayFigures.push({ pointsGalvo: arr, startMs, durationMs });
      }
      endMs = Math.max(endMs, startMs + durationMs);

      const cycleSec = Math.max(0.01, Number(fr.cycleSec ?? 1));
      const modeKey = fr.mode || OutlineStrategy.key;
      const strat: ScanStrategy = ScanStrategies.find((s) => s.key === modeKey) || OutlineStrategy;
      const laserPct = fr.laserPct;
      const setLaserForCurrentPass = createLoopAwareLaserSetter(laserPct, (pct) => {
        const serialNow = serialRef.current;
        if (!serialNow) throw new Error("Serial is not connected");
        serialNow.setLaserOutput(pct);
      });

      const frag = new IndependentFragment("scan-figure", durationMs, startMs, (tMs?: number) => {
        const currentMs = Math.max(0, tMs ?? 0);
        const localSec = Math.max(0, (currentMs - startMs) / 1000);
        const p = strat.positionAt({ pointsGalvo: arr }, localSec, cycleSec);
        if (!p) return;

        webCtrlRef.current?.setDotGalvo(p);
        thermalCtrlRef.current?.setDotGalvo(p);

        const serialNow = serialRef.current;
        if (!serialNow || !serialOkRef.current) return;

        setLaserForCurrentPass(currentMs);

        try {
          serialNow.setGalvoPosLatest(p.x, p.y);
        } catch {}
      });

      fresh.push(frag);
    }

    sequenceDurationMsRef.current = endMs;
    setSequenceDurationMs(endMs);

    webCtrlRef.current?.setOverlayFigures(overlayFigures);
    thermalCtrlRef.current?.setOverlayFigures(overlayFigures);
    webCtrlRef.current?.setDotGalvo(null);
    thermalCtrlRef.current?.setDotGalvo(null);

    return fresh;
  }

  useEffect(() => {
    (async () => {
      if (!seqSel) {
        setSequenceJson(null);
        setSeq(null);
        sequenceDurationMsRef.current = 0;
        setSequenceDurationMs(0);
        webCtrlRef.current?.setOverlayFigures([]);
        thermalCtrlRef.current?.setOverlayFigures([]);
        return;
      }
      const fe = await getFile(seqSel);
      if (!fe?.data) {
        setSequenceJson(null);
        setSeq(null);
        return;
      }
      try {
        const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(fe.data))) as SequenceV1;
        if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.fragments)) {
          setSequenceJson(null);
          setSeq(null);
          return;
        }
        setSequenceJson(parsed);
        const fresh = await rebuildSequencerFromJson(parsed);
        setSeq(fresh);
      } catch {
        setSequenceJson(null);
        setSeq(null);
      }
    })();
  }, [seqSel]);

  useEffect(() => {
    if (!seq) return;
    try {
      seq.setPitch(Math.max(1, Math.floor(1000 / Math.max(1, rateHz))));
    } catch {}
  }, [rateHz, seq]);

  useEffect(() => {
    const can = tlCanvasRef.current;
    if (!can || !seq) return;
    const ctx = can.getContext("2d");
    if (!ctx) return;

    let mounted = true;
    let raf = 0;

    const loop = () => {
      if (!mounted) return;
      try {
        const rect = can.getBoundingClientRect();
        const cssW = Math.max(1, Math.floor(rect.width));
        const cssH = Math.max(1, Math.floor(rect.height));
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const bw = Math.max(1, Math.floor(cssW * dpr));
        const bh = Math.max(1, Math.floor(cssH * dpr));
        if (can.width !== bw || can.height !== bh) {
          can.width = bw;
          can.height = bh;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        seq.renderToCanvas(ctx, {
          width: cssW,
          height: cssH,
          activeColor: "#5b9afe",
          inactiveColor: "#9994",
          timeIndicatorColor: "#ff4757",
        });

        const currentMs = seq.getCurrentTime?.() || 0;
        setNowSec(currentMs / 1000);
        webCtrlRef.current?.setPlaybackTimeMs(currentMs);
        thermalCtrlRef.current?.setPlaybackTimeMs(currentMs);
      } catch {}

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [seq]);

  useEffect(() => {
    const can = graphCanvasRef.current;
    if (!can) return;
    const ctx = can.getContext("2d");
    if (!ctx) return;

    let mounted = true;
    let raf = 0;

    const loop = () => {
      if (!mounted) return;

      const rect = can.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const bw = Math.max(1, Math.floor(cssW * dpr));
      const bh = Math.max(1, Math.floor(cssH * dpr));
      if (can.width !== bw || can.height !== bh) {
        can.width = bw;
        can.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const samples = samplesRef.current;
      const lastElapsed = samples.length > 0 ? samples[samples.length - 1].elapsedMs : 0;
      const xMaxMs = Math.max(sequenceDurationMsRef.current, lastElapsed, 1000);
      const currentMs = isPlaying ? Math.max(0, performance.now() - runStartPerfRef.current) : lastElapsed;
      drawTemperatureGraph(ctx, cssW, cssH, samples, xMaxMs, currentMs);

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [isPlaying]);

  function clearSamplingTimer() {
    if (sampleTimerRef.current !== null) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
  }

  function startSampling() {
    clearSamplingTimer();
    sampleTimerRef.current = window.setInterval(() => {
      const src = thermalSourceRef.current;
      if (!(src instanceof WebSocketY16Source)) return;
      const frame = src.getLatestFrame();
      if (!frame) return;

      const u16 = frame.u16;
      if (u16.length === 0) return;

      let maxRaw = 0;
      for (let i = 0; i < u16.length; i++) {
        if (u16[i] > maxRaw) maxRaw = u16[i];
      }

      let pointTempC: number | null = null;
      const pt = obsThermalRef.current;
      if (pt) {
        const ix = Math.round(pt.x);
        const iy = Math.round(pt.y);
        if (ix >= 0 && iy >= 0 && ix < frame.w && iy < frame.h) {
          const idx = iy * frame.w + ix;
          pointTempC = toTempC(u16[idx], frame.scale);
        }
      }

      const maxTempC = toTempC(maxRaw, frame.scale);
      const elapsedMs = Math.max(0, performance.now() - runStartPerfRef.current);

      samplesRef.current.push({ elapsedMs, pointTempC, maxTempC });
      sampleTickRef.current += 1;
      if (sampleTickRef.current % 5 === 0) setSampleCount(samplesRef.current.length);
    }, SAMPLE_INTERVAL_MS);
  }

  async function turnOffLaserAtSequenceEnd(): Promise<void> {
    const serialNow = serialRef.current;
    if (!serialNow) return;
    try {
      await serialNow.emergencyLaserOff();
    } catch {}
  }

  async function saveTemperatureCsv() {
    const ts = runTsRef.current || formatTimestamp(new Date());
    const path = `9-measure-thermo/${ts}.csv`;
    const header = "elapsedMs,elapsedSec,pointTempC,maxTempC";
    const rows = samplesRef.current.map((s) => {
      const sec = (s.elapsedMs / 1000).toFixed(6);
      const point = s.pointTempC === null ? "" : s.pointTempC.toFixed(6);
      const max = s.maxTempC.toFixed(6);
      return `${Math.round(s.elapsedMs)},${sec},${point},${max}`;
    });
    const text = [header, ...rows].join("\n") + "\n";
    const bytes = new TextEncoder().encode(text);
    await putFile({ path, type: "other", data: bytes.buffer });
    setLastSavedCsvPath(path);
  }

  async function finalizePlayback() {
    if (finalizeGuardRef.current) return;
    finalizeGuardRef.current = true;

    clearSamplingTimer();
    setIsPlaying(false);

    webCtrlRef.current?.setPlaying(false);
    thermalCtrlRef.current?.setPlaying(false);
    webCtrlRef.current?.setDotGalvo(null);
    thermalCtrlRef.current?.setDotGalvo(null);

    playingSeqRef.current = null;

    await turnOffLaserAtSequenceEnd();

    setSampleCount(samplesRef.current.length);

    try {
      await saveTemperatureCsv();
      await refreshSelectableFiles();
    } catch (e) {
      console.warn(e);
    }
  }

  async function handleStart() {
    if (!seq || isPlaying) return;
    if (!sequenceJson) return;
    if (!serialOk) return;
    if (!obsWeb || !obsThermal) return;

    const fresh = await rebuildSequencerFromJson(sequenceJson);
    if (!fresh) return;

    setSeq(fresh);
    try {
      fresh.setLoopFlag(loopEnabled);
    } catch {}

    samplesRef.current = [];
    sampleTickRef.current = 0;
    setSampleCount(0);
    runStartPerfRef.current = performance.now();
    runTsRef.current = formatTimestamp(new Date());
    finalizeGuardRef.current = false;
    serialRef.current?.enableRealtimeGalvo();

    webCtrlRef.current?.setPlaying(true);
    thermalCtrlRef.current?.setPlaying(true);

    startSampling();

    try {
      playingSeqRef.current = fresh;
      const completion = fresh.play(0);
      setIsPlaying(true);
      completion
        .catch((e) => {
          console.warn(e);
        })
        .finally(() => {
          void finalizePlayback();
        });
    } catch (e) {
      console.warn(e);
      void finalizePlayback();
    }
  }

  function handleStop() {
    const running = playingSeqRef.current ?? seq;
    if (!running) return;
    try {
      running.stop(0);
    } catch {}
    void finalizePlayback();
  }

  function handleWebPreviewClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!hWebToThermal || !webCanvasRef.current) return;
    const pWeb = getCanvasPoint(e, webCanvasRef.current);
    const pThermal = applyHomography(hWebToThermal, pWeb.x, pWeb.y);
    if (!Number.isFinite(pWeb.x) || !Number.isFinite(pWeb.y)) return;
    if (!Number.isFinite(pThermal.x) || !Number.isFinite(pThermal.y)) return;
    setObsWeb(pWeb);
    setObsThermal(pThermal);
  }

  function handleThermalPreviewClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!hThermalToWeb || !thermalCanvasRef.current) return;
    const pThermal = getCanvasPoint(e, thermalCanvasRef.current);
    const pWeb = applyHomography(hThermalToWeb, pThermal.x, pThermal.y);
    if (!Number.isFinite(pWeb.x) || !Number.isFinite(pWeb.y)) return;
    if (!Number.isFinite(pThermal.x) || !Number.isFinite(pThermal.y)) return;
    setObsWeb(pWeb);
    setObsThermal(pThermal);
  }

  useEffect(() => {
    return () => {
      clearSamplingTimer();
      try {
        playingSeqRef.current?.stop(0);
      } catch {}
      const serialNow = serialRef.current;
      if (!serialNow) return;
      void serialNow.emergencyLaserOff().catch(() => {});
    };
  }, []);

  const canStart =
    !!seq &&
    !isPlaying &&
    serialOk &&
    !!webCamId &&
    !!thermalCamId &&
    !!hGalvo &&
    !!hWebToThermal &&
    !!sequenceJson &&
    !!obsWeb &&
    !!obsThermal;

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>9. Laser Thermo Measurement</b>
          <div className="row" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 6 }} title="Sequencer tick rate (Hz)">
              Rate (Hz)
              <input
                type="range"
                min={20}
                max={1000}
                step={10}
                value={rateHz}
                onChange={(e) => setRateHz(Number(e.target.value))}
                disabled={isPlaying}
              />
              <input
                type="number"
                min={1}
                max={2000}
                value={rateHz}
                onChange={(e) => setRateHz(Math.max(1, Math.min(2000, Number(e.target.value))))}
                style={{ width: 72 }}
                disabled={isPlaying}
              />
            </label>
            <label className="row" style={{ gap: 6, userSelect: "none" }}>
              <input
                type="checkbox"
                checked={loopEnabled}
                onChange={(e) => setLoopEnabled(e.target.checked)}
                disabled={isPlaying}
              />
              loop
            </label>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Now: {nowSec.toFixed(2)}s</span>
            <button
              onClick={async () => {
                if (serialOk) return;
                const s = new SerialCommunicator();
                const ok = await s.connect();
                if (ok) {
                  setSerial(s);
                  setSerialOk(true);
                } else {
                  try {
                    await s.disconnect();
                  } catch {}
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
                  try {
                    await serial?.disconnect();
                  } catch {}
                  setSerial(null);
                  setSerialOk(false);
                }}
                disabled={isPlaying}
              >
                Disconnect
              </button>
            )}
            <button onClick={handleStart} disabled={!canStart}>
              Start
            </button>
            <button onClick={handleStop} disabled={!isPlaying}>
              Stop
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col panel" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h4 style={{ margin: 0 }}>Selections</h4>
              <button onClick={() => { void refreshDevices(); void refreshSelectableFiles(); }} disabled={isPlaying}>
                Refresh Lists
              </button>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <label className="row" style={{ gap: 6 }}>
                Web Camera
                <select
                  value={webCamId}
                  onChange={(e) => setWebCamId(e.target.value)}
                  disabled={isPlaying || webDevices.length === 0}
                >
                  <option value="">(unselected)</option>
                  {webDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || d.deviceId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                Thermal Camera
                <select
                  value={thermalCamId}
                  onChange={(e) => setThermalCamId(e.target.value)}
                  disabled={isPlaying || thermalDevices.length === 0}
                >
                  <option value="">(unselected)</option>
                  {thermalDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || d.deviceId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                Galvo Homography
                <select value={hGalvoSel} onChange={(e) => setHGalvoSel(e.target.value)} disabled={isPlaying}>
                  <option value="">(unselected)</option>
                  {hGalvoItems.map((h) => (
                    <option key={h.path} value={h.path}>
                      {h.path}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                Web-Thermal Homography
                <select value={hWtSel} onChange={(e) => setHWtSel(e.target.value)} disabled={isPlaying}>
                  <option value="">(unselected)</option>
                  {hWtItems.map((h) => (
                    <option key={h.path} value={h.path}>
                      {h.path}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: 6 }}>
                Sequence File
                <select value={seqSel} onChange={(e) => setSeqSel(e.target.value)} disabled={isPlaying}>
                  <option value="">(unselected)</option>
                  {seqItems.map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.path}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row" style={{ gap: 12, fontSize: 12, opacity: 0.8 }}>
              <span>Serial: {serialOk ? "ready" : "not connected"}</span>
              <span>Galvo H: {hGalvo ? "loaded" : "-"}</span>
              <span>Web-Thermal H: {hWebToThermal ? "loaded" : "-"}</span>
              <span>Sequence: {sequenceJson ? "loaded" : "-"}</span>
              <span>Observation Point: {obsWeb && obsThermal ? "set" : "not set"}</span>
            </div>
          </section>

          <section className="col panel" style={{ gap: 8 }}>
            <h4 style={{ margin: 0 }}>Timeline</h4>
            <canvas
              ref={tlCanvasRef}
              style={{ width: TIMELINE_CSS_WIDTH, height: TIMELINE_CSS_HEIGHT, maxWidth: "100%" }}
            />
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Duration: {(sequenceDurationMs / 1000).toFixed(2)}s
            </div>
          </section>

          <section className="col panel" style={{ gap: 8 }}>
            <h4 style={{ margin: 0 }}>Temperature Trend</h4>
            <canvas
              ref={graphCanvasRef}
              style={{ width: GRAPH_CSS_WIDTH, height: GRAPH_CSS_HEIGHT, maxWidth: "100%" }}
            />
            <div className="row" style={{ gap: 12, fontSize: 12, opacity: 0.8 }}>
              <span>Samples: {sampleCount}</span>
              <span>Sampling: {SAMPLE_INTERVAL_MS}ms (target 30Hz)</span>
              {lastSavedCsvPath && <span>Last CSV: {lastSavedCsvPath}</span>}
            </div>
          </section>

          <section className="col panel" style={{ gap: 8 }}>
            <h4 style={{ margin: 0 }}>Live Preview (click either preview to set observation point)</h4>
            <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
              <div className="col" style={{ gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Web Camera · FPS {fpsWeb.toFixed(1)}</div>
                <div className="canvasWrap">
                  <canvas ref={webCanvasRef} onClick={handleWebPreviewClick} style={{ cursor: "crosshair" }} />
                  <canvas ref={webOverlayRef} className="canvasOverlay" />
                </div>
              </div>

              <div className="col" style={{ gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Thermal Camera · FPS {fpsThermal.toFixed(1)}</div>
                <div className="canvasWrap">
                  <canvas
                    ref={thermalCanvasRef}
                    onClick={handleThermalPreviewClick}
                    style={{ cursor: "crosshair" }}
                  />
                  <canvas ref={thermalOverlayRef} className="canvasOverlay" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
