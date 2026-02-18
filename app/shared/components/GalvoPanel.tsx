"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SerialCommunicator } from "@/shared/hardware/serial";

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 65535; // XY2-100 typical 16-bit range

export default function GalvoPanel() {
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [armed, setArmed] = useState(false);
  const [min, setMin] = useState(DEFAULT_MIN);
  const [max, setMax] = useState(DEFAULT_MAX);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [intervalMs, setIntervalMs] = useState(50);
  const [queue, setQueue] = useState<[number, number][]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function clamp(v: number) { return Math.max(min, Math.min(max, Math.floor(v))); }

  async function sendXY() {
    if (!serial || !armed) return;
    await serial.setGalvoPos(clamp(x), clamp(y));
  }

  function startSchedule() {
    if (!serial || !armed || queue.length === 0) return;
    let i = 0;
    timer.current = window.setInterval(async () => {
      const [qx, qy] = queue[i % queue.length];
      await serial.setGalvoPos(clamp(qx), clamp(qy));
      i++;
    }, Math.max(10, intervalMs));
  }
  function stopSchedule() { if (timer.current) { clearInterval(timer.current); timer.current = null; } }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <button onClick={async () => { const s = new SerialCommunicator(); if (await s.connect()) setSerial(s); }}>ポート選択</button>
        <button onClick={() => serial?.disconnect()} disabled={!serial}>切断</button>
      </div>
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
        動作に同意（安全に注意）
      </label>
      <div className="row">
        <label>範囲</label>
        <input type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} style={{ width: 84 }} />
        <span>〜</span>
        <input type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} style={{ width: 84 }} />
      </div>
      <div className="row">
        <label>X</label>
        <input type="number" value={x} onChange={(e) => setX(Number(e.target.value))} style={{ width: 120 }} />
        <label>Y</label>
        <input type="number" value={y} onChange={(e) => setY(Number(e.target.value))} style={{ width: 120 }} />
        <button disabled={!serial || !armed} onClick={sendXY}>座標送信</button>
      </div>
      <div className="col">
        <label>スケジューラ</label>
        <div className="row">
          <input type="text" placeholder="例: 100,100 200,100 200,200 100,200" onBlur={(e) => {
            const pts: [number, number][] = e.target.value.split(/\s+/).filter(Boolean).map(p => p.split(",")).map(([sx, sy]) => [Number(sx), Number(sy)] as [number, number]);
            setQueue(pts);
          }} style={{ flex: 1 }} />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <label>間隔(ms)</label>
          <input type="number" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))} style={{ width: 100 }} />
          <button disabled={!serial || !armed || queue.length === 0} onClick={startSchedule}>開始</button>
          <button onClick={stopSchedule}>停止</button>
        </div>
      </div>
    </div>
  );
}
