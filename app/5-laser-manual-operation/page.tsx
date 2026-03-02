"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles, getFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { SerialCommunicator } from "@/shared/module/serialInterface";
import { RemapRenderer } from "@/shared/gl/remap";
import { useCameraIds } from "@/shared/hooks/useCameraStreams";
import { useVideoSource } from "@/shared/hooks/useVideoSource";
import { listMergedVideoInputs } from "@/shared/util/devices";
import { loadRemapXY, buildIdentityInterMap } from "@/shared/util/remap";
import { invertHomography, applyHomography } from "@/shared/util/homography";
import { crampGalvoCoordinate } from "@/shared/util/calcHomography";
import { sanitize } from "@/shared/util/strings";

type UndistItem = { runTs: string; cam: string; mapXYPath: string };

type HItem = {
  ts: string;
  path: string;
};

export default function Page() {
  const [selected, setSelected] = useState<UndistItem | null>(null);

  const [hItems, setHItems] = useState<HItem[]>([]);
  const [hSel, setHSel] = useState<string>("");
  const [H, setH] = useState<Float32Array | null>(null); // galvo->camera
  const [Hinv, setHinv] = useState<Float32Array | null>(null); // camera->galvo

  // Camera device selection
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const source = useVideoSource(deviceId);

  // GL renderer (undist pass only here) + overlay
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rendererRef = useRef<RemapRenderer | null>(null);
  const [fps, setFps] = useState(0);
  const rafRef = useRef<number>(0);

  // Serial
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [serialOk, setSerialOk] = useState(false);
  const [galvoSync, setGalvoSync] = useState(false);
  const [laserPct, setLaserPct] = useState<number>(0);
  const ready = serialOk && !!Hinv;

  const lastClickRef = useRef<{ x: number; y: number; gx: number; gy: number } | null>(null);

  // Enumerate devices; default to first selected id
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
    return () => {
      mounted = false;
    };
  }, [camIds]);

  // Acquire a video element and pass to renderer
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!source) {
        const r = rendererRef.current; if (r) r.setSourceVideo(null);
        videoRef.current = null; return;
      }
      const webgl = await source.toWebGL();
      if (cancelled) return;
      const v = webgl?.element || null;
      videoRef.current = v;
      const r = rendererRef.current; if (r) r.setSourceVideo(v);
    })();
    return () => { cancelled = true; };
  }, [source]);

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

  // Ensure renderer sees the latest video element
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setSourceVideo(videoRef.current || null);
  }, [rendererRef.current]);

  // Load undist map and set identity inter map on selection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = rendererRef.current;
      if (!r || !selected) return;
      const u = await loadRemapXY(selected.mapXYPath);
      if (!u || cancelled) return;
      r.setUndistMapXY(u.xy, { width: u.width, height: u.height });
      const id = buildIdentityInterMap(u.width, u.height);
      r.setInterMapXY(id, { width: u.width, height: u.height });
      lastClickRef.current = null;
      drawOverlay();
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.mapXYPath]);

  // Fallback: no undistortion map → identity for both passes using video dimensions
  useEffect(() => {
    let cancelled = false;
    const r = rendererRef.current;
    const v = videoRef.current;
    if (!r || !v) return;
    if (selected) return; // handled by the effect above
    function applyIdentity() {
      if (cancelled) return;
      const w = v.videoWidth || 0;
      const h = v.videoHeight || 0;
      if (!w || !h) return;
      const id = buildIdentityInterMap(w, h);
      r.setUndistMapXY(id, { width: w, height: h });
      r.setInterMapXY(id, { width: w, height: h });
      drawOverlay();
    }
    if (v.readyState >= 2) applyIdentity();
    else v.addEventListener("loadedmetadata", applyIdentity, { once: true });
    return () => { cancelled = true; };
  }, [selected?.mapXYPath, source]);

  // Auto-select latest undistortion map by camera (device label sanitized)
  useEffect(() => {
    (async () => {
      if (!deviceId) { setSelected(null); return; }
      const label = devices.find((d) => d.deviceId === deviceId)?.label || deviceId;
      const camName = sanitize(label);
      const files = await listFiles();
      const xy = files.filter((f) => f.type === "remapXY" && f.path.startsWith("2-calibrate-scenes/"));
      const matches: UndistItem[] = [];
      for (const f of xy) {
        const m = f.path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
        if (m && m[2] === camName) matches.push({ runTs: m[1], cam: m[2], mapXYPath: f.path });
      }
      matches.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      setSelected(matches[0] || null);
    })();
  }, [deviceId, devices]);

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

  // Discover homographies (undistortion map is auto-selected separately)
  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const hs = files.filter((f) => f.type === "homography-json" && f.path.startsWith("4-galvo-calibration/"));
      const hout: HItem[] = [];
      for (const f of hs) {
        const m = f.path.match(/^4-galvo-calibration\/([^/]+)-homography\.json$/);
        if (m) hout.push({ ts: m[1], path: f.path });
      }
      hout.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setHItems(hout);
      setHSel((prev) => (prev && hout.some((x) => x.path === prev) ? prev : hout[0]?.path || ""));
    })();
  }, []);

  // Load selected homography
  useEffect(() => {
    (async () => {
      if (!hSel) {
        setH(null);
        setHinv(null);
        return;
      }
      const fe = await getFile(hSel);
      if (!fe) {
        setH(null);
        setHinv(null);
        return;
      }
      try {
        if (!fe.data) throw new Error("missing data");
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(fe.data)));
        // Accept both { H: number[9] } and { homography3x3: number[9] }
        const arr: number[] | undefined = Array.isArray(json?.H)
          ? json.H
          : Array.isArray(json?.homography3x3)
          ? json.homography3x3
          : undefined;
        if (arr && arr.length === 9) {
          const h = new Float32Array(arr);
          setH(h);
          setHinv(invertHomography(h));
        } else {
          setH(null);
          setHinv(null);
        }
      } catch {
        setH(null);
        setHinv(null);
      }
    })();
  }, [hSel]);

  // Debug: log readiness toggles
  useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.log("[5] GalvoSync readiness", { serialOk, hasHinv: !!Hinv, hSel, deviceId });
    } catch {}
  }, [serialOk, Hinv, hSel, deviceId]);

  function drawOverlay() {
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
    // last click
    const pt = lastClickRef.current;
    if (pt) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,80,80,0.95)";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      // text
      const label = `cam=(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) → galvo=(${pt.gx|0}, ${pt.gy|0})`;
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(Math.min(pt.x + 10, can.width - w - 4), Math.max(4, pt.y - 14), w, 16);
      ctx.fillStyle = "#eaeaea";
      ctx.fillText(label, Math.min(pt.x + 14, can.width - w), Math.max(16, pt.y));
      ctx.restore();
    }
  }

  async function onCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const can = canvasRef.current;
    const r = rendererRef.current;
    if (!can || !r) return;
    const rect = can.getBoundingClientRect();
    const size = r.getOutputSize();
    if (!size) return;
    const sx = (ev.clientX - rect.left) * (can.width / rect.width);
    const sy = (ev.clientY - rect.top) * (can.height / rect.height);

    let gx = Number.NaN, gy = Number.NaN;
    if (Hinv) {
      const g = applyHomography(Hinv, sx, sy);
      gx = g.x; gy = g.y;
    }

    const clamped = crampGalvoCoordinate({ x: gx, y: gy });
    lastClickRef.current = { x: sx, y: sy, gx: clamped.x, gy: clamped.y };
    drawOverlay();

    if (galvoSync && serialOk && Number.isFinite(clamped.x) && Number.isFinite(clamped.y)) {
      try { await serial?.setGalvoPos(clamped.x, clamped.y); } catch {}
    }
  }

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>5. Laser Manual Operation</b>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <label className="row" style={{ gap: 6 }}>
              Source Camera
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={devices.length === 0}>
                <option value="">(unselected)</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={async () => {
                if (serialOk) return;
                const s = new SerialCommunicator();
                const ok = await s.connect();
                if (ok) { setSerial(s); setSerialOk(true); } else { try { await s.disconnect(); } catch {}; setSerial(null); setSerialOk(false); }
              }}
              disabled={serialOk}
            >
              {serialOk ? "Connected" : "Connect Microcontroller"}
            </button>
            {serialOk && (
              <button onClick={async () => { try { await serial?.disconnect(); } catch {}; setSerial(null); setSerialOk(false); }}>Disconnect</button>
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
                  onClick={() => setHSel(h.path)}
                  title={h.path}
                >
                  <span style={{ width: 220, fontFamily: "monospace" }}>{h.ts}</span>
                  <span>{h.path}</span>
                </div>
              ))}
              {hItems.length === 0 && (
                <div style={{ opacity: 0.7 }}>No homography files found (run /4 calibration).</div>
              )}
            </div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>H: {H ? "loaded" : "-"} / inverse: {Hinv ? "ok" : "-"}</div>
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Preview & Control</h4>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <span style={{ opacity: 0.75 }}>FPS: {fps.toFixed(1)}</span>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={galvoSync}
                  onChange={(e) => setGalvoSync(e.target.checked)}
                  disabled={!ready}
                  title={!serialOk ? "Connect Microcontroller first" : (!Hinv ? "Load a homography (Hinv)" : "" )}
                />
                Galvo Sync (click canvas to move)
                <span style={{ fontSize: 12, opacity: 0.6 }}>
                  [{serialOk ? "serial:ok" : "serial:-"}, {Hinv ? "Hinv:ok" : "Hinv:-"}]
                </span>
              </label>
              <label className="row" style={{ gap: 6 }}>
                Laser (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={laserPct}
                  onChange={async (e) => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value) | 0));
                    setLaserPct(v);
                    if (serialOk) {
                      try { await serial?.setLaserOutput(v); } catch {}
                    }
                  }}
                  style={{ width: 70 }}
                />
              </label>
            </div>
            <div className="canvasWrap">
              <canvas ref={canvasRef} onClick={onCanvasClick} />
              <canvas ref={overlayCanvasRef} className="canvasOverlay" />
            </div>
            {!selected && (
              <div
                style={{
                  marginTop: 8,
                  padding: "6px 8px",
                  border: "1px solid #e8b40066",
                  background: "#e8b40011",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                ⚠︎ No undistortion map found for this camera — showing raw feed.
              </div>
            )}
            {/* Video element is obtained from the source and held off-DOM */}
          </section>
        </div>
      </main>
    </>
  );
}
