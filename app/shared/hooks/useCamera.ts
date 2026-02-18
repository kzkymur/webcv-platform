"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";

type CameraKey = "camera:web" | "camera:thermal";

export function useCamera({ key }: { key: CameraKey }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(() => {
    const st = readNamespacedStore<{ webCamId?: string; thermalCamId?: string }>();
    return key === "camera:web" ? st.webCamId : st.thermalCamId;
  });

  useEffect(() => {
    const onUpdate = () => {
      const st = readNamespacedStore<{ webCamId?: string; thermalCamId?: string }>();
      setCurrentDeviceId(key === "camera:web" ? st.webCamId : st.thermalCamId);
    };
    window.addEventListener("gw:ns:update", onUpdate as EventListener);
    return () => window.removeEventListener("gw:ns:update", onUpdate as EventListener);
  }, [key]);

  useEffect(() => {
    let active = true;
    async function open() {
      if (!currentDeviceId) {
        setStream(null);
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: currentDeviceId } },
          audio: false,
        });
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
      } catch (e) {
        console.warn("getUserMedia error", e);
        setStream(null);
      }
    }
    open();
    return () => {
      active = false;
      setStream((s) => {
        s?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, [currentDeviceId]);

  return { stream };
}
