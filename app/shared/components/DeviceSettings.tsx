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
  const [cameraIds, setCameraIds] = useState<string[]>([]);
  const [serial, setSerial] = useState<SerialCommunicator | null>(null);
  const [laserPct, setLaserPct] = useState(0);
  const [armed, setArmed] = useState(false);
  const [cameraOpts, setCameraOpts] = useState<Record<string, { y16?: boolean }>>({});

  // Initialize selects from namespaced store so UI reflects current state
  useEffect(() => {
    const st = readNamespacedStore<{ cameraIds?: string[]; webCamId?: string | null; thermalCamId?: string | null }>();
    if (st.cameraIds && Array.isArray(st.cameraIds)) {
      setCameraIds(st.cameraIds);
    } else {
      // Backward-compat: migrate legacy keys into a single list
      const legacy = [st.webCamId, st.thermalCamId].filter((v): v is string => !!v);
      setCameraIds(legacy);
      if (legacy.length > 0) updateNamespacedStore({ cameraIds: legacy });
    }
  }, []);

  // Load per-camera options on mount
  useEffect(() => {
    const st = readNamespacedStore<{ cameraOptions?: Record<string, { y16?: boolean }> }>();
    setCameraOpts(st.cameraOptions || {});
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
    updateNamespacedStore({ cameraIds }, ns);
  }, [cameraIds]);

  useEffect(() => {
    updateNamespacedStore({ cameraOptions: cameraOpts });
  }, [cameraOpts]);

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
