"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RemapRenderer } from "@/shared/gl/remap";
import { getFile } from "@/shared/db";
import { useCameraIds, useCameraStream } from "@/shared/hooks/useCameraStreams";
import { formatTimestamp } from "@/shared/util/time";
import { sanitize } from "@/shared/util/strings";
import { putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";

export type PreviewSelection =
  | {
      kind: "inter";
      runTs: string;
      camA: string; // destination grid (A)
      camB: string; // source camera (B)
      mapXYPath: string;
    }
  | {
      kind: "undist";
      runTs: string;
      cam: string; // single camera for undistortion
      mapXYPath: string;
    };

// Utility: load interleaved XY remap
async function loadRemapXY(
  path: string
): Promise<{ xy: Float32Array; width: number; height: number } | null> {
  const f = await getFile(path);
  if (!f || f.type !== "remapXY" || !f.width || !f.height) return null;
  const w = f.width,
    h = f.height;
  const xy = new Float32Array(f.data);

  console.log(f.path);
  console.log(xy);
  if (xy.length !== w * h * 2) return null;
  return { xy, width: w, height: h };
}

// Find undistortion map (combined XY) for given (runTs, camName)
async function findUndistMapXY(
  runTs: string,
  camName: string
): Promise<string | null> {
  // Preferred (slash only after timestamp)
  const pNew = `2-calibrate-scenes/${runTs}/cam-${sanitize(camName)}_remapXY.xy`;
  const fNew = await getFile(pNew);
  if (fNew) return pNew;
  // Backward compat: nested per‑cam dir (older build)
  const pMid = `2-calibrate-scenes/${runTs}/cam-${sanitize(camName)}/remapXY.xy`;
  const fMid = await getFile(pMid);
  if (fMid) return pMid;
  // Legacy flat path (pre-folder change)
  const pOld = `2-calibrate-scenes/${runTs}_cam-${sanitize(camName)}_remapXY.xy`;
  const fOld = await getFile(pOld);
  return fOld ? pOld : null;
}

export default function RemapPreview({
  sel,
}: {
  sel: PreviewSelection | null;
}) {
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>(
    []
  );
  // Source device: prefer first selected; user can change
  const [deviceId, setDeviceId] = useState<string>("");
  const stream = useCameraStream(deviceId);

  // GL bits
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rendererRef = useRef<RemapRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const [fps, setFps] = useState(0);

  // When cameras change, (re)enumerate labels and default the source
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        const vids = (list || []).filter((d) => d.kind === "videoinput");
        const vmin = vids.map((d) => ({
          deviceId: d.deviceId,
          label: d.label || d.deviceId,
        }));
        if (!mounted) return;
        setDevices(vmin);
        // Default device: use first selected id if present
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

  // Initialize renderer on mount
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

  // Push video element to renderer
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setSourceVideo(videoRef.current);
  }, [rendererRef.current, stream]);

  // Load mapping + undist maps upon selection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = rendererRef.current;
      if (!r || !sel) return;
      if (sel.kind === "inter") {
        const m = await loadRemapXY(sel.mapXYPath);
        if (!m) return;
        const undPath = await findUndistMapXY(sel.runTs, sel.camB);
        if (!undPath) return;
        const u = await loadRemapXY(undPath);
        if (!u) return;
        if (cancelled) return;
        r.setUndistMapXY(u.xy, { width: u.width, height: u.height });
        r.setInterMapXY(m.xy, { width: m.width, height: m.height });
      } else {
        // Single undistortion map: set as pass1, and use identity map for pass2
        const u = await loadRemapXY(sel.mapXYPath);
        if (!u) return;
        if (cancelled) return;
        r.setUndistMapXY(u.xy, { width: u.width, height: u.height });
        // Identity map for pass2 (dest = undist size, src coords = (x,y))
        const id = new Float32Array(u.width * u.height * 2);
        let idx = 0;
        for (let y = 0; y < u.height; y++) {
          for (let x = 0; x < u.width; x++) {
            id[idx++] = x;
            id[idx++] = y;
          }
        }
        r.setInterMapXY(id, { width: u.width, height: u.height });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sel]);

  

  // Render loop
  useEffect(() => {
    let mounted = true;
    let lastT = performance.now();
    let frames = 0;
    const loop = () => {
      const r = rendererRef.current;
      if (!mounted) return;
      if (r) r.render();
      frames++;
      const now = performance.now();
      if (now - lastT >= 500) {
        // update fps every 0.5s
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

  async function onSaveFrame() {
    const r = rendererRef.current;
    if (!r || !sel) return;
    const rgba = r.readPixels();
    if (!rgba || rgba.length === 0) return;
    const ts = formatTimestamp(new Date());
    const path =
      sel.kind === "inter"
        ? `3-remap-realtime/${ts}/cam-${sanitize(sel.camB)}_to_cam-${sanitize(sel.camA)}_preview.rgb`
        : `3-remap-realtime/${ts}/cam-${sanitize(sel.cam)}_undistorted_preview.rgb`;
    const outSize = r.getOutputSize() || { width: 0, height: 0 };
    const fe: FileEntry = {
      path,
      type: "rgb-image",
      data: rgba.buffer as ArrayBuffer,
      width: outSize.width,
      height: outSize.height,
      channels: 4,
    };
    await putFile(fe);
    // eslint-disable-next-line no-alert
    alert(`Saved: ${path}`);
  }

  return (
    <div className="col" style={{ gap: 8 }}>
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
          Expecting:{" "}
          <code>{sel ? (sel.kind === "inter" ? sel.camB : sel.cam) : "-"}</code>
        </span>
        <button onClick={onSaveFrame} disabled={!sel}>
          Save Frame
        </button>
        <span style={{ opacity: 0.75 }}>FPS: {fps.toFixed(1)}</span>
      </div>
      <div className="canvasWrap">
        <canvas ref={canvasRef} />
      </div>
      <video ref={videoRef} style={{ display: "none" }} />
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {sel?.kind === "inter" ? (
          <>
            Output grid: <b>{sel.camA}</b> (dest). Sampling from{" "}
            <b>{sel.camB}</b> (src, undistorted).
          </>
        ) : (
          <>
            Undistorted output for <b>{sel?.cam || "-"}</b>.
          </>
        )}
      </div>
    </div>
  );
}
