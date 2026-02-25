"use client";

import { updateNamespacedStore, readNamespacedStore } from "@/shared/module/loaclStorage";
import { useEffect } from "react";

type Props = {
  side: "left" | "right"; // which edge the handle sits on
  cssVar: string; // e.g. --sidebar-left-width
  storeKey: string; // e.g. sidebarLeftWidth
  min?: number; // px
  max?: number; // px
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function SidebarResizer({ side, cssVar, storeKey, min = 200, max = 640 }: Props) {
  // On first mount of any resizer, apply persisted width if present
  useEffect(() => {
    const st = readNamespacedStore<Record<string, unknown>>();
    const v = typeof st[storeKey] === "number" ? (st[storeKey] as number) : undefined;
    if (typeof window !== "undefined") {
      const fallback = side === "left" ? 320 : 320;
      const px = clamp(typeof v === "number" ? v : fallback, min, max);
      document.documentElement.style.setProperty(cssVar, `${px}px`);
    }
  }, [cssVar, min, max, side, storeKey]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const startX = e.clientX;
    const vw = window.innerWidth;
    const root = document.documentElement;
    root.style.userSelect = "none";
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX;
      let width: number;
      if (side === "right") {
        // handle on the right edge of the left sidebar: width = x
        width = x;
      } else {
        // handle on the left edge of the right sidebar: width = vw - x
        width = vw - x;
      }
      width = clamp(width, min, max);
      document.documentElement.style.setProperty(cssVar, `${width}px`);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      root.style.userSelect = "";
      // persist
      const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      const num = parseInt(v, 10);
      if (!Number.isNaN(num)) updateNamespacedStore({ [storeKey]: num });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const style: React.CSSProperties =
    side === "right"
      ? { position: "absolute", top: 0, right: -3, width: 6, bottom: 0, cursor: "col-resize", touchAction: "none", zIndex: 5 }
      : { position: "absolute", top: 0, left: -3, width: 6, bottom: 0, cursor: "col-resize", touchAction: "none", zIndex: 5 };

  return <div role="separator" aria-orientation="vertical" onPointerDown={onPointerDown} style={style} />;
}
