"use client";

import Link from "next/link";
import DeviceSettings from "@/shared/components/DeviceSettings";
import FileSystemBrowser from "@/shared/components/FileSystemBrowser";
import type { FileEntry } from "@/shared/db/types";

export default function Sidebar({ onSelectFile }: { onSelectFile?: (f: FileEntry | null) => void }) {
  return (
    <aside className="sidebar">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Link href="/" style={{ fontWeight: 700, letterSpacing: 0.2, fontSize: 20 }}>webcv-platform</Link>
      </div>
      <div className="panel">
        <h3>Device Settings</h3>
        <DeviceSettings />
      </div>
      <div className="panel">
        <h3>File System</h3>
        <FileSystemBrowser onSelect={onSelectFile || (() => {})} />
      </div>
    </aside>
  );
}
