"use client";

import { create } from "zustand";
import {
  readNamespacedStore,
  updateNamespacedStore,
} from "@/shared/module/loaclStorage";

type PrefsStoreShape = {
  // Sidebar File System: list of open directory paths
  fsOpenDirs?: string[];
};

export type PrefsState = {
  fsOpenDirs: string[];
  setFsOpenDirs: (dirs: string[] | Set<string>) => void;
  toggleFsDir: (path: string) => void;
  hydrateFsOpenDirs: (defaults: string[]) => void; // only applies if empty
};

function uniqSorted(list: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(list))).sort();
}

export const usePrefs = create<PrefsState>((set, get) => {
  const initial = ((): string[] => {
    if (typeof window === "undefined") return [];
    const st = readNamespacedStore<PrefsStoreShape>();
    return Array.isArray(st.fsOpenDirs) ? st.fsOpenDirs : [];
  })();

  const persist = (dirs: string[]) => {
    updateNamespacedStore({ fsOpenDirs: dirs });
  };

  return {
    fsOpenDirs: initial,
    setFsOpenDirs: (dirs) => {
      const next = Array.isArray(dirs) ? uniqSorted(dirs) : uniqSorted(dirs);
      set({ fsOpenDirs: next });
      if (typeof window !== "undefined") persist(next);
    },
    toggleFsDir: (path) => {
      const cur = new Set(get().fsOpenDirs);
      if (cur.has(path)) cur.delete(path); else cur.add(path);
      const next = uniqSorted(cur);
      set({ fsOpenDirs: next });
      if (typeof window !== "undefined") persist(next);
    },
    hydrateFsOpenDirs: (defaults) => {
      const cur = get().fsOpenDirs;
      if (cur.length === 0 && defaults.length > 0) {
        const next = uniqSorted(defaults);
        set({ fsOpenDirs: next });
        if (typeof window !== "undefined") persist(next);
      }
    },
  };
});

// Keep store in sync with cross-tab or external updates to the namespaced store
if (typeof window !== "undefined") {
  window.addEventListener("gw:ns:update", (e: Event) => {
    try {
      const detail = (e as CustomEvent).detail as { next?: PrefsStoreShape } | undefined;
      const arr = detail?.next?.fsOpenDirs;
      if (Array.isArray(arr)) {
        const cur = usePrefs.getState().fsOpenDirs;
        // Shallow compare sorted arrays
        const a = cur.join("\u0000");
        const b = arr.slice().sort().join("\u0000");
        if (a !== b) usePrefs.setState({ fsOpenDirs: arr.slice().sort() });
      }
    } catch {
      // ignore
    }
  });
}

