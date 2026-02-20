"use client";

export const dynamic = "error";

import DeviceSettings from "@/shared/components/DeviceSettings";
import FileSystemBrowser from "@/shared/components/FileSystemBrowser";
import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@/shared/db/types";
import { listFiles, getFile } from "@/shared/db";

type Pair = {
  ts: string; // capture timestamp (from 1-syncro)
  A: string; // camera A name
  B: string; // camera B name
  runTs: string; // calibration batch ts (from 2-calibrate)
  mapXPath: string;
  mapYPath: string;
};

export default function Page() {
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
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
          <b>3. リアルタイム Remap (プレビュー導線)</b>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 8 }}>
            <h4>検出されたマッピング（undist domain）</h4>
            <div className="tree" style={{ maxHeight: 220, overflow: "auto" }}>
              {pairs.map((p, i) => (
                <div key={`${p.runTs}|${p.A}|${p.B}|${p.ts}`} className={`file ${i === sel ? "active" : ""}`} style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={() => setSel(i)}>
                  <span style={{ width: 220, fontFamily: "monospace" }}>{p.runTs}</span>
                  <span>{p.A} → {p.B}</span>
                  <span style={{ opacity: 0.7 }}>(ts: {p.ts})</span>
                </div>
              ))}
              {pairs.length === 0 && <div style={{ opacity: 0.7 }}>マッピングが見つかりません。/2 で生成してください。</div>}
            </div>
            {selected && (
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                X: {selected.mapXPath}<br />
                Y: {selected.mapYPath}
              </div>
            )}
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h4>プレビューについて</h4>
            <div style={{ opacity: 0.8, fontSize: 13 }}>
              このページは導線のみ先行実装です。undist用の `cam-*_remapX/Y` と合わせて、WebGLでのリアルタイム適用を次段で実装します。
              当面は /2 のログとファイルを確認してから、ここで対象を選んでください。
            </div>
          </section>
          {activeFile && (
            <section>
              <h4>選択中のファイル: {activeFile.path}</h4>
              <BinaryPreview file={activeFile} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

function BinaryPreview({ file }: { file: FileEntry }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    (async () => {
      if (!file) return setText("");
      if (file.type === "remap") {
        setText(`Float32[${file.width}x${file.height}] len=${(file.data.byteLength/4)|0}`);
      } else if (file.type === "other") {
        try {
          const s = new TextDecoder().decode(new Uint8Array(file.data));
          setText(s.slice(0, 2000));
        } catch {
          setText(`binary len=${file.data.byteLength}`);
        }
      } else {
        setText(`type=${file.type} (画像は左のViewerで)`);
      }
    })();
  }, [file]);
  return <pre className="tree" style={{ padding: 8, background: "#111", maxHeight: 240, overflow: "auto" }}>{text}</pre>;
}

