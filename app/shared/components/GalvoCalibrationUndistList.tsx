"use client";

import type { UndistItem } from "@/shared/calibration/galvoTypes";

type Props = {
  items: UndistItem[];
  selKey: string;
  onSelect: (key: string) => void;
  selected: UndistItem | null;
};

export default function GalvoCalibrationUndistList({ items, selKey, onSelect, selected }: Props) {
  return (
    <section className="col" style={{ gap: 8 }}>
      <h4>Undistortion Map (Select one)</h4>
      <div className="tree" style={{ maxHeight: 220, overflow: "auto" }}>
        {items.map((p) => (
          <div
            key={p.mapXYPath}
            className={`file ${p.mapXYPath === selKey ? "active" : ""}`}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
            onClick={() => onSelect(p.mapXYPath)}
            title={p.mapXYPath}
          >
            <span style={{ width: 220, fontFamily: "monospace" }}>{p.runTs}</span>
            <span>Undistort: {p.cam}</span>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ opacity: 0.7 }}>No undistortion maps found (generate in /2).</div>
        )}
      </div>
      {selected && (
        <div style={{ opacity: 0.8, fontSize: 13 }}>XY: {selected.mapXYPath}</div>
      )}
    </section>
  );
}

