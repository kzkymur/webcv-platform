"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getCurrentNamespace, updateNamespacedStore, readNamespacedStore } from "@/shared/module/loaclStorage";
import { listMergedVideoInputs } from "@/shared/util/devices";
import { SerialCommunicator } from "@/shared/module/serialInterface";

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
  const didInit = useRef(false);

  // Helper to (re)enumerate cameras
  async function refreshDevices() {
    try { setDevices(await listMergedVideoInputs()); } catch {}
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
  }, [cameraIds]);

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

  // WebSocket camera management
  const [wsInput, setWsInput] = useState("");
  const wsCams: string[] = ((): string[] => {
    const st = readNamespacedStore<{ wsCameras?: string[] }>();
    return Array.isArray(st.wsCameras) ? st.wsCameras : [];
  })();

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
            {/* Y16 toggle removed */}
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

      {/* WebSocket cameras */}
      <div className="col" style={{ marginTop: 12 }}>
        <label>WebSocket Cameras</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            placeholder="ws://host:port/path"
            value={wsInput}
            onChange={(e) => setWsInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            onClick={() => {
              const url = wsInput.trim();
              if (!url || (!url.startsWith("ws://") && !url.startsWith("wss://"))) return;
              const next = Array.from(new Set([...(wsCams || []), url]));
              updateNamespacedStore({ wsCameras: next });
              setWsInput("");
              refreshDevices();
            }}
          >
            Add
          </button>
        </div>
        {(wsCams || []).length > 0 && (
          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            {(wsCams || []).map((u) => (
              <div key={u} className="row" style={{ gap: 8, alignItems: "center" }}>
                <code style={{ flex: 1 }}>{u}</code>
                <button
                  onClick={() => {
                    const next = (wsCams || []).filter((x) => x !== u);
                    updateNamespacedStore({ wsCameras: next });
                    refreshDevices();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
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
