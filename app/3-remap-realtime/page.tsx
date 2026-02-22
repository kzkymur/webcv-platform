"use client";

export const dynamic = "error";

import Sidebar from "@/components/Sidebar";
import { useEffect, useMemo, useState } from "react";
import { listFiles } from "@/shared/db";
import RemapPreview from "@/shared/components/RemapPreview";

type InterItem = {
  kind: "inter";
  ts: string; // capture timestamp (from 1-syncro) or "canonical"
  A: string; // camera A name (dest grid)
  B: string; // camera B name (source)
  runTs: string; // calibration batch ts (from 2-calibrate)
  mapXYPath: string;
};

type UndistItem = {
  kind: "undist";
  runTs: string;
  cam: string; // single camera undistortion map
  mapXYPath: string;
};

type XYItem = InterItem | UndistItem;

export default function Page() {
  const [items, setItems] = useState<XYItem[]>([]);
  const [sel, setSel] = useState<number>(-1);

  useEffect(() => {
    (async () => {
      const files = await listFiles();
      const xy = files.filter((f) => f.path.startsWith("2-calibrate-scenes/") && /\.xy$/.test(f.path));
      const out: XYItem[] = [];
      for (const f of xy) {
        // Inter-camera mapping (with per-frame ts)
        let m = f.path.match(/^2-calibrate-scenes\/(.+?)_cam-(.+?)_to_cam-(.+?)_(.+?)_mappingXY\.xy$/);
        if (m) {
          out.push({ kind: "inter", ts: m[4], A: m[2], B: m[3], runTs: m[1], mapXYPath: f.path });
          continue;
        }
        // Inter-camera mapping (canonical, no <ts>)
        m = f.path.match(/^2-calibrate-scenes\/(.+?)_cam-(.+?)_to_cam-(.+?)_mappingXY\.xy$/);
        if (m) {
          out.push({ kind: "inter", ts: "canonical", A: m[2], B: m[3], runTs: m[1], mapXYPath: f.path });
          continue;
        }
        // Per-camera undistortion map
        m = f.path.match(/^2-calibrate-scenes\/(.+?)_cam-(.+?)_remapXY\.xy$/);
        if (m) {
          out.push({ kind: "undist", runTs: m[1], cam: m[2], mapXYPath: f.path });
          continue;
        }
      }
      out.sort((a, b) => (a.runTs < b.runTs ? 1 : -1));
      setItems(out);
      setSel(out.length > 0 ? 0 : -1);
    })();
  }, []);

  const selected = sel >= 0 ? items[sel] : null;

  return (
    <>
      <Sidebar />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>3. Remap Realtime</b>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>Detected XY Maps</h4>
            <div className="tree" style={{ maxHeight: 220, overflow: "auto" }}>
              {items.map((p, i) => (
                <div
                  key={p.kind === "inter" ? `${p.runTs}|${p.A}|${p.B}|${p.ts}` : `${p.runTs}|${p.cam}`}
                  className={`file ${i === sel ? "active" : ""}`}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                  onClick={() => setSel(i)}
                >
                  <span style={{ width: 220, fontFamily: "monospace" }}>{p.runTs}</span>
                  {p.kind === "inter" ? (
                    <>
                      <span>{p.A} → {p.B}</span>
                      <span style={{ opacity: 0.7 }}>(ts: {p.ts})</span>
                    </>
                  ) : (
                    <span>Undistort: {p.cam}</span>
                  )}
                </div>
              ))}
              {items.length === 0 && <div style={{ opacity: 0.7 }}>No XY maps found. Generate them in /2.</div>}
            </div>
            {selected && (
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                XY: {selected.mapXYPath}
              </div>
            )}
          </section>

          <section className="col" style={{ gap: 8 }}>
            <h4>Realtime Preview (WebGL)</h4>
            {!selected && <div style={{ opacity: 0.8 }}>Select an XY map above to preview.</div>}
            {selected && (
              <RemapPreview
                sel={selected.kind === "inter"
                  ? { kind: "inter", runTs: selected.runTs, camA: selected.A, camB: selected.B, mapXYPath: selected.mapXYPath }
                  : { kind: "undist", runTs: selected.runTs, cam: selected.cam, mapXYPath: selected.mapXYPath }
                }
              />
            )}
          </section>

          {/* No file preview on this page (Home only) */}
        </div>
      </main>
    </>
  );
}
// No file preview panel here; Home only.
