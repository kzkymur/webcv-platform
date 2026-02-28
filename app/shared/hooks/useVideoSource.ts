"use client";

import { useEffect, useRef } from "react";
import type { VideoStreamSource } from "@/shared/stream/types";
import { WebcamSource } from "@/shared/stream/webcam";
import { WebSocketY16Source } from "@/shared/stream/wsY16";

function isWsDeviceId(id: string | undefined | null): id is string {
  return !!id && (id.startsWith("ws://") || id.startsWith("wss://"));
}

export function useVideoSource(deviceId?: string | null): VideoStreamSource | null {
  const ref = useRef<VideoStreamSource | null>(null);

  useEffect(() => {
    try { ref.current?.dispose(); } catch {}
    ref.current = null;
    if (!deviceId) return;
    ref.current = isWsDeviceId(deviceId) ? new WebSocketY16Source(deviceId) : new WebcamSource(deviceId);
    return () => { try { ref.current?.dispose(); } catch {}; ref.current = null; };
  }, [deviceId]);

  return ref.current;
}

