"use client";

export const dynamic = "error";

import Sidebar from "@/components/Sidebar";
import { useEffect, useMemo, useState } from "react";
import { listFiles } from "@/shared/db";

type Pair = {
  ts: string; // capture timestamp (from 1-syncro)
  A: string; // camera A name
  B: string; // camera B name
  runTs: string; // calibration batch ts (from 2-calibrate)
  mapXPath: string;
  mapYPath: string;
};

export default function Page() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [sel, setSel] = useState<number>(-1);

  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const maps = files.filter((f) => f.path.startsWith("2-calibrate-scenes/") && /_mapping[XY]$/.test(f.path));
      const grouped = new Map<string, { x?: string; y?: string; runTs: string; A: string; B: string; ts: string }>();
      for (const f of maps) {
        // 2-calibrate-scenes/<runTs>_cam-<A>_to_cam-<B>_<ts>_mappingX|Y
        const m = f.path.match(/^2-calibrate-scenes\/(.+?)_cam-(.+?)_to_cam-(.+?)_(.+?)_mapping([XY])$/);
        if (!m) continue;
        const key = `${m[1]}|${m[2]}|${m[3]}|${m[4]}`;
        const g = grouped.get(key) || { runTs: m[1], A: m[2], B: m[3], ts: m[4] } as any;
        if (m[5] === "X") g.x = f.path; else g.y = f.path;
        grouped.set(key, g);
      }
      const out: Pair[] = [];
      for (const g of grouped.values()) {
        if (!g.x || !g.y) continue;
        out.push({ ts: g.ts, A: g.A, B: g.B, runTs: g.runTs, mapXPath: g.x, mapYPath: g.y });
      }
      out.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      setPairs(out);
      setSel(out.length > 0 ? 0 : -1);
    })();
  }, []);

  const selected = sel >= 0 ? pairs[sel] : null;

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>3. Remap Realtime (Preview)</b>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>Detected Mappings (undistorted domain)</h4>
            <div className="tree" style={{ maxHeight: 220, overflow: "auto" }}>
              {pairs.map((p, i) => (
                <div key={`${p.runTs}|${p.A}|${p.B}|${p.ts}`} className={`file ${i === sel ? "active" : ""}`} style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={() => setSel(i)}>
                  <span style={{ width: 220, fontFamily: "monospace" }}>{p.runTs}</span>
                  <span>{p.A} → {p.B}</span>
                  <span style={{ opacity: 0.7 }}>(ts: {p.ts})</span>
                </div>
              ))}
              {pairs.length === 0 && <div style={{ opacity: 0.7 }}>No mappings found. Generate them in /2.</div>}
            </div>
            {selected && (
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                X: {selected.mapXPath}<br />
                Y: {selected.mapYPath}
              </div>
            )}
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h4>About the Preview</h4>
            <div style={{ opacity: 0.8, fontSize: 13 }}>
              This page is a preview stub. Alongside undistortion fields (`cam-*_remapX/Y`), real‑time WebGL application is being integrated next.
              For now, inspect logs and files from /2 and select a target here.
            </div>
          </section>
          {/* No file preview on this page (Home only) */}
        </div>
      </main>
    </>
  );
}
// No file preview panel here; Home only.
