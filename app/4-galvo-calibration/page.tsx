"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles, putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { SerialCommunicator } from "@/shared/module/serialInterface";
import { useCameraIds } from "@/shared/hooks/useCameraStreams";
import { listMergedVideoInputs } from "@/shared/util/devices";
import { formatTimestamp } from "@/shared/util/time";
import { WasmWorkerClient } from "@/shared/wasm/client";
import HeaderBar from "@/shared/components/GalvoCalibrationHeaderBar";
import { Preview, type PreviewHandle } from "@/shared/components/GalvoCalibrationPreview";
import RunPanel from "@/shared/components/GalvoCalibrationRunPanel";
import LogFooterShell from "@/components/LogFooterShell";
import type { GridParams, Range, Timing, UndistItem } from "@/shared/calibration/galvoTypes";
import { sanitize } from "@/shared/util/strings";

// Shared types are in app/shared/calibration/galvoTypes

// loadRemapXY and identity inter-map shared via app/shared/util/remap

export default function Page() {
  const [selected, setSelected] = useState<UndistItem | null>(null);

  // Camera device selection
  const [camIds] = useCameraIds();
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const previewRef = useRef<PreviewHandle | null>(null);
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

  // Reset overlay when undistortion map changes
  useEffect(() => {
    spotsRef.current = { pts: [], last: null };
  }, [selected?.mapXYPath]);

  // Auto-select latest undistortion map for the chosen camera (by device label sanitized)
  useEffect(() => {
    (async () => {
      if (!deviceId) { setSelected(null); return; }
      const label = devices.find((d) => d.deviceId === deviceId)?.label || deviceId;
      const camName = sanitize(label);
      const files = await listFiles();
      const xy = files.filter((f) => f.path.startsWith("2-calibrate-scenes/") && /_remapXY\.xy$/.test(f.path));
      const matches: UndistItem[] = [];
      for (const f of xy) {
        const m = f.path.match(/^2-calibrate-scenes\/([^/]+)\/cam-(.+?)_remapXY\.xy$/);
        if (m && m[2] === camName) matches.push({ runTs: m[1], cam: m[2], mapXYPath: f.path });
      }
      matches.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      setSelected(matches[0] || null);
    })();
  }, [deviceId, devices]);

  // captureFrame now lives in <Preview /> via ref

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
    const base = await previewRef.current?.captureFrame();
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

      const shot = await previewRef.current?.captureFrame();
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
      <HeaderBar
        title="4. Galvo Calibration"
        devices={devices}
        deviceId={deviceId}
        setDeviceId={setDeviceId}
        expectedCam={selected?.cam}
        serialOk={serialOk}
        onConnect={async () => {
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
        onDisconnect={async () => {
          try { await serial?.disconnect(); } catch {}
          setSerial(null);
          setSerialOk(false);
        }}
        fps={fps}
      />
      <LogFooterShell log={log} title="Log">
        <div className="col" style={{ gap: 16 }}>
          <Preview
            ref={previewRef}
            deviceId={deviceId}
            selected={selected}
            grid={grid}
            showOverlay={showOverlay}
            setShowOverlay={setShowOverlay}
            spots={spotsRef.current.pts}
            last={spotsRef.current.last}
            onClearOverlay={() => {
              spotsRef.current = { pts: [], last: null };
            }}
            onFps={setFps}
          />

          <RunPanel
            grid={grid}
            setGrid={setGrid}
            xRange={xRange}
            setXRange={setXRange}
            yRange={yRange}
            setYRange={setYRange}
            laserPct={laserPct}
            setLaserPct={setLaserPct}
            timing={timing}
            setTiming={setTiming}
            busy={busy}
            canRun={serialOk}
            disabledReason={!serialOk ? "Connect Microcontroller first" : undefined}
            onStart={runCalibration}
            onCancel={() => {
              cancelRef.current = true;
              appendLog("Cancel requested; finishing current step…");
            }}
          />

        </div>
      </LogFooterShell>
    </>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
