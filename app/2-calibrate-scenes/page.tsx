"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles } from "@/shared/db";
import { WasmWorkerClient } from "@/shared/wasm/client";
import { formatTimestamp } from "@/shared/util/time";
import { shorten } from "@/shared/util/strings";
import { parseShotKey } from "@/shared/util/shots";
import {
  type CameraModel,
  detectCornersForCam,
  computeAndSaveIntrinsics,
  saveUndistortionMaps,
} from "@/shared/calibration/pipeline";
import CheckerboardEnhancePreview from "@/shared/components/CheckerboardEnhancePreview";
import LogFooterShell from "@/components/LogFooterShell";

// moved: ShotKey type → @/shared/util/shots

type ShotRow = {
  ts: string;
  cams: Record<string, string>; // camName -> file path
};

export default function Page() {
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [camNames, setCamNames] = useState<string[]>([]);
  const [cam, setCam] = useState<string>("");
  const [model, setModel] = useState<CameraModel>("normal");
  const [selectedTs, setSelectedTs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>("");
  const workerRef = useRef<WasmWorkerClient | null>(null);

  useEffect(() => {
    workerRef.current = new WasmWorkerClient();
    return () => {
      workerRef.current?.dispose();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const chk = files.filter(
        (f) => (f.type === "rgb-image" || f.type === "grayscale-image") && f.path.startsWith("1-syncro-checkerboard_shots/")
      );
      const map = new Map<string, ShotRow>();
      const cams = new Set<string>();
      for (const f of chk) {
        const key = parseShotKey(f.path);
        if (!key) continue;
        cams.add(key.cam);
        const r = map.get(key.ts) || { ts: key.ts, cams: {} };
        r.cams[key.cam] = f.path;
        map.set(key.ts, r);
      }
      const sorted = Array.from(map.values()).sort((a, b) =>
        a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
      );
      setRows(sorted);
      const camList = Array.from(cams.values()).sort();
      setCamNames(camList);
      if (!cam && camList[0]) setCam(camList[0]);
    })();
  }, []);

  const usableRows = useMemo(
    () => rows.filter((r) => (cam ? !!r.cams[cam] : false)),
    [rows, cam]
  );

  useEffect(() => {
    // When cameras change, auto-select all usable rows
    const s = new Set<string>();
    usableRows.forEach((r) => s.add(r.ts));
    setSelectedTs(s);
  }, [cam, rows]);

  function appendLog(line: string) {
    setLog((prev) => `${prev}${prev ? "\n" : ""}${line}`);
  }

  async function runCalibration() {
    if (!cam) return;
    const wrk = workerRef.current;
    if (!wrk) return;
    setBusy(true);
    setLog("");
    const pick = usableRows.filter((r) => selectedTs.has(r.ts));
    appendLog(`Target frames: ${pick.length} (cam=${cam})`);
    if (pick.length === 0) return setBusy(false);
    // 1) Detect corners (single camera)
    const dets = await detectCornersForCam(wrk, cam, pick, appendLog);

    // 2) Intrinsics + extrinsics (single camera)
    const runTs = formatTimestamp(new Date());
    const { intr, dist } = await computeAndSaveIntrinsics(
      wrk,
      cam,
      model,
      dets,
      runTs,
      appendLog
    );

    // 3) Undistortion maps (single camera)
    if (dets.length > 0)
      await saveUndistortionMaps(
        wrk,
        cam,
        dets[0].width,
        dets[0].height,
        intr,
        dist,
        model,
        runTs,
        appendLog
      );
    setBusy(false);
  }

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>2. Calibrate Scenes</b>
          <div className="row" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 6 }}>
              Camera
              <select value={cam} onChange={(e) => setCam(e.target.value)}>
                {camNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              Model
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as CameraModel)}
              >
                <option value="normal">normal</option>
                <option value="fisheye">fisheye</option>
              </select>
            </label>
            <button
              onClick={runCalibration}
              disabled={busy || !cam || selectedTs.size === 0}
            >
              Run ({selectedTs.size} frames)
            </button>
          </div>
        </div>
      </header>
      <LogFooterShell log={log} title="Log">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>Pre‑Detect Preview</h4>
            <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              {cam && (
                <CheckerboardEnhancePreview
                  camName={cam}
                  rows={rows}
                  selectedTs={selectedTs}
                  worker={workerRef.current}
                />
              )}
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Tip: Choose a frame and tweak settings (contrast / invert) so the checkerboard pops before you run.
            </div>
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h4>Select Frames (from 1-syncro-checkerboard_shots)</h4>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ opacity: 0.8 }}>Target</span>
              <span style={{ fontFamily: "monospace" }}>{cam || "(cam)"}</span>
              <button
                onClick={() =>
                  setSelectedTs(new Set(usableRows.map((r) => r.ts)))
                }
                disabled={usableRows.length === 0}
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedTs(new Set())}
                disabled={selectedTs.size === 0}
              >
                Clear All
              </button>
            </div>
            <div className="tree" style={{ maxHeight: 240, overflow: "auto" }}>
              {usableRows.map((r) => (
                <label
                  key={r.ts}
                  className="row"
                  style={{ gap: 8, alignItems: "center", padding: "2px 4px" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTs.has(r.ts)}
                    onChange={(e) => {
                      const s = new Set(selectedTs);
                      if (e.target.checked) s.add(r.ts);
                      else s.delete(r.ts);
                      setSelectedTs(s);
                    }}
                  />
                  <span style={{ width: 280, fontFamily: "monospace" }}>
                    {r.ts}
                  </span>
                  <span
                    className="file"
                    title={cam ? r.cams[cam] : ""}
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cam ? shorten(r.cams[cam]) : ""}
                  </span>
                </label>
              ))}
              {usableRows.length === 0 && (
                <div style={{ opacity: 0.7 }}>No selectable frames found</div>
              )}
            </div>
          </section>
          {/* log footer renders below */}
          {/* Enhanced previews are shown above; no FS preview here */}
        </div>
      </LogFooterShell>
    </>
  );
}

// No FilePreview on this page (Home only)
