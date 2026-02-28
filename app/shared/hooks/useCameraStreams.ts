"use client";

import { useEffect, useState } from "react";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";

// Retained for compatibility: only camera ID list management.
export function useCameraIds(): [string[], (next: string[]) => void] {
  const [ids, setIds] = useState<string[]>([]);

  // Hydrate from namespaced store after mount
  useEffect(() => {
    const st = readNamespacedStore<{ cameraIds?: string[]; webCamId?: string | null; thermalCamId?: string | null }>();
    if (st.cameraIds && Array.isArray(st.cameraIds)) {
      setIds(st.cameraIds);
    } else {
      const legacy = [st.webCamId, st.thermalCamId].filter((v): v is string => !!v);
      if (legacy.length > 0) setIds(legacy);
    }
  }, []);

  // Subscribe to namespaced updates
  useEffect(() => {
    const onUpdate = () => {
      const st = readNamespacedStore<{ cameraIds?: string[] }>();
      if (Array.isArray(st.cameraIds)) setIds(st.cameraIds);
    };
    window.addEventListener("gw:ns:update", onUpdate as EventListener);
    return () => window.removeEventListener("gw:ns:update", onUpdate as EventListener);
  }, []);

  const set = (next: string[]) => {
    setIds(next);
    updateNamespacedStore({ cameraIds: next });
  };

  return [ids, set];
}

