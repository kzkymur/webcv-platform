export class WasmWorkerClient {
  private worker: Worker;
  private seq = 1;
  private pending = new Map<number, (v: any) => void>();

  constructor() {
    // Use classic worker that loads Emscripten glue via importScripts
    this.worker = new Worker(new URL("./worker.classic.ts", import.meta.url));
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

  dispose() {
    try {
      this.worker.terminate();
    } catch {}
    this.pending.clear();
  }
}
