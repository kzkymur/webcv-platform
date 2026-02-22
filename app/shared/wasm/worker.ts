// ESM worker: loads the Emscripten module via import and exposes the same API
// that the classic worker did, but without importScripts.

// Ensure the wasm binary is emitted and we have a concrete URL.
// @ts-ignore
const wasmUrl = new URL("../../../src-wasm/index.wasm", import.meta.url).toString();

let ModulePromise: Promise<any> | null = null;
function getModule() {
  if (!ModulePromise) {
    ModulePromise = (async () => {
      // Fetch the raw Emscripten glue as a file URL so webpack doesn't wrap it.
      // The `?url` hint forces asset/resource handling, giving a direct URL.
      const glueUrl = new URL("../../../src-wasm/index.js?url", import.meta.url).toString();
      const js = await (await fetch(glueUrl)).text();
      const blob = new Blob([js + "\nexport default Module;\n"], { type: "text/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      // Import the blob as an ES module to get the factory function.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const mod: any = await import(/* webpackIgnore: true */ blobUrl);
      const factory = mod && mod.default;
      if (typeof factory !== "function") {
        throw new Error("@wasm did not export a factory function");
      }
      return factory({
        locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p),
      });
    })();
  }
  return ModulePromise;
}

function clear(Module: any, ptr: number) {
  Module.ccall("clearBuffer", null, ["number"], [ptr]);
}

self.onmessage = async (ev: MessageEvent<any>) => {
  const { id, type } = ev.data || {};
  if (type === "ping") {
    (self as any).postMessage({ id, ok: true, type: "pong" });
    return;
  }

  // cv/findChessboardCorners
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
    (self as any).postMessage({ id, ok: true, type: "cv/findChessboardCorners", found, points: copy.buffer }, [copy.buffer as any]);
    return;
  }

  // cv/calcInnerParams
  if (type === "cv/calcInnerParams") {
    const { width, height, pointsList } = ev.data as { id: number; type: string; width: number; height: number; pointsList: ArrayBuffer[] };
    const Module = await getModule();
    try {
      const N = (pointsList || []).length;
      const ptrArr = Module.ccall("getU32Buffer", "number", ["number"], [N]);
      const base = ptrArr >>> 2; // U32 index
      for (let i = 0; i < N; i++) {
        const src = new Float32Array(pointsList[i]);
        const p = Module.ccall("getFloatBuffer", "number", ["number"], [src.length]);
        new Float32Array(Module.HEAPU8.buffer, p, src.length).set(src);
        Module.HEAPU32[base + i] = p;
      }
      const intrPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      const ok = !!Module.ccall(
        "calcInnerParams",
        "number",
        ["number", "number", "number", "number", "number", "number"],
        [ptrArr, N, width, height, intrPtr, distPtr]
      );
      const intr = new Float32Array(new Float32Array(Module.HEAPU8.buffer, intrPtr, 9));
      const dist = new Float32Array(new Float32Array(Module.HEAPU8.buffer, distPtr, 8));
      const intrCopy = new Float32Array(intr);
      const distCopy = new Float32Array(dist);
      for (let i = 0; i < N; i++) {
        const p = Module.HEAPU32[base + i];
        Module.ccall("clearBuffer", null, ["number"], [p]);
      }
      Module.ccall("clearBuffer", null, ["number"], [ptrArr]);
      Module.ccall("clearBuffer", null, ["number"], [intrPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcInnerParams", okFlag: ok, intr: intrCopy.buffer, dist: distCopy.buffer }, [intrCopy.buffer as any, distCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcInnerParams", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcUndistMap
  if (type === "cv/calcUndistMap") {
    const { width, height, intr, dist } = ev.data as { id: number; type: string; width: number; height: number; intr: ArrayBuffer; dist: ArrayBuffer };
    const Module = await getModule();
    try {
      const intrPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      new Float32Array(Module.HEAPU8.buffer, intrPtr, 9).set(new Float32Array(intr));
      new Float32Array(Module.HEAPU8.buffer, distPtr, 8).set(new Float32Array(dist));
      const mapLen = width * height;
      const mapXPtr = Module.ccall("getFloatBuffer", "number", ["number"], [mapLen]);
      const mapYPtr = Module.ccall("getFloatBuffer", "number", ["number"], [mapLen]);
      Module.ccall("calcUndistMap", null, ["number", "number", "number", "number", "number", "number"], [intrPtr, distPtr, width, height, mapXPtr, mapYPtr]);
      const x = new Float32Array(new Float32Array(Module.HEAPU8.buffer, mapXPtr, mapLen));
      const y = new Float32Array(new Float32Array(Module.HEAPU8.buffer, mapYPtr, mapLen));
      const xCopy = new Float32Array(x);
      const yCopy = new Float32Array(y);
      Module.ccall("clearBuffer", null, ["number"], [intrPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distPtr]);
      Module.ccall("clearBuffer", null, ["number"], [mapXPtr]);
      Module.ccall("clearBuffer", null, ["number"], [mapYPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcUndistMap", mapX: xCopy.buffer, mapY: yCopy.buffer }, [xCopy.buffer as any, yCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcUndistMap", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcHomography
  if (type === "cv/calcHomography") {
    const { aPoints, bPoints } = ev.data as any;
    const Module = await getModule();
    try {
      const n = Math.min(new Float32Array(aPoints).length, new Float32Array(bPoints).length) / 2;
      const aPtr = Module.ccall("getFloatBuffer", "number", ["number"], [n * 2]);
      const bPtr = Module.ccall("getFloatBuffer", "number", ["number"], [n * 2]);
      new Float32Array(Module.HEAPU8.buffer, aPtr, n * 2).set(new Float32Array(aPoints).subarray(0, n * 2));
      new Float32Array(Module.HEAPU8.buffer, bPtr, n * 2).set(new Float32Array(bPoints).subarray(0, n * 2));
      const hPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      Module.ccall("calcHomography", null, ["number", "number", "number", "number"], [aPtr, bPtr, n, hPtr]);
      const h = new Float32Array(new Float32Array(Module.HEAPU8.buffer, hPtr, 9));
      const hCopy = new Float32Array(h);
      Module.ccall("clearBuffer", null, ["number"], [aPtr]);
      Module.ccall("clearBuffer", null, ["number"], [bPtr]);
      Module.ccall("clearBuffer", null, ["number"], [hPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcHomography", H: hCopy.buffer }, [hCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcHomography", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcInnerParamsExt
  if (type === "cv/calcInnerParamsExt") {
    const { width, height, pointsList } = ev.data as { id: number; type: string; width: number; height: number; pointsList: ArrayBuffer[] };
    const Module = await getModule();
    try {
      const N = (pointsList || []).length;
      const ptrArr = Module.ccall("getU32Buffer", "number", ["number"], [N]);
      const base = ptrArr >>> 2;
      for (let i = 0; i < N; i++) {
        const src = new Float32Array(pointsList[i]);
        const p = Module.ccall("getFloatBuffer", "number", ["number"], [src.length]);
        new Float32Array(Module.HEAPU8.buffer, p, src.length).set(src);
        Module.HEAPU32[base + i] = p;
      }
      const intrPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      const rvecsPtr = Module.ccall("getFloatBuffer", "number", ["number"], [N * 3]);
      const tvecsPtr = Module.ccall("getFloatBuffer", "number", ["number"], [N * 3]);
      const ok = !!Module.ccall(
        "calcInnerParamsExt",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [ptrArr, N, width, height, intrPtr, distPtr, rvecsPtr, tvecsPtr]
      );
      const intr = new Float32Array(new Float32Array(Module.HEAPU8.buffer, intrPtr, 9));
      const dist = new Float32Array(new Float32Array(Module.HEAPU8.buffer, distPtr, 8));
      const rvecs = new Float32Array(new Float32Array(Module.HEAPU8.buffer, rvecsPtr, N * 3));
      const tvecs = new Float32Array(new Float32Array(Module.HEAPU8.buffer, tvecsPtr, N * 3));
      const intrCopy = new Float32Array(intr);
      const distCopy = new Float32Array(dist);
      const rCopy = new Float32Array(rvecs);
      const tCopy = new Float32Array(tvecs);
      for (let i = 0; i < N; i++) {
        const p = Module.HEAPU32[base + i];
        Module.ccall("clearBuffer", null, ["number"], [p]);
      }
      Module.ccall("clearBuffer", null, ["number"], [ptrArr]);
      Module.ccall("clearBuffer", null, ["number"], [intrPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distPtr]);
      Module.ccall("clearBuffer", null, ["number"], [rvecsPtr]);
      Module.ccall("clearBuffer", null, ["number"], [tvecsPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcInnerParamsExt", okFlag: ok, intr: intrCopy.buffer, dist: distCopy.buffer, rvecs: rCopy.buffer, tvecs: tCopy.buffer }, [intrCopy.buffer as any, distCopy.buffer as any, rCopy.buffer as any, tCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcInnerParamsExt", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcInnerParamsFisheyeExt
  if (type === "cv/calcInnerParamsFisheyeExt") {
    const { width, height, pointsList } = ev.data as { id: number; type: string; width: number; height: number; pointsList: ArrayBuffer[] };
    const Module = await getModule();
    try {
      const N = (pointsList || []).length;
      const ptrArr = Module.ccall("getU32Buffer", "number", ["number"], [N]);
      const base = ptrArr >>> 2;
      for (let i = 0; i < N; i++) {
        const src = new Float32Array(pointsList[i]);
        const p = Module.ccall("getFloatBuffer", "number", ["number"], [src.length]);
        new Float32Array(Module.HEAPU8.buffer, p, src.length).set(src);
        Module.HEAPU32[base + i] = p;
      }
      const intrPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distPtr = Module.ccall("getFloatBuffer", "number", ["number"], [4]);
      const rvecsPtr = Module.ccall("getFloatBuffer", "number", ["number"], [N * 3]);
      const tvecsPtr = Module.ccall("getFloatBuffer", "number", ["number"], [N * 3]);
      const ok = !!Module.ccall(
        "calcInnerParamsFisheyeExt",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [ptrArr, N, width, height, intrPtr, distPtr, rvecsPtr, tvecsPtr]
      );
      const intr = new Float32Array(new Float32Array(Module.HEAPU8.buffer, intrPtr, 9));
      const dist = new Float32Array(new Float32Array(Module.HEAPU8.buffer, distPtr, 4));
      const rvecs = new Float32Array(new Float32Array(Module.HEAPU8.buffer, rvecsPtr, N * 3));
      const tvecs = new Float32Array(new Float32Array(Module.HEAPU8.buffer, tvecsPtr, N * 3));
      const intrCopy = new Float32Array(intr);
      const distCopy = new Float32Array(dist);
      const rCopy = new Float32Array(rvecs);
      const tCopy = new Float32Array(tvecs);
      for (let i = 0; i < N; i++) {
        const p = Module.HEAPU32[base + i];
        Module.ccall("clearBuffer", null, ["number"], [p]);
      }
      Module.ccall("clearBuffer", null, ["number"], [ptrArr]);
      Module.ccall("clearBuffer", null, ["number"], [intrPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distPtr]);
      Module.ccall("clearBuffer", null, ["number"], [rvecsPtr]);
      Module.ccall("clearBuffer", null, ["number"], [tvecsPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcInnerParamsFisheyeExt", okFlag: ok, intr: intrCopy.buffer, dist: distCopy.buffer, rvecs: rCopy.buffer, tvecs: tCopy.buffer }, [intrCopy.buffer as any, distCopy.buffer as any, rCopy.buffer as any, tCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcInnerParamsFisheyeExt", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcHomographyUndist
  if (type === "cv/calcHomographyUndist") {
    const { aPoints, bPoints, intrA, distA, intrB, distB } = ev.data as any;
    const Module = await getModule();
    try {
      const n = Math.min(new Float32Array(aPoints).length, new Float32Array(bPoints).length) / 2;
      const aPtr = Module.ccall("getFloatBuffer", "number", ["number"], [n * 2]);
      const bPtr = Module.ccall("getFloatBuffer", "number", ["number"], [n * 2]);
      new Float32Array(Module.HEAPU8.buffer, aPtr, n * 2).set(new Float32Array(aPoints).subarray(0, n * 2));
      new Float32Array(Module.HEAPU8.buffer, bPtr, n * 2).set(new Float32Array(bPoints).subarray(0, n * 2));
      const intrAPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distAPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      const intrBPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distBPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      new Float32Array(Module.HEAPU8.buffer, intrAPtr, 9).set(new Float32Array(intrA));
      new Float32Array(Module.HEAPU8.buffer, distAPtr, 8).set(new Float32Array(distA));
      new Float32Array(Module.HEAPU8.buffer, intrBPtr, 9).set(new Float32Array(intrB));
      new Float32Array(Module.HEAPU8.buffer, distBPtr, 8).set(new Float32Array(distB));
      const hPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      Module.ccall("calcHomographyUndist", null,
        ["number","number","number","number","number","number","number","number"],
        [aPtr, bPtr, n, intrAPtr, distAPtr, intrBPtr, distBPtr, hPtr]
      );
      const h = new Float32Array(new Float32Array(Module.HEAPU8.buffer, hPtr, 9));
      const hCopy = new Float32Array(h);
      Module.ccall("clearBuffer", null, ["number"], [aPtr]);
      Module.ccall("clearBuffer", null, ["number"], [bPtr]);
      Module.ccall("clearBuffer", null, ["number"], [intrAPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distAPtr]);
      Module.ccall("clearBuffer", null, ["number"], [intrBPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distBPtr]);
      Module.ccall("clearBuffer", null, ["number"], [hPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcHomographyUndist", H: hCopy.buffer }, [hCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcHomographyUndist", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcHomographyUndistQuality
  if (type === "cv/calcHomographyUndistQuality") {
    const { aPoints, bPoints, intrA, distA, intrB, distB } = ev.data as any;
    const Module = await getModule();
    try {
      const n = Math.min(new Float32Array(aPoints).length, new Float32Array(bPoints).length) / 2;
      const aPtr = Module.ccall("getFloatBuffer", "number", ["number"], [n * 2]);
      const bPtr = Module.ccall("getFloatBuffer", "number", ["number"], [n * 2]);
      new Float32Array(Module.HEAPU8.buffer, aPtr, n * 2).set(new Float32Array(aPoints).subarray(0, n * 2));
      new Float32Array(Module.HEAPU8.buffer, bPtr, n * 2).set(new Float32Array(bPoints).subarray(0, n * 2));
      const intrAPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distAPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      const intrBPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distBPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      new Float32Array(Module.HEAPU8.buffer, intrAPtr, 9).set(new Float32Array(intrA));
      new Float32Array(Module.HEAPU8.buffer, distAPtr, 8).set(new Float32Array(distA));
      new Float32Array(Module.HEAPU8.buffer, intrBPtr, 9).set(new Float32Array(intrB));
      new Float32Array(Module.HEAPU8.buffer, distBPtr, 8).set(new Float32Array(distB));
      const hPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const mPtr = Module.ccall("getFloatBuffer", "number", ["number"], [2]);
      Module.ccall(
        "calcHomographyUndistQuality",
        null,
        ["number","number","number","number","number","number","number","number","number"],
        [aPtr, bPtr, n, intrAPtr, distAPtr, intrBPtr, distBPtr, hPtr, mPtr]
      );
      const h = new Float32Array(new Float32Array(Module.HEAPU8.buffer, hPtr, 9));
      const metrics = new Float32Array(new Float32Array(Module.HEAPU8.buffer, mPtr, 2));
      const hCopy = new Float32Array(h);
      const mCopy = new Float32Array(metrics);
      Module.ccall("clearBuffer", null, ["number"], [aPtr]);
      Module.ccall("clearBuffer", null, ["number"], [bPtr]);
      Module.ccall("clearBuffer", null, ["number"], [intrAPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distAPtr]);
      Module.ccall("clearBuffer", null, ["number"], [intrBPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distBPtr]);
      Module.ccall("clearBuffer", null, ["number"], [hPtr]);
      Module.ccall("clearBuffer", null, ["number"], [mPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcHomographyUndistQuality", H: hCopy.buffer, metrics: mCopy.buffer }, [hCopy.buffer as any, mCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcHomographyUndistQuality", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcInterRemapUndist
  if (type === "cv/calcInterRemapUndist") {
    const { widthA, heightA, widthB, heightB, intrA, distA, intrB, distB, H } = ev.data as any;
    const Module = await getModule();
    try {
      const intrAPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distAPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      const intrBPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      const distBPtr = Module.ccall("getFloatBuffer", "number", ["number"], [8]);
      new Float32Array(Module.HEAPU8.buffer, intrAPtr, 9).set(new Float32Array(intrA));
      new Float32Array(Module.HEAPU8.buffer, distAPtr, 8).set(new Float32Array(distA));
      new Float32Array(Module.HEAPU8.buffer, intrBPtr, 9).set(new Float32Array(intrB));
      new Float32Array(Module.HEAPU8.buffer, distBPtr, 8).set(new Float32Array(distB));
      const hPtr = Module.ccall("getFloatBuffer", "number", ["number"], [9]);
      new Float32Array(Module.HEAPU8.buffer, hPtr, 9).set(new Float32Array(H));
      const mapLen = widthA * heightA;
      const mapXPtr = Module.ccall("getFloatBuffer", "number", ["number"], [mapLen]);
      const mapYPtr = Module.ccall("getFloatBuffer", "number", ["number"], [mapLen]);
      Module.ccall("calcInterRemapUndist", null,
        ["number","number","number","number","number","number","number","number","number","number","number"],
        [intrAPtr, distAPtr, widthA, heightA, intrBPtr, distBPtr, widthB, heightB, hPtr, mapXPtr, mapYPtr]
      );
      const x = new Float32Array(new Float32Array(Module.HEAPU8.buffer, mapXPtr, mapLen));
      const y = new Float32Array(new Float32Array(Module.HEAPU8.buffer, mapYPtr, mapLen));
      const xCopy = new Float32Array(x);
      const yCopy = new Float32Array(y);
      Module.ccall("clearBuffer", null, ["number"], [intrAPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distAPtr]);
      Module.ccall("clearBuffer", null, ["number"], [intrBPtr]);
      Module.ccall("clearBuffer", null, ["number"], [distBPtr]);
      Module.ccall("clearBuffer", null, ["number"], [hPtr]);
      Module.ccall("clearBuffer", null, ["number"], [mapXPtr]);
      Module.ccall("clearBuffer", null, ["number"], [mapYPtr]);
      (self as any).postMessage({ id, ok: true, type: "cv/calcInterRemapUndist", mapX: xCopy.buffer, mapY: yCopy.buffer }, [xCopy.buffer as any, yCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcInterRemapUndist", error: String(e || "unknown error") });
    }
    return;
  }
};
