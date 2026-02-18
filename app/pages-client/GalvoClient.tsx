"use client";

import DeviceSettings from "@/shared/components/DeviceSettings";
import GalvoPanel from "@/shared/components/GalvoPanel";

export default function GalvoClient() {
  return (
    <>
      <aside className="sidebar">
        <div className="panel"><DeviceSettings /></div>
        <div className="panel"><GalvoPanel /></div>
      </aside>
      <header className="header"><b>Galvo</b></header>
      <main className="main">
        <div className="panel">安全に注意し、低出力で検証してください。</div>
      </main>
    </>
  );
}
