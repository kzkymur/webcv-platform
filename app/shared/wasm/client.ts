export class WasmWorkerClient {
  private worker: Worker;
  private seq = 1;
  private pending = new Map<number, (v: any) => void>();

  constructor() {
    // Use module worker so the bundled glue can use import.meta
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev) => {
      const { id } = ev.data || {};
      const cb = this.pending.get(id);
      if (cb) {
        this.pending.delete(id);
        cb(ev.data);
      }
    };
  }

  private req<T = any>(payload: any): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, ...payload });
    });
  }

  async ping() {
    return this.req({ type: "ping" });
  }

  async cvFindChessboardCorners(rgba: Uint8ClampedArray, width: number, height: number) {
    const res = await this.req<{ ok: true; type: string; found: boolean; points: ArrayBuffer}>({
      type: "cv/findChessboardCorners",
      width,
      height,
      rgba: rgba.buffer,
    });
    return { found: res.found, points: new Float32Array(res.points) };
  }

  async cvCalcInnerParams(width: number, height: number, pointsList: Float32Array[]) {
    const res = await this.req<{ ok: boolean; okFlag?: boolean; intr?: ArrayBuffer; dist?: ArrayBuffer } | any>({
      type: "cv/calcInnerParams",
      width,
      height,
      pointsList: pointsList.map((p) => p.buffer),
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcInnerParams failed");
    return { ok: !!res.okFlag, intr: new Float32Array(res.intr), dist: new Float32Array(res.dist) };
  }

  async cvCalcUndistMap(width: number, height: number, intr: Float32Array, dist: Float32Array) {
    const res = await this.req<{ ok: boolean; mapX?: ArrayBuffer; mapY?: ArrayBuffer } | any>({
      type: "cv/calcUndistMap",
      width,
      height,
      intr: intr.buffer,
      dist: dist.buffer,
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcUndistMap failed");
    return { mapX: new Float32Array(res.mapX), mapY: new Float32Array(res.mapY) };
  }

  async cvCalcUndistMapFisheye(width: number, height: number, intr: Float32Array, dist: Float32Array) {
    const res = await this.req<{ ok: boolean; mapX?: ArrayBuffer; mapY?: ArrayBuffer } | any>({
      type: "cv/calcUndistMapFisheye",
      width,
      height,
      intr: intr.buffer,
      dist: dist.buffer,
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcUndistMapFisheye failed");
    return { mapX: new Float32Array(res.mapX), mapY: new Float32Array(res.mapY) };
  }

  async cvCalcHomography(aPoints: Float32Array, bPoints: Float32Array) {
    const res = await this.req<{ ok: boolean; H?: ArrayBuffer } | any>({
      type: "cv/calcHomography",
      aPoints: aPoints.buffer,
      bPoints: bPoints.buffer,
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcHomography failed");
    return { H: new Float32Array(res.H) };
  }

  async cvCalcInnerParamsExt(width: number, height: number, pointsList: Float32Array[]) {
    const res = await this.req<{ ok: boolean; okFlag?: boolean; intr?: ArrayBuffer; dist?: ArrayBuffer; rvecs?: ArrayBuffer; tvecs?: ArrayBuffer } | any>({
      type: "cv/calcInnerParamsExt",
      width,
      height,
      pointsList: pointsList.map((p) => p.buffer),
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcInnerParamsExt failed");
    return { ok: !!res.okFlag, intr: new Float32Array(res.intr), dist: new Float32Array(res.dist), rvecs: new Float32Array(res.rvecs), tvecs: new Float32Array(res.tvecs) };
  }

  async cvCalcInnerParamsFisheyeExt(width: number, height: number, pointsList: Float32Array[]) {
    const res = await this.req<{ ok: boolean; okFlag?: boolean; intr?: ArrayBuffer; dist?: ArrayBuffer; rvecs?: ArrayBuffer; tvecs?: ArrayBuffer } | any>({
      type: "cv/calcInnerParamsFisheyeExt",
      width,
      height,
      pointsList: pointsList.map((p) => p.buffer),
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcInnerParamsFisheyeExt failed");
    return { ok: !!res.okFlag, intr: new Float32Array(res.intr), dist: new Float32Array(res.dist), rvecs: new Float32Array(res.rvecs), tvecs: new Float32Array(res.tvecs) };
  }

  async cvCalcHomographyUndist(aPoints: Float32Array, bPoints: Float32Array, intrA: Float32Array, distA: Float32Array, intrB: Float32Array, distB: Float32Array) {
    const res = await this.req<{ ok: boolean; H?: ArrayBuffer } | any>({
      type: "cv/calcHomographyUndist",
      aPoints: aPoints.buffer,
      bPoints: bPoints.buffer,
      intrA: intrA.buffer,
      distA: distA.buffer,
      intrB: intrB.buffer,
      distB: distB.buffer,
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcHomographyUndist failed");
    return { H: new Float32Array(res.H) };
  }

  async cvCalcHomographyUndistQuality(aPoints: Float32Array, bPoints: Float32Array, intrA: Float32Array, distA: Float32Array, intrB: Float32Array, distB: Float32Array) {
    const res = await this.req<{ ok: boolean; H?: ArrayBuffer; metrics?: ArrayBuffer } | any>({
      type: "cv/calcHomographyUndistQuality",
      aPoints: aPoints.buffer,
      bPoints: bPoints.buffer,
      intrA: intrA.buffer,
      distA: distA.buffer,
      intrB: intrB.buffer,
      distB: distB.buffer,
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcHomographyUndistQuality failed");
    const H = new Float32Array(res.H);
    const m = new Float32Array(res.metrics);
    const rmse = m[0] ?? Number.NaN;
    const inliers = m[1] ?? 0;
    const total = (aPoints.length / 2) | 0;
    const inlierRatio = total > 0 ? inliers / total : 0;
    return { H, rmse, inliers, total, inlierRatio };
  }

  async cvCalcInterRemapUndist(widthA: number, heightA: number, widthB: number, heightB: number, intrA: Float32Array, distA: Float32Array, intrB: Float32Array, distB: Float32Array, H: Float32Array) {
    const res = await this.req<{ ok: boolean; mapX?: ArrayBuffer; mapY?: ArrayBuffer } | any>({
      type: "cv/calcInterRemapUndist",
      widthA,
      heightA,
      widthB,
      heightB,
      intrA: intrA.buffer,
      distA: distA.buffer,
      intrB: intrB.buffer,
      distB: distB.buffer,
      H: H.buffer,
    });
    if (!res?.ok) throw new Error(res?.error || "cv/calcInterRemapUndist failed");
    return { mapX: new Float32Array(res.mapX), mapY: new Float32Array(res.mapY) };
  }

  dispose() {
    try {
      this.worker.terminate();
    } catch {}
    this.pending.clear();
  }
}
