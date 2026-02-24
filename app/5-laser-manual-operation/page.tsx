"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles, getFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { SerialCommunicator } from "@/shared/hardware/serial";
import { RemapRenderer } from "@/shared/gl/remap";
import { useCameraIds, useCameraStream } from "@/shared/hooks/useCameraStreams";
import { loadRemapXY, buildIdentityInterMap } from "@/shared/util/remap";
import { invertHomography, applyHomography } from "@/shared/util/homography";
import { crampGalvoCoordinate } from "@/shared/util/calcHomography";

type UndistItem = {
  runTs: string;
  cam: string; // single camera undistortion map
  mapXYPath: string;
};

type HItem = {
  ts: string;
  path: string;
};

export default function Page() {
  const [items, setItems] = useState<UndistItem[]>([]);
  const [selKey, setSelKey] = useState<string>("");
  const selected = useMemo(() => items.find((x) => x.mapXYPath === selKey) || null, [items, selKey]);

  const [hItems, setHItems] = useState<HItem[]>([]);
  const [hSel, setHSel] = useState<string>("");
  const [H, setH] = useState<Float32Array | null>(null); // galvo->camera
  const [Hinv, setHinv] = useState<Float32Array | null>(null); // camera->galvo

  // Camera device selection
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const stream = useCameraStream(deviceId);

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

  const lastClickRef = useRef<{ x: number; y: number; gx: number; gy: number } | null>(null);

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
      const id = buildIdentityInterMap(u.width, u.height);
      r.setInterMapXY(id, { width: u.width, height: u.height });
      lastClickRef.current = null;
      drawOverlay();
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

  // Discover undistortion maps and homographies
  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const xy = files.filter((f) => f.path.startsWith("2-calibrate-scenes/") && /_remapXY\.xy$/.test(f.path));
      const out: UndistItem[] = [];
      for (const f of xy) {
        const m = f.path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
        if (m) out.push({ runTs: m[1], cam: m[2], mapXYPath: f.path });
      }
      out.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      setItems(out);
      setSelKey((prev) => (prev && out.some((x) => x.mapXYPath === prev) ? prev : out[0]?.mapXYPath || ""));

      const hs = files.filter((f) => f.path.startsWith("4-galvo-calibration/") && /-homography\.json$/.test(f.path));
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
            <h4>Undistortion Map (Select one)</h4>
            <div className="tree" style={{ maxHeight: 200, overflow: "auto" }}>
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
            {selected && (<div style={{ opacity: 0.8, fontSize: 13 }}>XY: {selected.mapXYPath}</div>)}
          </section>

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
                <input type="checkbox" checked={galvoSync} onChange={(e) => setGalvoSync(e.target.checked)} disabled={!serialOk || !Hinv} />
                Galvo Sync (click canvas to move)
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
            <video ref={videoRef} style={{ display: "none" }} />
          </section>
        </div>
      </main>
    </>
  );
}

