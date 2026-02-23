"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { listFiles } from "@/shared/db";
import { WasmWorkerClient } from "@/shared/wasm/client";
import { formatTimestamp } from "@/shared/util/time";
import { sanitize, shorten } from "@/shared/util/strings";
import { parseShotKey } from "@/shared/util/shots";
import {
  type CameraModel,
  detectCornersForRows,
  computeAndSaveIntrinsics,
  saveUndistortionMaps,
  computeAndSaveInterMapping,
} from "@/shared/calibration/pipeline";
import CheckerboardEnhancePreview from "@/shared/components/CheckerboardEnhancePreview";

// moved: ShotKey type → @/shared/util/shots

type ShotRow = {
  ts: string;
  cams: Record<string, string>; // camName -> file path
};

export default function Page() {
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [camNames, setCamNames] = useState<string[]>([]);
  const [camA, setCamA] = useState<string>("");
  const [camB, setCamB] = useState<string>("");
  const [modelA, setModelA] = useState<CameraModel>("normal");
  const [modelB, setModelB] = useState<CameraModel>("normal");
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
      const chk = files.filter((f) =>
        f.path.startsWith("1-syncro-checkerboard_shots/")
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
      if (!camA && camList[0]) setCamA(camList[0]);
      if (!camB && camList[1]) setCamB(camList[1]);
    })();
  }, []);

  const usableRows = useMemo(
    () => rows.filter((r) => r.cams[camA] && r.cams[camB]),
    [rows, camA, camB]
  );

  useEffect(() => {
    // When cameras change, auto-select all usable rows
    const s = new Set<string>();
    usableRows.forEach((r) => s.add(r.ts));
    setSelectedTs(s);
  }, [camA, camB, rows]);

  function appendLog(line: string) {
    setLog((prev) => `${prev}${prev ? "\n" : ""}${line}`);
  }

  async function runCalibration() {
    if (!camA || !camB) return;
    const wrk = workerRef.current;
    if (!wrk) return;
    setBusy(true);
    setLog("");
    const pick = usableRows.filter((r) => selectedTs.has(r.ts));
    appendLog(`Target pairs: ${pick.length} (${camA} ↔ ${camB})`);
    if (pick.length === 0) return setBusy(false);
    // 1) Detect corners
    const { detA, detB } = await detectCornersForRows(
      wrk,
      camA,
      camB,
      pick,
      appendLog
    );

    // 2) Intrinsics + extrinsics
    const runTs = formatTimestamp(new Date());
    const {
      intr: intrA,
      dist: distA,
      rvecs: rA,
      tvecs: tA,
    } = await computeAndSaveIntrinsics(
      wrk,
      camA,
      modelA,
      detA,
      runTs,
      appendLog
    );
    const {
      intr: intrB,
      dist: distB,
      rvecs: rB,
      tvecs: tB,
    } = await computeAndSaveIntrinsics(
      wrk,
      camB,
      modelB,
      detB,
      runTs,
      appendLog
    );

    // 3) Undistortion maps
    if (detA.length > 0)
      await saveUndistortionMaps(
        wrk,
        camA,
        detA[0].width,
        detA[0].height,
        intrA,
        distA,
        runTs,
        appendLog
      );
    if (detB.length > 0)
      await saveUndistortionMaps(
        wrk,
        camB,
        detB[0].width,
        detB[0].height,
        intrB,
        distB,
        runTs,
        appendLog
      );

    // 4) Inter-camera mapping
    await computeAndSaveInterMapping(
      wrk,
      detA,
      detB,
      intrA,
      distA,
      intrB,
      distB,
      camA,
      camB,
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
              Camera A
              <select value={camA} onChange={(e) => setCamA(e.target.value)}>
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
                value={modelA}
                onChange={(e) => setModelA(e.target.value as CameraModel)}
              >
                <option value="normal">normal</option>
                <option value="fisheye">fisheye</option>
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              Camera B
              <select value={camB} onChange={(e) => setCamB(e.target.value)}>
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
                value={modelB}
                onChange={(e) => setModelB(e.target.value as CameraModel)}
              >
                <option value="normal">normal</option>
                <option value="fisheye">fisheye</option>
              </select>
            </label>
            <button
              onClick={runCalibration}
              disabled={busy || !camA || !camB || selectedTs.size === 0}
            >
              Run ({selectedTs.size} pairs)
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>Pre‑Detect Preview (per camera)</h4>
            <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              {camA && (
                <CheckerboardEnhancePreview
                  camName={camA}
                  rows={rows}
                  selectedTs={selectedTs}
                  worker={workerRef.current}
                />
              )}
              {camB && (
                <CheckerboardEnhancePreview
                  camName={camB}
                  rows={rows}
                  selectedTs={selectedTs}
                  worker={workerRef.current}
                />
              )}
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Tip: Switch frames and modes to verify the checkerboard pops before you run.
            </div>
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h4>Select Frames (from 1-syncro-checkerboard_shots)</h4>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ opacity: 0.8 }}>Targets</span>
              <span style={{ fontFamily: "monospace" }}>{camA}</span>
              <span>×</span>
              <span style={{ fontFamily: "monospace" }}>{camB}</span>
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
                  <span style={{ opacity: 0.8 }}>A:</span>
                  <span
                    className="file"
                    title={r.cams[camA]}
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shorten(r.cams[camA])}
                  </span>
                  <span style={{ opacity: 0.8 }}>B:</span>
                  <span
                    className="file"
                    title={r.cams[camB]}
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shorten(r.cams[camB])}
                  </span>
                </label>
              ))}
              {usableRows.length === 0 && (
                <div style={{ opacity: 0.7 }}>No selectable frames found</div>
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
          {/* Enhanced previews are shown above; no FS preview here */}
        </div>
      </main>
    </>
  );
}

// No FilePreview on this page (Home only)
