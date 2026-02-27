"use client";

export const dynamic = "error";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { getFile, listFiles, putFile } from "@/shared/db";
import { WasmWorkerClient } from "@/shared/wasm/client";
import { fileToRGBA } from "@/shared/util/fileEntry";
import { parseShotKey } from "@/shared/util/shots";
import { sanitize } from "@/shared/util/strings";
import { loadRemapXY } from "@/shared/util/remap";
import CheckerboardEnhancePreview from "@/shared/components/CheckerboardEnhancePreview";
import { applyRemapXYBilinear } from "@/shared/image/remapCpu";
import { getPostOpsForCam } from "@/shared/calibration/postprocessConfig";
import { applyPostOpsRgbaViaGray } from "@/shared/image/postprocess";
import { formatTimestamp } from "@/shared/util/time";
import { applyHomography } from "@/shared/util/homography";
import LogFooterShell from "@/components/LogFooterShell";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";
import { invertHomography } from "@/shared/util/homography";

type ShotRow = { ts: string; cams: Record<string, string> };

export default function Page() {
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [camNames, setCamNames] = useState<string[]>([]);
  const [camA, setCamA] = useState<string>("");
  const [camB, setCamB] = useState<string>("");
  const [ts, setTs] = useState<string>("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  const [imgA, setImgA] = useState<{ rgba: Uint8ClampedArray; width: number; height: number } | null>(null);
  const [imgB, setImgB] = useState<{ rgba: Uint8ClampedArray; width: number; height: number } | null>(null);

  // Homographies and click markers (undist domain)
  const [HAB, setHAB] = useState<number[] | null>(null); // A -> B
  const [HBA, setHBA] = useState<number[] | null>(null); // B -> A
  const [ptA, setPtA] = useState<{ x: number; y: number } | null>(null);
  const [ptB, setPtB] = useState<{ x: number; y: number } | null>(null);

  // Selectable homography list (A->B oriented)
  const [hOptions, setHOptions] = useState<{ path: string; label: string }[]>([]);
  const [hSel, setHSel] = useState<string>("");

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

  // Load checkerboard shots index
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

  // Build synchronized ts list where both cams have frames
  const pairTsList = useMemo(() => {
    if (!camA || !camB) return [] as string[];
    const aSet = new Set(rows.filter((r) => r.cams[camA]).map((r) => r.ts));
    const bSet = new Set(rows.filter((r) => r.cams[camB]).map((r) => r.ts));
    const both = [...aSet].filter((t) => bSet.has(t)).sort();
    return both;
  }, [rows, camA, camB]);

  // Keep ts synchronized to available list
  useEffect(() => {
    if (!pairTsList.length) { setTs(""); return; }
    setTs((prev) => (prev && pairTsList.includes(prev) ? prev : pairTsList[pairTsList.length - 1]));
  }, [pairTsList.join("|")]);

  // Load and undistort source frames for Run on (cam, ts) change
  useEffect(() => {
    (async () => {
      setImgA(null); setImgB(null);
      // Clear transient state on source change
      setHAB(null); setHBA(null); setPtA(null); setPtB(null);
      if (!camA || !camB || !ts) return;
      const row = rows.find((r) => r.ts === ts);
      if (!row) return;
      const pA = row.cams[camA];
      const pB = row.cams[camB];
      if (!pA || !pB) return;
      const fA = await getFile(pA);
      const fB = await getFile(pB);
      if (!fA || !fB) return;
      const srcA = fileToRGBA(fA);
      const srcB = fileToRGBA(fB);
      const undA = await undistWithLatestMap(camA, srcA.rgba, srcA.width, srcA.height);
      const undB = await undistWithLatestMap(camB, srcB.rgba, srcB.width, srcB.height);
      setImgA(undA);
      setImgB(undB);
      // Refresh available homographies for this A/B
      const opts = await refreshHomographyOptions(camA, camB);
      // Try to auto-select saved choice for this pair
      const ns = readNamespacedStore<any>();
      const pairKey = `${sanitize(camA)}|${sanitize(camB)}`;
      const savedPath = ns?.homographyByPair?.[pairKey];
      if (savedPath && (await hasFile(savedPath))) {
        void loadHomographyFromPath(savedPath, camA, camB);
      } else if (opts.length > 0) {
        // default to latest
        const latest = opts[opts.length - 1].path;
        void loadHomographyFromPath(latest, camA, camB);
      }
    })();
  }, [rows, camA, camB, ts]);

  async function undistWithLatestMap(cam: string, rgba: Uint8ClampedArray, w: number, h: number) {
    const files = await listFiles();
    const name = sanitize(cam);
    const candidates = files
      .filter((f) => /^2-calibrate-scenes\//.test(f.path) && new RegExp(`/cam-${name}_remapXY\\.xy$`).test(f.path))
      .map((f) => f.path)
      .sort();
    const latest = candidates[candidates.length - 1];
    if (!latest) return { rgba, width: w, height: h };
    const map = await loadRemapXY(latest);
    if (!map || map.width !== w || map.height !== h) return { rgba, width: w, height: h };
    const out = applyRemapXYBilinear(rgba, w, h, map.xy);
    return { rgba: out, width: w, height: h };
  }

  async function runHomography() {
    if (!camA || !camB || !ts || !imgA || !imgB) return;
    const wrk = workerRef.current;
    if (!wrk) return;
    setBusy(true);
    // Clear previous markers while recomputing
    setPtA(null); setPtB(null);
    setLog("");
    appendLog(`Target: ${camA} × ${camB}, ts=${ts}`);

    // Corner detection on undistorted frames with same postprocess as previews
    const opsA = getPostOpsForCam(camA);
    const opsB = getPostOpsForCam(camB);
    const detA = opsA.length ? applyPostOpsRgbaViaGray(imgA.rgba, imgA.width, imgA.height, opsA) : imgA.rgba;
    const detB = opsB.length ? applyPostOpsRgbaViaGray(imgB.rgba, imgB.width, imgB.height, opsB) : imgB.rgba;
    const resA = await wrk.cvFindChessboardCorners(detA, imgA.width, imgA.height);
    const resB = await wrk.cvFindChessboardCorners(detB, imgB.width, imgB.height);
    if (!resA.found || !resB.found) {
      appendLog("× Corner detection failed on one or both frames (undist).");
      setBusy(false);
      return;
    }

    // Compute H in undist domain.
    // Native calcHomography(camera, galvo) returns H mapping from second arg -> first arg.
    // We want H(A→B), so pass (dest=B, src=A).
    const Hres = await wrk.cvCalcHomography(resB.points, resA.points);
    const H = Array.from(Hres.H); // A -> B
    // Simple metrics: RMSE and inliers below 2px
    const total = (resA.points.length / 2) | 0;
    let sse = 0;
    let inliers = 0;
    for (let i = 0; i < total; i++) {
      const ax = resA.points[i * 2], ay = resA.points[i * 2 + 1];
      const bx = resB.points[i * 2], by = resB.points[i * 2 + 1];
      const p = applyHomography(H, ax, ay);
      const dx = p.x - bx, dy = p.y - by;
      const d2 = dx * dx + dy * dy;
      sse += d2;
      if (d2 <= 4.0) inliers++;
    }
    const rmse = Math.sqrt(sse / Math.max(1, total));

    // Save frames and JSON under 6-cameras-homography
    const runTs = formatTimestamp(new Date());
    const base = `6-cameras-homography/${runTs}`;
    await putFile({ path: `${base}/cam-${sanitize(camA)}_undist.rgb`, type: "rgb-image", data: imgA.rgba.buffer as ArrayBuffer, width: imgA.width, height: imgA.height, channels: 4 });
    await putFile({ path: `${base}/cam-${sanitize(camB)}_undist.rgb`, type: "rgb-image", data: imgB.rgba.buffer as ArrayBuffer, width: imgB.width, height: imgB.height, channels: 4 });
    appendLog(`Saved undist frames: ${base}/cam-${sanitize(camA)}_undist.rgb, cam-${sanitize(camB)}_undist.rgb`);

    const payload = { homography3x3: H, metrics: { rmse, inliers, total, selectedTs: ts } };
    const a2bPath = `${base}/cam-${sanitize(camA)}_to_cam-${sanitize(camB)}_H_undist.json`;
    await putFile({ path: a2bPath, type: "other", data: new TextEncoder().encode(JSON.stringify(payload, null, 2)).buffer as ArrayBuffer });
    // Also save reverse: B -> A (dest=A, src=B)
    const Hrev = await wrk.cvCalcHomography(resA.points, resB.points);
    const HrevArr = Array.from(Hrev.H);
    const payloadRev = { homography3x3: HrevArr, metrics: { rmse /* symmetric approx */, inliers, total, selectedTs: ts } };
    const b2aPath = `${base}/cam-${sanitize(camB)}_to_cam-${sanitize(camA)}_H_undist.json`;
    await putFile({ path: b2aPath, type: "other", data: new TextEncoder().encode(JSON.stringify(payloadRev, null, 2)).buffer as ArrayBuffer });
    appendLog(`Saved H JSONs under ${base}`);
    // Update in‑memory homographies for click mapping
    setHAB(H);
    setHBA(HrevArr);
    appendLog(`Homography ready: A→B and B→A updated (rmse=${rmse.toFixed(3)}px, inliers=${inliers}/${total}).`);
    // Refresh dropdown and auto-select the newly saved one
    await refreshHomographyOptions(camA, camB);
    setHSel(a2bPath);
    persistHomographySelection(camA, camB, a2bPath);
    setBusy(false);
  }

  const canRun = !!(camA && camB && ts && imgA && imgB) && !busy;

  function inBounds(x: number, y: number, w: number, h: number) {
    return isFinite(x) && isFinite(y) && x >= 0 && y >= 0 && x < w && y < h;
  }

  function onClickA(x: number, y: number) {
    if (!HAB || !imgB) { appendLog("Homography not ready. Run first."); return; }
    setPtA({ x, y });
    const p = applyHomography(HAB, x, y);
    if (inBounds(p.x, p.y, imgB.width, imgB.height)) {
      setPtB({ x: p.x, y: p.y });
      appendLog(`A(${x.toFixed(1)}, ${y.toFixed(1)}) → B(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    } else {
      setPtB(null);
      appendLog("Mapped point out of bounds for B; not plotted.");
    }
  }

  function onClickB(x: number, y: number) {
    if (!HBA || !imgA) { appendLog("Homography not ready. Run first."); return; }
    setPtB({ x, y });
    const p = applyHomography(HBA, x, y);
    if (inBounds(p.x, p.y, imgA.width, imgA.height)) {
      setPtA({ x: p.x, y: p.y });
      appendLog(`B(${x.toFixed(1)}, ${y.toFixed(1)}) → A(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
    } else {
      setPtA(null);
      appendLog("Mapped point out of bounds for A; not plotted.");
    }
  }

  async function hasFile(path: string) {
    try {
      const fe = await getFile(path);
      return !!fe;
    } catch {
      return false;
    }
  }

  async function refreshHomographyOptions(a: string, b: string) {
    const files = await listFiles();
    const sa = sanitize(a), sb = sanitize(b);
    const re6 = new RegExp(`^6-cameras-homography/[^/]+/cam-${sa}_to_cam-${sb}_H_undist\\.json$`);
    const re2 = new RegExp(`^2-calibrate-scenes/[^/]+/cam-${sa}_to_cam-${sb}_H_undist\\.json$`);
    const paths = files.map((f) => f.path).filter((p) => re6.test(p) || re2.test(p)).sort();
    const opts = await Promise.all(paths.map(async (p) => {
      let label = p;
      try {
        const fe = await getFile(p);
        if (fe) {
          const txt = new TextDecoder().decode(fe.data);
          const js = JSON.parse(txt || "{}");
          const mts = js?.metrics || {};
          const rmse = typeof mts.rmse === "number" ? mts.rmse.toFixed(3) : "-";
          const inl = typeof mts.inliers === "number" && typeof mts.total === "number" ? `${mts.inliers}/${mts.total}` : "-";
          const tsSel = mts.selectedTs || "";
          const folder = p.split("/")[0];
          const runTs = p.split("/")[1] || "";
          label = `${folder} ${runTs} — rmse=${rmse}, inliers=${inl}${tsSel ? `, ts=${tsSel}` : ""}`;
        }
      } catch {}
      return { path: p, label };
    }));
    setHOptions(opts);
    // Keep selection valid if it exists, else clear/default handled by caller
    setHSel((prev) => (prev && opts.some((o) => o.path === prev) ? prev : prev));
    return opts;
  }

  async function loadHomographyFromPath(path: string, a: string, b: string) {
    try {
      const fe = await getFile(path);
      if (!fe) return;
      const js = JSON.parse(new TextDecoder().decode(fe.data) || "{}");
      const H = (js?.homography3x3 || js?.H || []) as number[];
      if (!H || H.length !== 9) return;
      // Try to find reverse H in same folder
      const folder = path.split("/").slice(0, -1).join("/");
      const revPath = `${folder}/cam-${sanitize(b)}_to_cam-${sanitize(a)}_H_undist.json`;
      let Hrev: number[] | null = null;
      const rev = await getFile(revPath);
      if (rev) {
        try {
          const jsr = JSON.parse(new TextDecoder().decode(rev.data) || "{}");
          const Hr = jsr?.homography3x3 || jsr?.H;
          if (Hr && Hr.length === 9) Hrev = Array.from(Hr);
        } catch {}
      }
      if (!Hrev) {
        // fall back to inverse
        const inv = invertHomography(H);
        Hrev = Array.from(inv);
      }
      setHAB(Array.from(H));
      setHBA(Hrev);
      setHSel(path);
      persistHomographySelection(a, b, path);
      setPtA(null); setPtB(null);
      appendLog(`Loaded homography from ${path}${rev ? " (+ reverse)" : " (reverse=inverted)"}.`);
    } catch (e: any) {
      appendLog(`! Failed to load homography: ${String(e)}`);
    }
  }

  function persistHomographySelection(a: string, b: string, path: string) {
    const pairKey = `${sanitize(a)}|${sanitize(b)}`;
    const ns = readNamespacedStore<any>();
    const map = { ...(ns?.homographyByPair || {}) };
    map[pairKey] = path;
    updateNamespacedStore({ homographyByPair: map });
  }

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>6. Cameras Homography</b>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <label className="row" style={{ gap: 6 }}>
              Camera A
              <select value={camA} onChange={(e) => setCamA(e.target.value)}>
                {camNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
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
            <button onClick={runHomography} disabled={!canRun}>Run</button>
          </div>
        </div>
      </header>
      <LogFooterShell log={log} title="Log">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <h4>Pre‑Detect Preview (undistorted)</h4>
              <label className="row" style={{ gap: 6, alignItems: "center" }}>
                Homography
                <select
                  value={hSel}
                  onChange={(e) => {
                    const p = e.target.value;
                    setHSel(p);
                    if (p) void loadHomographyFromPath(p, camA, camB);
                    else { setHAB(null); setHBA(null); setPtA(null); setPtB(null); }
                  }}
                  disabled={hOptions.length === 0}
                  style={{ minWidth: 360 }}
                >
                  {hOptions.map((o) => (
                    <option key={o.path} value={o.path}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              {camA && (
                <CheckerboardEnhancePreview
                  camName={camA}
                  rows={rows}
                  selectedTs={new Set(ts ? [ts] : [])}
                  worker={workerRef.current}
                  undistort={true}
                  tsValue={ts}
                  onTsChange={setTs}
                  tsOptions={pairTsList}
                  onClickOriginal={onClickA}
                  marker={ptA ? { x: ptA.x, y: ptA.y, color: "#00ffff", cross: true } : null}
                />
              )}
              {camB && (
                <CheckerboardEnhancePreview
                  camName={camB}
                  rows={rows}
                  selectedTs={new Set(ts ? [ts] : [])}
                  worker={workerRef.current}
                  undistort={true}
                  tsValue={ts}
                  onTsChange={setTs}
                  tsOptions={pairTsList}
                  onClickOriginal={onClickB}
                  marker={ptB ? { x: ptB.x, y: ptB.y, color: "#ff00ff", cross: true } : null}
                />
              )}
            </div>
            {!pairTsList.length && <div style={{ opacity: 0.75 }}>No common timestamps for selected cameras.</div>}
          </section>
        </div>
      </LogFooterShell>
    </>
  );
}

// (no local preview helpers; reuses shared CheckerboardEnhancePreview)
