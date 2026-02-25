"use client";

import Link from "next/link";
import FileSystemBrowser from "@/shared/components/FileSystemBrowser";
import type { FileEntry } from "@/shared/db/types";
import { SidebarResizer } from "@/components/SidebarResizer";

export default function Sidebar({ onSelectFile }: { onSelectFile?: (f: FileEntry | null) => void }) {
  return (
    <aside className="sidebar">
      <SidebarResizer
        side="right"
        cssVar="--sidebar-left-width"
        storeKey="sidebarLeftWidth"
      />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Link href="/" style={{ fontWeight: 700, letterSpacing: 0.2, fontSize: 20 }}>webcv-platform</Link>
      </div>
      <div className="panel">
        <h3>File System</h3>
        <FileSystemBrowser onSelect={onSelectFile || (() => {})} />
      </div>
    </aside>
  );
}
