"use client";

import LogFooterResizer from "@/components/LogFooterResizer";

export default function LogFooter({
  title = "Log",
  log,
}: {
  title?: string;
  log: string;
}) {
  return (
    <section
      style={{
        position: "relative",
        height: "var(--log-footer-height, 160px)",
        borderTop: "1px solid #3333",
        background: "#0b0b0b",
        color: "#eaeaea",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <LogFooterResizer />
      <div
        className="row"
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          fontSize: 12,
          opacity: 0.9,
          borderBottom: "1px solid #3333",
        }}
      >
        <b style={{ fontWeight: 600 }}>{title}</b>
        {/* reserved for future controls (e.g., Clear) */}
        <span />
      </div>
      <pre
        style={{
          flex: 1,
          overflow: "auto",
          margin: 0,
          padding: 10,
          whiteSpace: "pre-wrap",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.45,
          background: "transparent",
        }}
      >
        {log}
      </pre>
    </section>
  );
}

