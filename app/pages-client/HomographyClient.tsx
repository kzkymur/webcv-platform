"use client";

import DeviceSettings from "@/shared/components/DeviceSettings";

export default function HomographyClient() {
  return (
    <>
      <aside className="sidebar">
        <div className="panel"><DeviceSettings /></div>
      </aside>
      <header className="header"><b>Homography</b></header>
      <main className="main">
        <div className="panel">今後ここにHomography計算UIを実装（WASMワーカー経由）</div>
      </main>
    </>
  );
}
