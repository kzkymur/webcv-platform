// Minimal worker stub. Later, load the Emscripten module here and expose methods.
// import WasmModule from "@wasm"; // heavy: wire in when needed

import WasmModuleFactory from "@wasm";
// Force bundler to include wasm asset and give us a concrete URL
// Path is relative to this file; adjust if you move files
// @ts-ignore
// Note: this file lives at app/shared/wasm/worker.ts, the WASM sits at repo-root/src-wasm/
// so we need to go up three directories to reach the project root.
const wasmUrl = new URL("../../../src-wasm/index.wasm", import.meta.url).toString();

type BaseReq = { id: number; type: string };
export type WorkerReq =
  | { id: number; type: "ping" }
  | { id: number; type: "cv/findChessboardCorners"; width: number; height: number; rgba: ArrayBuffer };

export type WorkerRes =
  | { id: number; ok: true; type: "pong" }
  | { id: number; ok: true; type: "cv/findChessboardCorners"; found: boolean; points: ArrayBuffer };

let ModulePromise: Promise<any> | null = null;
function getModule() {
  if (!ModulePromise) {
    ModulePromise = (WasmModuleFactory as any)({
      locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p),
    });
  }
  return ModulePromise;
}

function copyToHeapU8(Module: any, src: Uint8Array) {
  const ptr = Module.ccall("getU8Buffer", "number", ["number"], [src.length]);
  Module.HEAPU8.set(src, ptr);
  return ptr;
}
function allocF32(Module: any, n: number) {
  const ptr = Module.ccall("getFloatBuffer", "number", ["number"], [n]);
  return ptr;
}
function clear(Module: any, ptr: number) {
  Module.ccall("clearBuffer", null, ["number"], [ptr]);
}

self.onmessage = async (ev: MessageEvent<WorkerReq>) => {
  const { id, type } = ev.data || ({} as any);
  if (type === "ping") {
    const res: WorkerRes = { id, ok: true, type: "pong" };
    (self as any).postMessage(res);
    return;
  }
  if (type === "cv/findChessboardCorners") {
    const { width, height, rgba } = ev.data as Extract<WorkerReq, { type: "cv/findChessboardCorners" }>;
    const Module = await getModule();
    const img = new Uint8Array(rgba);
    const imgPtr = copyToHeapU8(Module, img);
    const N = 10 * 7; // keep in sync with C++
    const outPtr = allocF32(Module, N * 2);
    const found = !!Module.ccall(
      "findChessboardCorners",
      "number",
      ["number", "number", "number", "number"],
      [imgPtr, width, height, outPtr]
    );
    const out = new Float32Array(Module.HEAPU8.buffer, outPtr, N * 2);
    const copy = new Float32Array(out);
    clear(Module, imgPtr);
    clear(Module, outPtr);
    const res: WorkerRes = {
      id,
      ok: true,
      type: "cv/findChessboardCorners",
      found,
      points: copy.buffer,
    };
    (self as any).postMessage(res, [copy.buffer as any]);
    return;
  }
};
