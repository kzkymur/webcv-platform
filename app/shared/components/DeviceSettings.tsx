"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentNamespace, updateNamespacedStore, readNamespacedStore } from "@/shared/module/loaclStorage";
import { SerialCommunicator } from "@/shared/hardware/serial";

type MediaDeviceInfoLite = Pick<MediaDeviceInfo, "deviceId" | "label" | "kind">;

export default function DeviceSettings() {
  // Ensure SSR and first client render match to avoid hydration warnings
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);

  const [devices, setDevices] = useState<MediaDeviceInfoLite[]>([]);
  const [webCamId, setWebCamId] = useState<string | null>(null);
  const [thermalCamId, setThermalCamId] = useState<string | null>(null);
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [laserPct, setLaserPct] = useState(0);
  const [armed, setArmed] = useState(false);

  // Initialize selects from namespaced store so UI reflects current state
  useEffect(() => {
    const st = readNamespacedStore<{ webCamId?: string; thermalCamId?: string }>();
    setWebCamId(st.webCamId ?? null);
    setThermalCamId(st.thermalCamId ?? null);
  }, []);

  // Helper to (re)enumerate cameras
  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices();
      const vids = (list || []).filter((d) => d.kind === "videoinput");
      setDevices(vids);
    } catch {}
  }

  // Initial load + devicechange listener
  useEffect(() => {
    refreshDevices();
    const handler = () => refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", handler);
  }, []);

  useEffect(() => {
    const ns = getCurrentNamespace();
    updateNamespacedStore({ webCamId, thermalCamId }, ns);
  }, [webCamId, thermalCamId]);

  // Compute feature support only after mount so SSR markup matches
  const serialSupported = isClient && typeof navigator !== "undefined" && !!(navigator as any).serial;
  const needsCameraPermission = devices.length === 0 || devices.every((d) => !d.deviceId);

  async function requestCameraAccess() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      // Immediately stop; we only need permission + device labels/ids
      s.getTracks().forEach((t) => t.stop());
    } catch {
      // User may have denied; just return
    }
    await refreshDevices();
  }

  return (
    <div className="col">
      <div className="col">
        <label>Web カメラ</label>
        <select value={webCamId || ""} onChange={(e) => setWebCamId(e.target.value || null)} disabled={needsCameraPermission}>
          <option value="">未選択</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
        {needsCameraPermission && (
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={requestCameraAccess}>カメラへのアクセスを許可</button>
            <span style={{ fontSize: 12, opacity: 0.8 }}>許可後に一覧が表示されます</span>
          </div>
        )}
      </div>
      <div className="col">
        <label>サーモグラフィカメラ</label>
        <select value={thermalCamId || ""} onChange={(e) => setThermalCamId(e.target.value || null)} disabled={needsCameraPermission}>
          <option value="">未選択</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
      </div>

      <div className="col" style={{ marginTop: 8 }}>
        <label>マイコン (Web Serial)</label>
        {serialSupported ? (
          <div className="row">
            <button
              onClick={async () => {
                const s = new SerialCommunicator();
                const ok = await s.connect();
                if (ok) setSerial(s);
              }}
            >
              ポートを選択
            </button>
            <button onClick={() => serial?.disconnect()} disabled={!serial}>
              切断
            </button>
          </div>
        ) : (
          <div>ブラウザが Web Serial を未対応です (Chrome 推奨)</div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <label>レーザー出力 (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={laserPct}
            onChange={(e) => setLaserPct(Math.max(0, Math.min(100, Number(e.target.value))))}
            style={{ width: 72 }}
          />
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
            動作に同意 (安全に注意)
          </label>
          <button
            disabled={!serial || !armed}
            onClick={() => serial?.setLaserOutput(laserPct)}
            title="Teensy firmware: Mode A sets PWM/DAC (0–100)"
          >
            出力を送信
          </button>
        </div>
      </div>
    </div>
  );
}
