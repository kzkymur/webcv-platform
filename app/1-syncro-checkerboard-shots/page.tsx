"use client";

export const dynamic = "error";

import { useEffect, useRef, useState, useMemo } from "react";
import Sidebar from "@/components/Sidebar";
import { useCameraIds } from "@/shared/hooks/useCameraStreams";
import { putFile } from "@/shared/db";
import type { FileEntry } from "@/shared/db/types";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";
import { formatTimestamp } from "@/shared/util/time";
import { sanitize } from "@/shared/util/strings";
import { SHOTS_DIR } from "@/shared/util/shots";
import CameraPreview, { type CameraPreviewHandle, type CaptureFormat } from "@/shared/components/CameraPreview";

export default function Page() {
  const [ids] = useCameraIds();
  // Per-camera capture format
  const [fmtById, setFmtById] = useState<Record<string, CaptureFormat>>(() => {
    const st = readNamespacedStore<{ shotOptions?: Record<string, { fmt: CaptureFormat }> }>();
    const map: Record<string, CaptureFormat> = {};
    if (st.shotOptions) {
      for (const [k, v] of Object.entries(st.shotOptions)) map[k] = v.fmt;
    }
    return map;
  });
  const [busy, setBusy] = useState(false);
  const panelsRef = useRef<Map<string, CameraPreviewHandle>>(new Map());

  // Helper to register child preview handles by deviceId
  const register = (deviceId: string | undefined, handle: CameraPreviewHandle | null) => {
    if (!deviceId) return;
    const map = panelsRef.current;
    if (handle) map.set(deviceId, handle);
    else map.delete(deviceId);
  };

  async function shootAll() {
    if (busy) return;
    setBusy(true);
    try {
      // Build timestamp once to ensure files from the same trigger share it
      const ts = formatTimestamp(new Date());
      const tasks: Promise<void>[] = [];
      for (const id of ids) {
        if (!id) continue;
        const h = panelsRef.current.get(id);
        if (!h) continue;
        tasks.push(
          (async () => {
            const perFmt = fmtById[id] || "rgba8";
            const shot = await h.capture(perFmt);
            if (!shot) return;
            const name = sanitize(shot.label || id);
            const baseDir = SHOTS_DIR;
            const ext = perFmt === "gray8" ? ".gray" : ".rgb"; // store with explicit extension
            const filePath = `${baseDir}/${ts}_cam-${name}${ext}`;
            const entry: FileEntry = {
              path: filePath,
              type: perFmt === "gray8" ? "grayscale-image" : "rgb-image",
              data: shot.data.buffer as ArrayBuffer,
              width: shot.width,
              height: shot.height,
              channels: 4, // stored as RGBA for both modes
            };
            await putFile(entry);
          })()
        );
      }
      await Promise.all(tasks);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sidebar onSelectFile={() => { /* page 1: no file preview */ }} />
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>1. Syncro Checkerboard Shots</b>
          <div className="row" style={{ gap: 12 }}>
            <button onClick={shootAll} disabled={busy || ids.length === 0}>
              Capture All ({ids.length})
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="col" style={{ gap: 16 }}>
          <section className="col" style={{ gap: 12 }}>
            <h4>Selected Cameras</h4>
            {ids.length === 0 && (
              <div style={{ opacity: 0.7 }}>No cameras selected. Add from Device Settings in the sidebar.</div>
            )}
            {ids.map((id, idx) => (
              <CameraPreview
                key={id || idx}
                deviceId={id}
                format={fmtById[id] || "rgba8"}
                onChangeFormat={(fmt) => {
                  setFmtById((prev) => {
                    const next = { ...prev, [id || ""]: fmt };
                    // persist
                    const st = readNamespacedStore<{ shotOptions?: Record<string, { fmt: CaptureFormat }> }>();
                    const shotOptions = { ...(st.shotOptions || {}) } as Record<string, { fmt: CaptureFormat }>;
                    if (id) shotOptions[id] = { fmt };
                    updateNamespacedStore({ shotOptions });
                    return next;
                  });
                }}
                onReady={(h) => register(id, h)}
              />
            ))}
          </section>
        </div>
      </main>
    </>
  );
}

// (Note) File preview is intentionally omitted on this page per requirements.
