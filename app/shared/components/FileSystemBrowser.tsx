"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { deleteFile, getFile, listFiles } from "@/shared/db";
import { FileEntry } from "@/shared/db/types";
import { buildTree, TreeNode } from "@/shared/util/tree";

export default function FileSystemBrowser({
  onSelect,
}: {
  onSelect: (f: FileEntry | null) => void;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null); // last clicked file path (for shift)
  // viewer only; no import UI
  const [q, setQ] = useState("");
  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
  const flat = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = files
      .slice()
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return term ? list.filter((f) => f.path.toLowerCase().includes(term)) : list;
  }, [files, q]);

  // Group filtered files by parent directory for range selection
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of flat) {
      const dir = parentDir(f.path);
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(f.path);
    }
    // ensure stable sort
    for (const [k, arr] of map) arr.sort();
    return map;
  }, [flat]);

  // Tree open/close state
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Initialize default-open top-level folders when tree changes
  useEffect(() => {
    if (open.size === 0 && tree.length > 0) {
      const s = new Set<string>();
      for (const n of tree) if (n.isDir) s.add(n.path);
      setOpen(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // When filtering, force-open matched ancestors so results are visible
  const forcedOpen = useMemo(() => {
    if (!q) return new Set<string>();
    const s = new Set<string>();
    for (const f of flat) {
      const parts = f.path.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join("/"));
    }
    return s;
  }, [flat, q]);

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
      {/* viewer only */}
      <div className="row" style={{ gap: 8 }}>
        <input
          type="text"
          placeholder="フィルタ (パスに含まれる文字)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button
          onClick={() => {
            const s = new Set<string>();
            function walk(ns: TreeNode[]) {
              for (const n of ns) {
                if (n.isDir) s.add(n.path);
                if (n.children) walk(n.children);
              }
            }
            walk(tree);
            setOpen(s);
          }}
        >
          全展開
        </button>
        <button onClick={() => setOpen(new Set())}>全折りたたみ</button>
        <button onClick={refresh}>再読込</button>
      </div>
      <DirTree
        nodes={tree}
        open={open}
        forcedOpen={forcedOpen}
        onToggle={(p) => {
          const next = new Set(open);
          if (next.has(p)) next.delete(p);
          else next.add(p);
          setOpen(next);
        }}
        activePath={active}
        selected={selected}
        onFileClick={(path, shiftKey, metaKey, ctrlKey) => {
          // Additive toggle with Cmd/Ctrl
          if (metaKey || ctrlKey) {
            const s = new Set(selected);
            if (s.has(path)) s.delete(path); else s.add(path);
            setSelected(s);
            setActive(path);
            setAnchor(path);
            return;
          }

          // Range select with Shift
          if (shiftKey && anchor) {
            const dir = parentDir(path);
            const anchorDir = parentDir(anchor);
            const list = groups.get(dir) || [];
            const aIdx = anchorDir === dir ? list.indexOf(anchor) : -1;
            const bIdx = list.indexOf(path);
            if (aIdx >= 0 && bIdx >= 0) {
              const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
              const s = new Set<string>(list.slice(lo, hi + 1));
              setSelected(s);
              setActive(path);
              return;
            }
          }

          // Default: single select
          const s = new Set<string>([path]);
          setSelected(s);
          setActive(path);
          setAnchor(path);
        }}
        onSelect={setActive}
        filter={q}
      />
      <div className="row">
        <button
          disabled={selected.size === 0 && !active}
          onClick={async () => {
            const paths = selected.size > 0 ? Array.from(selected) : active ? [active] : [];
            const results = await Promise.allSettled(paths.map((p) => deleteFile(p)));
            const failed = results.filter((r) => r.status === "rejected").length;
            setSelected(new Set());
            setActive(null);
            setAnchor(null);
            await refresh();
            if (failed > 0) {
              // eslint-disable-next-line no-alert
              alert(`${failed} 件の削除に失敗しました`);
            }
          }}
          title={selected.size > 1 ? `${selected.size} 件を削除` : undefined}
        >
          削除{selected.size > 1 ? ` (${selected.size})` : ""}
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

function DirTree({
  nodes,
  open,
  forcedOpen,
  onToggle,
  activePath,
  selected,
  onFileClick,
  onSelect,
  filter,
}: {
  nodes: TreeNode[];
  open: Set<string>;
  forcedOpen: Set<string>;
  onToggle: (p: string) => void;
  activePath: string | null;
  selected: Set<string>;
  onFileClick: (p: string, shiftKey: boolean, metaKey: boolean, ctrlKey: boolean) => void;
  onSelect: (p: string) => void;
  filter: string;
}) {
  type Row = { node: TreeNode; depth: number };

  const rows: Row[] = [];

  const match = (path: string) => !filter || path.toLowerCase().includes(filter.toLowerCase());

  function includeNode(n: TreeNode): boolean {
    if (!filter) return true;
    if (!n.isDir) return match(n.path);
    // For dirs: include if any descendant matches
    return (n.children || []).some(includeNode);
  }

  function walk(ns: TreeNode[], depth: number) {
    for (const n of ns) {
      if (!includeNode(n)) continue;
      rows.push({ node: n, depth });
      const isOpen = open.has(n.path) || forcedOpen.has(n.path);
      if (n.isDir && isOpen) walk(n.children || [], depth + 1);
    }
  }
  walk(nodes, 0);

  return (
    <div className="tree" style={{ maxHeight: 280, overflow: "auto" }}>
      {rows.map(({ node, depth }) => {
        if (node.isDir) {
          const isOpen = open.has(node.path) || forcedOpen.has(node.path);
          return (
            <div
              key={node.path}
              className="file"
              style={{ display: "flex", alignItems: "center", paddingLeft: depth * 14 }}
            >
              <span
                style={{ width: 16, cursor: forcedOpen.has(node.path) ? "default" : "pointer" }}
                onClick={() => !forcedOpen.has(node.path) && onToggle(node.path)}
              >
                {isOpen ? "▾" : "▸"}
              </span>
              <span style={{ opacity: 0.85, marginRight: 6 }}>📁</span>
              <span
                style={{ cursor: forcedOpen.has(node.path) ? "default" : "pointer" }}
                onClick={() => !forcedOpen.has(node.path) && onToggle(node.path)}
              >
                {node.name}
              </span>
            </div>
          );
        }
        return (
          <div
            key={node.path}
            className={`file ${selected.has(node.path) ? "selected" : ""} ${activePath === node.path ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", paddingLeft: depth * 14 + 22, cursor: "pointer" }}
            onClick={(e) => onFileClick(node.path, (e as React.MouseEvent).shiftKey, (e as React.MouseEvent).metaKey, (e as React.MouseEvent).ctrlKey)}
            title={node.path}
          >
            <span style={{ opacity: 0.85, marginRight: 6 }}>📄</span>
            {node.name}
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ opacity: 0.7 }}>一致する項目がありません</div>}
    </div>
  );
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.substring(0, i);
}

// no import panel (viewer only)
