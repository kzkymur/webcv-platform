"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getCurrentNamespace, updateNamespacedStore, readNamespacedStore } from "@/shared/module/loaclStorage";
import { SerialCommunicator } from "@/shared/hardware/serial";

type MediaDeviceInfoLite = Pick<MediaDeviceInfo, "deviceId" | "label" | "kind">;

function DeviceSettingsInner() {
  const [devices, setDevices] = useState<MediaDeviceInfoLite[]>([]);
  const [cameraIds, setCameraIds] = useState<string[]>(() => {
    const st = readNamespacedStore<{ cameraIds?: string[]; webCamId?: string | null; thermalCamId?: string | null }>();
    if (st.cameraIds && Array.isArray(st.cameraIds)) return st.cameraIds;
    const legacy = [st.webCamId, st.thermalCamId].filter((v): v is string => !!v);
    if (legacy.length > 0) updateNamespacedStore({ cameraIds: legacy });
    return legacy;
  });
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [laserPct, setLaserPct] = useState(0);
  const [armed, setArmed] = useState(false);
  const [cameraOpts, setCameraOpts] = useState<Record<string, { y16?: boolean }>>(() => {
    const st = readNamespacedStore<{ cameraOptions?: Record<string, { y16?: boolean }> }>();
    return st.cameraOptions || {};
  });
  const didInit = useRef(false);

  // Helper to (re)enumerate cameras
  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices();
      const vids = (list || []).filter((d) => d.kind === "videoinput");
      setDevices(vids);
    } catch {}
  }

  // Single consolidated effect for init + persistence
  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true;
      refreshDevices();
      const handler = () => refreshDevices();
      navigator.mediaDevices?.addEventListener("devicechange", handler);
      return () => navigator.mediaDevices?.removeEventListener("devicechange", handler);
    }
    const ns = getCurrentNamespace();
    updateNamespacedStore({ cameraIds }, ns);
    updateNamespacedStore({ cameraOptions: cameraOpts }, ns);
  }, [cameraIds, cameraOpts]);

  // Compute feature support only after mount so SSR markup matches
  const serialSupported = typeof navigator !== "undefined" && !!(navigator as any).serial;
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
        <label>Web Cameras (multi-select)</label>
        {cameraIds.map((id, idx) => (
          <div className="row" key={idx} style={{ gap: 8, marginBottom: 6 }}>
            <span style={{ width: 24, textAlign: "right" }}>#{idx + 1}</span>
            <select
              value={id}
              onChange={(e) => {
                const next = [...cameraIds];
                next[idx] = e.target.value;
                setCameraIds(next);
              }}
              disabled={needsCameraPermission}
            >
              <option value="">(unselected)</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                disabled={!id}
                checked={!!(id && cameraOpts[id]?.y16)}
                onChange={(e) => {
                  const did = id;
                  if (!did) return;
                  setCameraOpts((prev) => ({
                    ...prev,
                    [did]: { ...(prev[did] || {}), y16: e.target.checked },
                  }));
                }}
              />
              Y16
            </label>
            <button onClick={() => setCameraIds(cameraIds.filter((_, i) => i !== idx))}>Remove</button>
          </div>
        ))}
        <div className="row" style={{ gap: 8 }}>
          <button onClick={() => setCameraIds([...cameraIds, ""])}>+ Add</button>
          {needsCameraPermission && (
            <>
              <button onClick={requestCameraAccess}>Allow camera access</button>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Devices appear after permission is granted.</span>
            </>
          )}
        </div>
      </div>

      <div className="col" style={{ marginTop: 8 }}>
        <label>Microcontroller (Web Serial)</label>
        {serialSupported ? (
          <div className="row">
            <button
              onClick={async () => {
                const s = new SerialCommunicator();
                const ok = await s.connect();
                if (ok) setSerial(s);
              }}
            >
              Choose Port
            </button>
            <button onClick={() => serial?.disconnect()} disabled={!serial}>
              Disconnect
            </button>
          </div>
        ) : (
          <div>Web Serial not supported by this browser (Chrome recommended).</div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <label>Laser Output (%)</label>
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
            I acknowledge safe operation
          </label>
          <button
            disabled={!serial || !armed}
            onClick={() => serial?.setLaserOutput(laserPct)}
            title="Teensy firmware: Mode A sets PWM/DAC (0–100)"
          >
            Send Output
          </button>
        </div>
      </div>
    </div>
  );
}

// Export as client-only to avoid SSR/CSR mismatch without extra effects
const DeviceSettings = dynamic(() => Promise.resolve(DeviceSettingsInner), { ssr: false });
export default DeviceSettings;
