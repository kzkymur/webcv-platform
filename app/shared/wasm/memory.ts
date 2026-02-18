import { useEffect, useMemo } from "react";
import ModuleWrapper, { F32AP, F64AP, U32AP, U8AP } from "./wrapper";
import { useWasmModule } from "@/shared/store/ctx/hooks";

abstract class WM<Data extends ArrayBuffer> {
  protected module: EmscriptenModule;
  protected mw: ModuleWrapper;
  public abstract pointer: number;

  constructor(module: EmscriptenModule) {
    this.module = module;
    this.mw = new ModuleWrapper(module);
  }

  // public resetSize(size: number) {
  //   this.size = size;
  //   this.pointer = this.mw.getU8Buffer(this.size);
  // }

  public clear() {
    this.mw.clearBuffer(this.pointer);
  }

  abstract data: Data;
}

export class WMU8A extends WM<Uint8Array | Uint8ClampedArray> {
  public pointer: U8AP;
  private array: Uint8Array;
  constructor(module: EmscriptenModule, size: number, pointer?: number) {
    super(module);
    this.pointer = (pointer || this.mw.getU8Buffer(size)) as U8AP;
    this.array = new Uint8Array(this.module.HEAPU8.buffer, this.pointer, size);
  }
  set data(data: Uint8Array | Uint8ClampedArray) {
    this.array.set(data);
  }
  get data() {
    return new Uint8Array(this.array);
  }
}

export class WMU32A extends WM<Uint32Array> {
  public pointer: U32AP;
  private array: Uint32Array;
  constructor(module: EmscriptenModule, size: number, pointer?: number) {
    super(module);
    this.pointer = (pointer || this.mw.getU32Buffer(size)) as U32AP;
    this.array = new Uint32Array(
      this.module.HEAPU32.buffer,
      this.pointer,
      size
    );
  }
  set data(data) {
    this.array.set(data);
  }
  get data() {
    return new Uint32Array(this.array);
  }
}

export class WMF32A extends WM<Float32Array> {
  public pointer: F32AP;
  private array: Float32Array;
  constructor(module: EmscriptenModule, size: number, pointer?: number) {
    super(module);
    this.pointer = (pointer || this.mw.getF32Buffer(size)) as F32AP;
    this.array = new Float32Array(
      this.module.HEAPU32.buffer,
      this.pointer,
      size
    );
  }
  set data(data) {
    this.array.set(data);
  }
  get data() {
    return new Float32Array(this.array);
  }
}

export class WMF64A extends WM<Float64Array> {
  public pointer: F64AP;
  private array: Float64Array;
  constructor(module: EmscriptenModule, size: number, pointer?: number) {
    super(module);
    this.pointer = (pointer || this.mw.getF64Buffer(size)) as F64AP;
    this.array = new Float64Array(
      this.module.HEAPU32.buffer,
      this.pointer,
      size
    );
  }
  set data(data) {
    this.array.set(data);
  }
  get data() {
    return new Float64Array(this.array);
  }
}

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
