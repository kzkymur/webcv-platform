import { useEffect, useMemo } from "react";
import { useWasmModule } from "@/shared/store/ctx/hooks";
import {
  WMU8A,
  WMU32A,
  WMF32A,
  WMF64A,
  type F32AP,
  type F64AP,
  type U32AP,
  type U8AP,
} from "./memory-core";

export const useF32ArrayPointer = (
  src: Float32Array | number[] | null,
  size?: number
) => {
  const module = useWasmModule();
  const m = useMemo(() => {
    if (module === null || src === null) return null;
    const m = new WMF32A(module, size || src.length);
    m.data = new Float32Array(src);
    return m;
  }, [module, src, size]);
  useEffect(
    () => () => {
      if (m !== null) m.clear();
    },
    [m]
  );
  const p = useMemo(() => (m === null ? (0 as F32AP) : m.pointer), [m]);
  return p;
};

// Re-export WM classes for existing imports
export { WMU8A, WMU32A, WMF32A, WMF64A };
