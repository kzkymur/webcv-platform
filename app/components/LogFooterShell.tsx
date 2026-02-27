"use client";

import type { ReactNode } from "react";
import LogFooter from "@/components/LogFooter";

export default function LogFooterShell({
  children,
  log,
  title,
}: {
  children: ReactNode;
  log: string;
  title?: string;
}) {
  return (
    <main
      className="main"
      style={{
        // Override default padding/overflow to create a split area
        padding: 0,
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: "1fr auto",
      }}
    >
      <div style={{ overflow: "auto", padding: 12 }}>{children}</div>
      <LogFooter log={log} title={title} />
    </main>
  );
}

