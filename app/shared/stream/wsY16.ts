import {
  VideoStreamSource,
  WebGLHandle,
  CanvasHandle,
} from "@/shared/stream/types";

type ThermalFrame = {
  w: number;
  h: number;
  scale: number;
  flags: number;
  frameId: number;
  tsUs: number;
  u16: Uint16Array;
};

function parseFrame(buf: ArrayBuffer): ThermalFrame | null {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3)
  );
  if (magic === "L3R1") {
    // L3R1 layout (little endian): headerBytes @6, w@8, h@10, scale@14
    const headerBytes = dv.getUint16(6, true);
    const w = dv.getUint16(8, true);
    const h = dv.getUint16(10, true);
    const scale = dv.getUint16(14, true);
    if (headerBytes + w * h * 2 > dv.byteLength) return null;
    const u16 = new Uint16Array(buf, headerBytes, w * h);
    return { w, h, scale, flags: 0, frameId: 0, tsUs: 0, u16 };
  }
  if (magic === "PT3F") {
    if (dv.byteLength < 28) return null;
    const version = dv.getUint16(4, true);
    const headerBytes = dv.getUint16(6, true);
    const w = dv.getUint16(8, true);
    const h = dv.getUint16(10, true);
    const scale = dv.getUint16(12, true);
    const flags = dv.getUint16(14, true);
    const frameId = dv.getUint32(16, true);
    const tsUs = Number(dv.getBigUint64(20, true));
    if (headerBytes + w * h * 2 > dv.byteLength) return null;
    const u16 = new Uint16Array(buf, headerBytes, w * h);
    return { w, h, scale, flags, frameId, tsUs, u16 };
  }
  return null;
}

// grayscale rendering is implemented in drawLoop via per-frame min/max

export class WebSocketY16Source implements VideoStreamSource {
  private url: string;
  private ws: WebSocket | null = null;
  private latest: ThermalFrame | null = null;
  private running = false;
  private drawRaf = 0;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;

  private vOut: HTMLVideoElement | null = null;
  private streamOut: MediaStream | null = null;

  // display range (Kelvin) default; callers may adjust later if needed
  private kMin = 290.0;
  private kMax = 310.0;

  constructor(url: string) {
    this.url = url;
  }

  private ensureCanvas(w: number, h: number) {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
    }
    if (!this.ctx) this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.img = null;
    }
    if (!this.img) this.img = this.ctx.createImageData(w, h);
  }

  private startSocket() {
    if (this.ws) return;
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      const f = parseFrame(ev.data as ArrayBuffer);
      if (f) this.latest = f; // keep latest only
    };
    ws.onclose = () => {
      this.ws = null;
    };
    ws.onerror = () => {
      /* swallow; latest stays as is */
    };
    this.ws = ws;
  }

  private stopSocket() {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }

  private drawLoop = () => {
    this.drawRaf = requestAnimationFrame(this.drawLoop);
    const f = this.latest;
    if (!f) return;
    if (
      !this.canvas ||
      !this.ctx ||
      !this.img ||
      this.canvas.width !== f.w ||
      this.canvas.height !== f.h
    ) {
      this.ensureCanvas(f.w, f.h);
    }
    if (!this.ctx || !this.img) return;
    const { u16 } = f;
    const data = this.img.data;
    // Compute per-frame min/max in 16-bit raw domain
    let mn = 0xffff, mx = 0;
    for (let i = 0; i < u16.length; i++) {
      const v = u16[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const rng = mx - mn || 1;
    for (let i = 0; i < u16.length; i++) {
      const v = u16[i];
      const g = (((v - mn) * 255) / rng) | 0;
      const j = i * 4;
      data[j] = g; data[j + 1] = g; data[j + 2] = g; data[j + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  };

  private ensureRunning() {
    if (this.running) return;
    this.running = true;
    // Prepare a placeholder canvas so toCanvas() loop has a surface immediately
    this.ensureCanvas(160, 120);
    this.startSocket();
    this.drawRaf = requestAnimationFrame(this.drawLoop);
  }

  async toWebGL(): Promise<WebGLHandle | null> {
    this.ensureRunning();
    // Prepare canvas + captureStream-backed video element
    if (!this.canvas) this.ensureCanvas(160, 120);
    if (!this.canvas) return null;
    if (!this.streamOut) this.streamOut = this.canvas.captureStream();
    if (!this.vOut) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true as any;
      v.srcObject = this.streamOut as any;
      this.vOut = v;
      try {
        await v.play();
      } catch {}
    }
    return { kind: "video", element: this.vOut };
  }

  async toCanvas(target: HTMLCanvasElement, opts?: { fitMax?: number }): Promise<CanvasHandle | null> {
    this.ensureRunning();
    // Make sure an initial canvas exists even before first frame arrives
    if (!this.canvas) this.ensureCanvas(160, 120);
    const ctx = target.getContext("2d");
    if (!ctx) return null;
    let raf = 0;
    const loop = () => {
      if (this.canvas) {
        const srcW = this.canvas.width;
        const srcH = this.canvas.height;
        const fitMax = opts?.fitMax ?? 640;
        const ratio = Math.min(fitMax / srcW, fitMax / srcH) || 1;
        const cssW = Math.max(1, Math.round(srcW * ratio));
        const cssH = Math.max(1, Math.round(srcH * ratio));
        const dpr = window.devicePixelRatio || 1;
        const bufW = Math.max(1, Math.round(cssW * dpr));
        const bufH = Math.max(1, Math.round(cssH * dpr));
        if (target.width !== bufW || target.height !== bufH) {
          target.width = bufW;
          target.height = bufH;
          target.style.width = cssW + "px";
          target.style.height = cssH + "px";
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
        }
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.canvas, 0, 0, cssW, cssH);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const stop = () => cancelAnimationFrame(raf);
    const dispose = () => stop();
    start();
    return { start, stop, dispose };
  }

  dispose(): void {
    cancelAnimationFrame(this.drawRaf);
    this.drawRaf = 0;
    this.running = false;
    this.stopSocket();
    try {
      this.streamOut?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.streamOut = null;
    if (this.vOut) {
      try {
        this.vOut.pause();
      } catch {}
      try {
        (this.vOut as any).srcObject = null;
      } catch {}
    }
    this.vOut = null;
    this.ctx = null;
    this.canvas = null;
    this.img = null;
    this.latest = null;
  }
}
