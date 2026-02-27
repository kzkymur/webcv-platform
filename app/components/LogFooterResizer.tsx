"use client";

import { useEffect } from "react";
import { readNamespacedStore, updateNamespacedStore } from "@/shared/module/loaclStorage";

type Props = {
  cssVar?: string; // CSS variable for height
  storeKey?: string; // storage key
  min?: number; // px
  maxRatio?: number; // fraction of viewport height, e.g., 0.6
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function LogFooterResizer({
  cssVar = "--log-footer-height",
  storeKey = "logFooterHeight",
  min = 80,
  maxRatio = 0.6,
}: Props) {
  // Apply persisted height on first mount
  useEffect(() => {
    const st = readNamespacedStore<Record<string, unknown>>();
    const raw = st[storeKey];
    const fallback = 160;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const max = Math.floor(vh * maxRatio);
    const px = clamp(typeof raw === "number" ? (raw as number) : fallback, min, max);
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(cssVar, `${px}px`);
    }
  }, [cssVar, storeKey, min, maxRatio]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const vh = window.innerHeight;
    const max = Math.floor(vh * maxRatio);
    const root = document.documentElement;
    root.style.userSelect = "none";
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const y = ev.clientY; // pointer Y from top
      const height = clamp(vh - y, min, max);
      document.documentElement.style.setProperty(cssVar, `${height}px`);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      root.style.userSelect = "";
      const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      const num = parseInt(v, 10);
      if (!Number.isNaN(num)) updateNamespacedStore({ [storeKey]: num });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: -3,
        height: 6,
        cursor: "row-resize",
        touchAction: "none",
        zIndex: 5,
      }}
    />
  );
}

