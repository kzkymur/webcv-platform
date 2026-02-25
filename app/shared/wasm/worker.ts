// ESM worker: loads the Emscripten module via import and exposes the same API
// that the classic worker did, but without importScripts.
import { WMF32A, WMU32A, WMU8A } from "./memory-core";

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
    const img = new WMU8A(Module as any, src.length);
    img.data = src;
    const N = 10 * 7;
    const out = new WMF32A(Module as any, N * 2);
    const found = !!(Module as any).ccall(
      "findChessboardCorners",
      "number",
      ["number", "number", "number", "number"],
      [img.pointer, width, height, out.pointer]
    );
    const copy = out.data;
    img.clear();
    out.clear();
    (self as any).postMessage({ id, ok: true, type: "cv/findChessboardCorners", found, points: copy.buffer }, [copy.buffer as any]);
    return;
  }

  // cv/calcInnerParams
  if (type === "cv/calcInnerParams") {
    const { width, height, pointsList } = ev.data as { id: number; type: string; width: number; height: number; pointsList: ArrayBuffer[] };
    const Module = await getModule();
    try {
      const N = (pointsList || []).length;
      const ptrArr = new WMU32A(Module as any, N);
      const base = (ptrArr.pointer as number) >>> 2;
      const tmp: WMF32A[] = [];
      for (let i = 0; i < N; i++) {
        const srcPts = new Float32Array(pointsList[i]);
        const buf = new WMF32A(Module as any, srcPts.length);
        buf.data = srcPts;
        (Module as any).HEAPU32[base + i] = buf.pointer as number;
        tmp.push(buf);
      }
      const intr = new WMF32A(Module as any, 9);
      const dist = new WMF32A(Module as any, 8);
      const ok = !!(Module as any).ccall(
        "calcInnerParams",
        "number",
        ["number", "number", "number", "number", "number", "number"],
        [ptrArr.pointer, N, width, height, intr.pointer, dist.pointer]
      );
      const intrCopy = intr.data;
      const distCopy = dist.data;
      for (const b of tmp) b.clear();
      ptrArr.clear();
      intr.clear();
      dist.clear();
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
      const intrPtr = new WMF32A(Module as any, 9);
      const distPtr = new WMF32A(Module as any, 8);
      intrPtr.data = new Float32Array(intr);
      distPtr.data = new Float32Array(dist);
      const mapLen = width * height;
      const mapXPtr = new WMF32A(Module as any, mapLen);
      const mapYPtr = new WMF32A(Module as any, mapLen);
      (Module as any).ccall(
        "calcUndistMap",
        null,
        ["number", "number", "number", "number", "number", "number"],
        [intrPtr.pointer, distPtr.pointer, width, height, mapXPtr.pointer, mapYPtr.pointer]
      );
      const xCopy = mapXPtr.data;
      const yCopy = mapYPtr.data;
      intrPtr.clear();
      distPtr.clear();
      mapXPtr.clear();
      mapYPtr.clear();
      (self as any).postMessage({ id, ok: true, type: "cv/calcUndistMap", mapX: xCopy.buffer, mapY: yCopy.buffer }, [xCopy.buffer as any, yCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcUndistMap", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcUndistMapFisheye
  if (type === "cv/calcUndistMapFisheye") {
    const { width, height, intr, dist } = ev.data as { id: number; type: string; width: number; height: number; intr: ArrayBuffer; dist: ArrayBuffer };
    const Module = await getModule();
    try {
      const intrPtr = new WMF32A(Module as any, 9);
      const distPtr = new WMF32A(Module as any, 4);
      intrPtr.data = new Float32Array(intr);
      distPtr.data = new Float32Array(dist);
      const mapLen = width * height;
      const mapXPtr = new WMF32A(Module as any, mapLen);
      const mapYPtr = new WMF32A(Module as any, mapLen);
      (Module as any).ccall(
        "calcUndistMapFisheye",
        null,
        ["number", "number", "number", "number", "number", "number"],
        [intrPtr.pointer, distPtr.pointer, width, height, mapXPtr.pointer, mapYPtr.pointer]
      );
      const xCopy = mapXPtr.data;
      const yCopy = mapYPtr.data;
      intrPtr.clear();
      distPtr.clear();
      mapXPtr.clear();
      mapYPtr.clear();
      (self as any).postMessage({ id, ok: true, type: "cv/calcUndistMapFisheye", mapX: xCopy.buffer, mapY: yCopy.buffer }, [xCopy.buffer as any, yCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcUndistMapFisheye", error: String(e || "unknown error") });
    }
    return;
  }

  // cv/calcHomography
  if (type === "cv/calcHomography") {
    const { aPoints, bPoints } = ev.data as any;
    const Module = await getModule();
    try {
      const n = Math.min(new Float32Array(aPoints).length, new Float32Array(bPoints).length) / 2;
      const aPtr = new WMF32A(Module as any, n * 2);
      const bPtr = new WMF32A(Module as any, n * 2);
      aPtr.data = new Float32Array(aPoints).subarray(0, n * 2);
      bPtr.data = new Float32Array(bPoints).subarray(0, n * 2);
      const hPtr = new WMF32A(Module as any, 9);
      (Module as any).ccall("calcHomography", null, ["number", "number", "number", "number"], [aPtr.pointer, bPtr.pointer, n, hPtr.pointer]);
      const hCopy = hPtr.data;
      aPtr.clear();
      bPtr.clear();
      hPtr.clear();
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
      const ptrArr = new WMU32A(Module as any, N);
      const base = (ptrArr.pointer as number) >>> 2;
      const tmp: WMF32A[] = [];
      for (let i = 0; i < N; i++) {
        const src = new Float32Array(pointsList[i]);
        const p = new WMF32A(Module as any, src.length);
        p.data = src;
        (Module as any).HEAPU32[base + i] = p.pointer as number;
        tmp.push(p);
      }
      const intrPtr = new WMF32A(Module as any, 9);
      const distPtr = new WMF32A(Module as any, 8);
      const rvecsPtr = new WMF32A(Module as any, N * 3);
      const tvecsPtr = new WMF32A(Module as any, N * 3);
      const ok = !!(Module as any).ccall(
        "calcInnerParamsExt",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [ptrArr.pointer, N, width, height, intrPtr.pointer, distPtr.pointer, rvecsPtr.pointer, tvecsPtr.pointer]
      );
      const intrCopy = intrPtr.data;
      const distCopy = distPtr.data;
      const rCopy = rvecsPtr.data;
      const tCopy = tvecsPtr.data;
      for (const p of tmp) p.clear();
      ptrArr.clear();
      intrPtr.clear();
      distPtr.clear();
      rvecsPtr.clear();
      tvecsPtr.clear();
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
      const ptrArr = new WMU32A(Module as any, N);
      const base = (ptrArr.pointer as number) >>> 2;
      const tmp: WMF32A[] = [];
      for (let i = 0; i < N; i++) {
        const src = new Float32Array(pointsList[i]);
        const p = new WMF32A(Module as any, src.length);
        p.data = src;
        (Module as any).HEAPU32[base + i] = p.pointer as number;
        tmp.push(p);
      }
      const intrPtr = new WMF32A(Module as any, 9);
      const distPtr = new WMF32A(Module as any, 4);
      const rvecsPtr = new WMF32A(Module as any, N * 3);
      const tvecsPtr = new WMF32A(Module as any, N * 3);
      const ok = !!(Module as any).ccall(
        "calcInnerParamsFisheyeExt",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [ptrArr.pointer, N, width, height, intrPtr.pointer, distPtr.pointer, rvecsPtr.pointer, tvecsPtr.pointer]
      );
      const intrCopy = intrPtr.data;
      const distCopy = distPtr.data;
      const rCopy = rvecsPtr.data;
      const tCopy = tvecsPtr.data;
      for (const p of tmp) p.clear();
      ptrArr.clear();
      intrPtr.clear();
      distPtr.clear();
      rvecsPtr.clear();
      tvecsPtr.clear();
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
      const aPtr = new WMF32A(Module as any, n * 2);
      const bPtr = new WMF32A(Module as any, n * 2);
      aPtr.data = new Float32Array(aPoints).subarray(0, n * 2);
      bPtr.data = new Float32Array(bPoints).subarray(0, n * 2);
      const intrAPtr = new WMF32A(Module as any, 9);
      const distAPtr = new WMF32A(Module as any, 8);
      const intrBPtr = new WMF32A(Module as any, 9);
      const distBPtr = new WMF32A(Module as any, 8);
      intrAPtr.data = new Float32Array(intrA);
      distAPtr.data = new Float32Array(distA);
      intrBPtr.data = new Float32Array(intrB);
      distBPtr.data = new Float32Array(distB);
      const hPtr = new WMF32A(Module as any, 9);
      (Module as any).ccall(
        "calcHomographyUndist",
        null,
        ["number","number","number","number","number","number","number","number"],
        [aPtr.pointer, bPtr.pointer, n, intrAPtr.pointer, distAPtr.pointer, intrBPtr.pointer, distBPtr.pointer, hPtr.pointer]
      );
      const hCopy = hPtr.data;
      aPtr.clear();
      bPtr.clear();
      intrAPtr.clear();
      distAPtr.clear();
      intrBPtr.clear();
      distBPtr.clear();
      hPtr.clear();
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
      const aPtr = new WMF32A(Module as any, n * 2);
      const bPtr = new WMF32A(Module as any, n * 2);
      aPtr.data = new Float32Array(aPoints).subarray(0, n * 2);
      bPtr.data = new Float32Array(bPoints).subarray(0, n * 2);
      const intrAPtr = new WMF32A(Module as any, 9);
      const distAPtr = new WMF32A(Module as any, 8);
      const intrBPtr = new WMF32A(Module as any, 9);
      const distBPtr = new WMF32A(Module as any, 8);
      intrAPtr.data = new Float32Array(intrA);
      distAPtr.data = new Float32Array(distA);
      intrBPtr.data = new Float32Array(intrB);
      distBPtr.data = new Float32Array(distB);
      const hPtr = new WMF32A(Module as any, 9);
      const mPtr = new WMF32A(Module as any, 2);
      (Module as any).ccall(
        "calcHomographyUndistQuality",
        null,
        ["number","number","number","number","number","number","number","number","number"],
        [aPtr.pointer, bPtr.pointer, n, intrAPtr.pointer, distAPtr.pointer, intrBPtr.pointer, distBPtr.pointer, hPtr.pointer, mPtr.pointer]
      );
      const hCopy = hPtr.data;
      const mCopy = mPtr.data;
      aPtr.clear();
      bPtr.clear();
      intrAPtr.clear();
      distAPtr.clear();
      intrBPtr.clear();
      distBPtr.clear();
      hPtr.clear();
      mPtr.clear();
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
      const intrAPtr = new WMF32A(Module as any, 9);
      const distAPtr = new WMF32A(Module as any, 8);
      const intrBPtr = new WMF32A(Module as any, 9);
      const distBPtr = new WMF32A(Module as any, 8);
      intrAPtr.data = new Float32Array(intrA);
      distAPtr.data = new Float32Array(distA);
      intrBPtr.data = new Float32Array(intrB);
      distBPtr.data = new Float32Array(distB);
      const hPtr = new WMF32A(Module as any, 9);
      hPtr.data = new Float32Array(H);
      const mapLen = widthA * heightA;
      const mapXPtr = new WMF32A(Module as any, mapLen);
      const mapYPtr = new WMF32A(Module as any, mapLen);
      (Module as any).ccall(
        "calcInterRemapUndist",
        null,
        ["number","number","number","number","number","number","number","number","number","number","number"],
        [intrAPtr.pointer, distAPtr.pointer, widthA, heightA, intrBPtr.pointer, distBPtr.pointer, widthB, heightB, hPtr.pointer, mapXPtr.pointer, mapYPtr.pointer]
      );
      const xCopy = mapXPtr.data;
      const yCopy = mapYPtr.data;
      intrAPtr.clear();
      distAPtr.clear();
      intrBPtr.clear();
      distBPtr.clear();
      hPtr.clear();
      mapXPtr.clear();
      mapYPtr.clear();
      (self as any).postMessage({ id, ok: true, type: "cv/calcInterRemapUndist", mapX: xCopy.buffer, mapY: yCopy.buffer }, [xCopy.buffer as any, yCopy.buffer as any]);
    } catch (e) {
      (self as any).postMessage({ id, ok: false, type: "cv/calcInterRemapUndist", error: String(e || "unknown error") });
    }
    return;
  }
};
