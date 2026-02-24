import ModuleWrapper, { F32AP, F64AP, U32AP, U8AP } from "./wrapper";

// React-free core of WM* helpers for use in Workers and non-React code.
// These classes manage Emscripten heap buffers with RAII-style clear().

abstract class WM<Data> {
  protected module: EmscriptenModule;
  protected mw: ModuleWrapper;
  public abstract pointer: number;

  constructor(module: EmscriptenModule) {
    this.module = module;
    this.mw = new ModuleWrapper(module);
  }

  public clear() {
    this.mw.clearBuffer(this.pointer);
  }

  abstract set data(data: Data);
  abstract get data(): Data;
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
    this.array = new Uint32Array(this.module.HEAPU32.buffer, this.pointer, size);
  }
  set data(data: Uint32Array) {
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
    this.array = new Float32Array(this.module.HEAPF32.buffer, this.pointer, size);
  }
  set data(data: Float32Array) {
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
    this.array = new Float64Array(this.module.HEAPF64.buffer, this.pointer, size);
  }
  set data(data: Float64Array) {
    this.array.set(data);
  }
  get data() {
    return new Float64Array(this.array);
  }
}

export type { F32AP, F64AP, U32AP, U8AP };

