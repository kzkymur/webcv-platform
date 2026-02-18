// Classic worker to allow importScripts for Emscripten's non-ESM output
// eslint-disable-next-line no-restricted-globals
const g: any = self as any;

let modulePromise: Promise<any> | null = null;
function getModule() {
  if (!modulePromise) {
    // Load Emscripten JS glue and instantiate
    // Resolve URLs via bundler so static export includes the assets
    // @ts-ignore
    const glueUrl = new URL("../../../src-wasm/index.js", import.meta.url).toString();
    // @ts-ignore
    const wasmUrl = new URL("../../../src-wasm/index.wasm", import.meta.url).toString();
    g.importScripts(glueUrl);
    const factory = g.Module as (opts?: any) => Promise<any>;
    modulePromise = factory({ locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p) });
  }
  return modulePromise;
}

function clear(Module: any, ptr: number) {
  Module.ccall("clearBuffer", null, ["number"], [ptr]);
}

self.onmessage = async (ev: MessageEvent<any>) => {
  const { id, type } = ev.data || {};
  if (type === "ping") {
    // eslint-disable-next-line no-restricted-globals
    (self as any).postMessage({ id, ok: true, type: "pong" });
    return;
  }
  if (type === "cv/findChessboardCorners") {
    const { width, height, rgba } = ev.data;
    const Module = await getModule();
    const src = new Uint8Array(rgba);
    const imgPtr = Module.ccall("getU8Buffer", "number", ["number"], [src.length]);
    Module.HEAPU8.set(src, imgPtr);
    const N = 10 * 7;
    const outPtr = Module.ccall("getFloatBuffer", "number", ["number"], [N * 2]);
    const found = !!Module.ccall("findChessboardCorners", "number", ["number", "number", "number", "number"], [imgPtr, width, height, outPtr]);
    const out = new Float32Array(Module.HEAPU8.buffer, outPtr, N * 2);
    const copy = new Float32Array(out);
    clear(Module, imgPtr);
    clear(Module, outPtr);
    // eslint-disable-next-line no-restricted-globals
    (self as any).postMessage({ id, ok: true, type: "cv/findChessboardCorners", found, points: copy.buffer }, [copy.buffer as any]);
    return;
  }
};
