"use client";

import type { GridParams, Range, Timing } from "@/shared/calibration/galvoTypes";

type Props = {
  grid: GridParams;
  setGrid: (g: GridParams) => void;
  xRange: Range;
  setXRange: (r: Range) => void;
  yRange: Range;
  setYRange: (r: Range) => void;
  laserPct: number;
  setLaserPct: (n: number) => void;
  timing: Timing;
  setTiming: (t: Timing) => void;
  busy: boolean;
  canRun: boolean;
  onStart: () => void;
  onCancel: () => void;
};

export default function GalvoCalibrationRunPanel({
  grid,
  setGrid,
  xRange,
  setXRange,
  yRange,
  setYRange,
  laserPct,
  setLaserPct,
  timing,
  setTiming,
  busy,
  canRun,
  onStart,
  onCancel,
}: Props) {
  return (
    <section className="col" style={{ gap: 8 }}>
      <h4>Run Calibration</h4>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 6 }}>
          Grid X
          <input
            type="number"
            min={2}
            max={64}
            value={grid.nx}
            onChange={(e) => setGrid({ ...grid, nx: Math.max(2, Math.min(64, Number(e.target.value) | 0)) })}
            style={{ width: 70 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          Grid Y
          <input
            type="number"
            min={2}
            max={64}
            value={grid.ny}
            onChange={(e) => setGrid({ ...grid, ny: Math.max(2, Math.min(64, Number(e.target.value) | 0)) })}
            style={{ width: 70 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          X min
          <input
            type="number"
            min={0}
            max={65535}
            value={xRange.min}
            onChange={(e) => setXRange({ ...xRange, min: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          X max
          <input
            type="number"
            min={0}
            max={65535}
            value={xRange.max}
            onChange={(e) => setXRange({ ...xRange, max: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          Y min
          <input
            type="number"
            min={0}
            max={65535}
            value={yRange.min}
            onChange={(e) => setYRange({ ...yRange, min: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          Y max
          <input
            type="number"
            min={0}
            max={65535}
            value={yRange.max}
            onChange={(e) => setYRange({ ...yRange, max: Math.max(0, Math.min(65535, Number(e.target.value) | 0)) })}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          Laser (%)
          <input
            type="number"
            min={0}
            max={100}
            value={laserPct}
            onChange={(e) => setLaserPct(Math.max(0, Math.min(100, Number(e.target.value) | 0)))}
            style={{ width: 70 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          Laser ON (ms)
          <input
            type="number"
            min={10}
            max={2000}
            value={timing.onMs}
            onChange={(e) => setTiming({ ...timing, onMs: Math.max(10, Math.min(2000, Number(e.target.value) | 0)) })}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          After OFF wait (ms)
          <input
            type="number"
            min={0}
            max={2000}
            value={timing.offMs}
            onChange={(e) => setTiming({ ...timing, offMs: Math.max(0, Math.min(2000, Number(e.target.value) | 0)) })}
            style={{ width: 110 }}
          />
        </label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button onClick={onStart} disabled={busy || !canRun} title={!canRun ? "Connect Microcontroller first" : undefined}>
          {busy ? "Running…" : "Start"}
        </button>
        {busy && (
          <button onClick={onCancel}>Cancel</button>
        )}
      </div>
    </section>
  );
}

