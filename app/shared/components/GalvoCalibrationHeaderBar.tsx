"use client";

type Device = { deviceId: string; label: string };

type Props = {
  title: string;
  devices: Device[];
  deviceId: string;
  setDeviceId: (id: string) => void;
  expectedCam?: string;
  serialOk: boolean;
  onConnect: () => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  fps: number;
};

export default function GalvoCalibrationHeaderBar({
  title,
  devices,
  deviceId,
  setDeviceId,
  expectedCam,
  serialOk,
  onConnect,
  onDisconnect,
  fps,
}: Props) {
  return (
    <header className="header">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{title}</b>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <label className="row" style={{ gap: 6 }}>
            Source Camera
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={devices.length === 0}
            >
              <option value="">(unselected)</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          </label>
          <span style={{ opacity: 0.75 }}>
            Expecting: <code>{expectedCam || "-"}</code>
          </span>
          <span style={{ opacity: 0.75 }}>FPS: {fps.toFixed(1)}</span>
          <button onClick={() => (serialOk ? undefined : onConnect())} disabled={serialOk}>
            {serialOk ? "Connected" : "Connect Microcontroller"}
          </button>
          {serialOk && (
            <button onClick={() => onDisconnect()}>Disconnect</button>
          )}
        </div>
      </div>
    </header>
  );
}

