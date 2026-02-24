"use client";

export default function GalvoCalibrationLogPanel({ log }: { log: string }) {
  return (
    <section className="col" style={{ gap: 8 }}>
      <h4>Log</h4>
      <pre
        style={{
          minHeight: 120,
          maxHeight: 240,
          overflow: "auto",
          background: "#111",
          color: "#eaeaea",
          padding: 8,
          borderRadius: 4,
          whiteSpace: "pre-wrap",
        }}
      >
        {log}
      </pre>
    </section>
  );
}

