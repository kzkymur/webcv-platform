"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteFile, getFile, listFiles, putFile } from "@/shared/db";
import { FileEntry, FileType } from "@/shared/db/types";
import { buildTree, TreeNode } from "@/shared/util/tree";

export default function FileSystemBrowser({
  onSelect,
}: {
  onSelect: (f: FileEntry | null) => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files]);

  const refresh = async () => setFiles(await listFiles());
  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!active) return onSelect(null);
    getFile(active).then((f) => onSelect(f || null));
  }, [active]);

  return (
    <div className="col" style={{ gap: 10 }}>
      <ImportPanel
        busy={importing}
        onImport={async (entry) => {
          setImporting(true);
          try {
            await putFile(entry);
            await refresh();
            setActive(entry.path);
          } finally {
            setImporting(false);
          }
        }}
      />
      <div className="tree">
        {tree.map((n) => (
          <Tree key={n.path} node={n} activePath={active} onSelect={setActive} />
        ))}
      </div>
      <div className="row">
        <button
          disabled={!active}
          onClick={async () => {
            if (!active) return;
            await deleteFile(active);
            setActive(null);
            refresh();
          }}
        >
          削除
        </button>
      </div>
    </div>
  );
}

function Tree({
  node,
  activePath,
  onSelect,
}: {
  node: TreeNode;
  activePath: string | null;
  onSelect: (p: string) => void;
}) {
  if (!node.isDir) {
    return (
      <div
        className={`file ${activePath === node.path ? "active" : ""}`}
        onClick={() => onSelect(node.path)}
      >
        {node.name}
      </div>
    );
  }
  return (
    <details open>
      <summary>{node.name}</summary>
      <div style={{ paddingLeft: 10 }}>
        {node.children?.map((c) => (
          <Tree key={c.path} node={c} activePath={activePath} onSelect={onSelect} />
        ))}
      </div>
    </details>
  );
}

function ImportPanel({
  busy,
  onImport,
}: {
  busy: boolean;
  onImport: (entry: FileEntry) => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [grayscale, setGrayscale] = useState(false);

  async function importImage(f: File, p: string): Promise<FileEntry> {
    const bmp = await decodeImage(f);
    const kind: FileType = grayscale ? "grayscale-image" : "rgb-image";
    const rgba = grayscale ? toGrayscale(bmp.data) : bmp.data;
    return { path: p, type: kind, data: rgba.buffer, width: bmp.width, height: bmp.height, channels: 4 };
  }

  return (
    <div className="col">
      <div className="row">
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <input
          type="text"
          placeholder="パス (例: images/cam/frame1)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
        />
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
          Grayscale
        </label>
        <button
          disabled={!file || !path || busy}
          onClick={async () => {
            if (!file || !path) return;
            const entry = await importImage(file, path);
            await onImport(entry);
            setFile(null);
            setPath("");
          }}
        >
          取り込み
        </button>
      </div>
    </div>
  );
}

async function decodeImage(file: File): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toGrayscale(rgba: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}
