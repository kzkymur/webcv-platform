"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import DeviceSettings from "@/shared/components/DeviceSettings";
import FileSystemBrowser from "@/shared/components/FileSystemBrowser";
import { getFile, listFiles, putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { WasmWorkerClient } from "@/shared/wasm/client";

type CameraModel = "normal" | "fisheye"; // fisheye reserved for future (C++ uses normal model now)

type ShotKey = {
  ts: string; // e.g., 2026-02-20_12-34-56.123
  cam: string; // sanitized camera name
};

type ShotRow = {
  ts: string;
  cams: Record<string, string>; // camName -> file path
};

export default function Page() {
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
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
      const chk = files.filter((f) => f.path.startsWith("1-syncro-checkerboard_shots/"));
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
      const sorted = Array.from(map.values()).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      setRows(sorted);
      const camList = Array.from(cams.values()).sort();
      setCamNames(camList);
      if (!camA && camList[0]) setCamA(camList[0]);
      if (!camB && camList[1]) setCamB(camList[1]);
    })();
  }, []);

  const usableRows = useMemo(() => rows.filter((r) => r.cams[camA] && r.cams[camB]), [rows, camA, camB]);

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
    appendLog(`対象ペア: ${pick.length} 組 (${camA} ↔ ${camB})`);
    if (pick.length === 0) return setBusy(false);

    // 1) Detect corners for each selected frame per camera
    type Det = { ts: string; cam: string; path: string; width: number; height: number; points: Float32Array };
    const detA: Det[] = [];
    const detB: Det[] = [];
    for (const r of pick) {
      for (const cam of [camA, camB]) {
        const path = r.cams[cam]!;
        const fe = await getFile(path);
        if (!fe) continue;
        const { rgba, width, height } = fileToRGBA(fe);
        const res = await wrk.cvFindChessboardCorners(rgba, width, height);
        if (!res.found) {
          appendLog(`× コーナー検出失敗: ${r.ts} cam=${cam}`);
          continue;
        }
        const det: Det = { ts: r.ts, cam, path, width, height, points: res.points };
        if (cam === camA) detA.push(det); else detB.push(det);
        appendLog(`✓ コーナー検出: ${r.ts} cam=${cam} (${width}x${height})`);
      }
    }

    // 2) Per-camera intrinsics + extrinsics (normal / fisheye)
    const runTs = formatTimestamp(new Date());
    let intrA: Float32Array | null = null, distA: Float32Array | null = null, rA: Float32Array | null = null, tA: Float32Array | null = null;
    let intrB: Float32Array | null = null, distB: Float32Array | null = null, rB: Float32Array | null = null, tB: Float32Array | null = null;
    try {
      if (detA.length > 0) {
        const width = detA[0].width, height = detA[0].height;
        if (modelA === "fisheye") {
          const { ok, intr, dist, rvecs, tvecs } = await wrk.cvCalcInnerParamsFisheyeExt(width, height, detA.map((d) => d.points));
          intrA = intr; distA = dist; rA = rvecs; tA = tvecs;
          appendLog(`✓ 内部・外部パラメータ(${camA}, fisheye) 計算${ok ? "" : " (警告: ok=false)"}`);
        } else {
          const { ok, intr, dist, rvecs, tvecs } = await wrk.cvCalcInnerParamsExt(width, height, detA.map((d) => d.points));
          intrA = intr; distA = dist; rA = rvecs; tA = tvecs;
          appendLog(`✓ 内部・外部パラメータ(${camA}) 計算${ok ? "" : " (警告: ok=false)"}`);
        }
        await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_intrinsics.json`, { width, height, intrinsics3x3: Array.from(intrA!) }));
        await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_distCoeffs.json`, { distCoeffs: Array.from(distA!) }));
        if (rA && tA) {
          const frames = detA.map((d, i) => ({ ts: d.ts, rvec: Array.from(rA!.slice(i*3, i*3+3)), tvec: Array.from(tA!.slice(i*3, i*3+3)) }));
          await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_extrinsics.json`, { frames }));
        }
      }
    } catch (e: any) {
      appendLog(`! 内部パラメータ(${camA}) 計算失敗: ${String(e)}`);
    }
    try {
      if (detB.length > 0) {
        const width = detB[0].width, height = detB[0].height;
        if (modelB === "fisheye") {
          const { ok, intr, dist, rvecs, tvecs } = await wrk.cvCalcInnerParamsFisheyeExt(width, height, detB.map((d) => d.points));
          intrB = intr; distB = dist; rB = rvecs; tB = tvecs;
          appendLog(`✓ 内部・外部パラメータ(${camB}, fisheye) 計算${ok ? "" : " (警告: ok=false)"}`);
        } else {
          const { ok, intr, dist, rvecs, tvecs } = await wrk.cvCalcInnerParamsExt(width, height, detB.map((d) => d.points));
          intrB = intr; distB = dist; rB = rvecs; tB = tvecs;
          appendLog(`✓ 内部・外部パラメータ(${camB}) 計算${ok ? "" : " (警告: ok=false)"}`);
        }
        await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_intrinsics.json`, { width, height, intrinsics3x3: Array.from(intrB!) }));
        await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_distCoeffs.json`, { distCoeffs: Array.from(distB!) }));
        if (rB && tB) {
          const frames = detB.map((d, i) => ({ ts: d.ts, rvec: Array.from(rB!.slice(i*3, i*3+3)), tvec: Array.from(tB!.slice(i*3, i*3+3)) }));
          await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_extrinsics.json`, { frames }));
        }
      }
    } catch (e: any) {
      appendLog(`! 内部パラメータ(${camB}) 計算失敗: ${String(e)}`);
    }

    // 3) Undistort maps (if intrinsics available)
    try {
      if (intrA && distA && detA.length > 0) {
        const width = detA[0].width, height = detA[0].height;
        const { mapX, mapY } = await wrk.cvCalcUndistMap(width, height, intrA, distA);
        await putFile(remapFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_remapX`, mapX, width, height));
        await putFile(remapFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_remapY`, mapY, width, height));
        appendLog(`✓ 歪み補正マップ(${camA}) 保存`);
      }
    } catch (e: any) {
      appendLog(`! 歪み補正マップ(${camA}) 失敗: ${String(e)}`);
    }
    try {
      if (intrB && distB && detB.length > 0) {
        const width = detB[0].width, height = detB[0].height;
        const { mapX, mapY } = await wrk.cvCalcUndistMap(width, height, intrB, distB);
        await putFile(remapFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_remapX`, mapX, width, height));
        await putFile(remapFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camB)}_remapY`, mapY, width, height));
        appendLog(`✓ 歪み補正マップ(${camB}) 保存`);
      }
    } catch (e: any) {
      appendLog(`! 歪み補正マップ(${camB}) 失敗: ${String(e)}`);
    }

    // 4) Inter-camera mapping (undist domain remap)
    let saved = 0;
    for (const a of detA) {
      const b = detB.find((x) => x.ts === a.ts);
      if (!b) continue;
      try {
        if (!intrA || !distA || !intrB || !distB) throw new Error("intrinsics missing");
        const { H } = await wrk.cvCalcHomographyUndist(a.points, b.points, intrA, distA, intrB, distB);
        await putFile(jsonFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(camB)}_${a.ts}_H_undist.json`, { homography3x3: Array.from(H) }));
        const { mapX, mapY } = await wrk.cvCalcInterRemapUndist(a.width, a.height, b.width, b.height, intrA, distA, intrB, distB, H);
        await putFile(remapFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(camB)}_${a.ts}_mappingX`, mapX, a.width, a.height));
        await putFile(remapFile(`2-calibrate-scenes/${runTs}_cam-${sanitize(camA)}_to_cam-${sanitize(camB)}_${a.ts}_mappingY`, mapY, a.width, a.height));
        saved++;
      } catch (e: any) {
        appendLog(`! Homography 保存失敗: ${a.ts} (${String(e)})`);
      }
    }
    appendLog(`✓ カメラ間マッピング保存 (undist domain): ${saved}/${pick.length} 件`);
    setBusy(false);
  }

  return (
    <>
      <aside className="sidebar">
        <div className="panel">
          <h3>デバイス設定</h3>
          <DeviceSettings />
        </div>
        <div className="panel">
          <h3>ファイルシステム</h3>
          <FileSystemBrowser onSelect={setActiveFile} />
        </div>
      </aside>
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>2. カメラ群の位置合わせ</b>
          <div className="row" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 6 }}>
              Camera A
              <select value={camA} onChange={(e) => setCamA(e.target.value)}>
                {camNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              Model
              <select value={modelA} onChange={(e) => setModelA(e.target.value as CameraModel)}>
                <option value="normal">normal</option>
                <option value="fisheye">fisheye</option>
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              Camera B
              <select value={camB} onChange={(e) => setCamB(e.target.value)}>
                {camNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              Model
              <select value={modelB} onChange={(e) => setModelB(e.target.value as CameraModel)}>
                <option value="normal">normal</option>
                <option value="fisheye">fisheye</option>
              </select>
            </label>
            <button onClick={runCalibration} disabled={busy || !camA || !camB || selectedTs.size === 0}>
              実行 ({selectedTs.size} 組)
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>対象フレームの選択 (1-syncro-checkerboard_shots)</h4>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ opacity: 0.8 }}>検出対象</span>
              <span style={{ fontFamily: "monospace" }}>{camA}</span>
              <span>×</span>
              <span style={{ fontFamily: "monospace" }}>{camB}</span>
              <button onClick={() => setSelectedTs(new Set(usableRows.map((r) => r.ts)))} disabled={usableRows.length === 0}>全選択</button>
              <button onClick={() => setSelectedTs(new Set())} disabled={selectedTs.size === 0}>全解除</button>
            </div>
            <div className="tree" style={{ maxHeight: 240, overflow: "auto" }}>
              {usableRows.map((r) => (
                <label key={r.ts} className="row" style={{ gap: 8, alignItems: "center", padding: "2px 4px" }}>
                  <input
                    type="checkbox"
                    checked={selectedTs.has(r.ts)}
                    onChange={(e) => {
                      const s = new Set(selectedTs);
                      if (e.target.checked) s.add(r.ts); else s.delete(r.ts);
                      setSelectedTs(s);
                    }}
                  />
                  <span style={{ width: 280, fontFamily: "monospace" }}>{r.ts}</span>
                  <span style={{ opacity: 0.8 }}>A:</span>
                  <span className="file" title={r.cams[camA]} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shorten(r.cams[camA])}</span>
                  <span style={{ opacity: 0.8 }}>B:</span>
                  <span className="file" title={r.cams[camB]} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shorten(r.cams[camB])}</span>
                </label>
              ))}
              {usableRows.length === 0 && <div style={{ opacity: 0.7 }}>選択可能なフレームが見つかりません</div>}
            </div>
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h4>ログ</h4>
            <pre style={{ minHeight: 120, maxHeight: 240, overflow: "auto", background: "#111", padding: 8, borderRadius: 4 }}>{log}</pre>
          </section>
          {activeFile && (
            <section>
              <h4>選択中のファイル: {activeFile.path}</h4>
              <FilePreview file={activeFile} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

function parseShotKey(path: string): ShotKey | null {
  // 1-syncro-checkerboard_shots/<ts>_cam-<cam>
  const m = path.match(/^1-syncro-checkerboard_shots\/(.+?)_cam-(.+)$/);
  if (!m) return null;
  return { ts: m[1], cam: m[2] };
}

function formatTimestamp(d: Date) {
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function sanitize(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
}

function shorten(s: string) {
  if (!s) return s;
  return s.length > 48 ? s.slice(0, 22) + "…" + s.slice(-22) : s;
}

function fileToRGBA(file: FileEntry): { rgba: Uint8ClampedArray; width: number; height: number } {
  const w = file.width ?? 0;
  const h = file.height ?? 0;
  const u8 = new Uint8ClampedArray(file.data);
  if (file.type === "grayscale-image") {
    if (file.channels === 4) return { rgba: u8, width: w, height: h };
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = u8[i];
      out[i * 4 + 0] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    return { rgba: out, width: w, height: h };
  }
  return { rgba: u8, width: w, height: h };
}

function jsonFile(path: string, obj: any): FileEntry {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  return { path, type: "other", data: data.buffer as ArrayBuffer };
}

function remapFile(path: string, arr: Float32Array, width: number, height: number): FileEntry {
  return { path, type: "remap", data: arr.buffer as ArrayBuffer, width, height, channels: 1 };
}

function FilePreview({ file }: { file: FileEntry }) {
  const [imgData, setImgData] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!file) return;
    if (file.type === "rgb-image" || file.type === "grayscale-image") {
      const w = file.width ?? 0;
      const h = file.height ?? 0;
      const u8 = new Uint8ClampedArray(file.data);
      let rgba: Uint8ClampedArray;
      if (file.type === "grayscale-image") {
        if (file.channels === 4) rgba = u8; else {
          const out = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) {
            const v = u8[i];
            out[i * 4 + 0] = out[i * 4 + 1] = out[i * 4 + 2] = v;
            out[i * 4 + 3] = 255;
          }
          rgba = out;
        }
      } else {
        rgba = u8;
      }
      setImgData(new ImageData(new Uint8ClampedArray(rgba), w, h));
    } else {
      setImgData(null);
    }
  }, [file]);
  if (!imgData) return null;
  return (
    <canvas
      className="canvasWrap"
      width={imgData.width}
      height={imgData.height}
      ref={(c) => {
        if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.putImageData(imgData, 0, 0);
      }}
    />
  );
}
