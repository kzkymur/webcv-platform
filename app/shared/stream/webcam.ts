import { VideoStreamSource, WebGLHandle, CanvasHandle } from "@/shared/stream/types";

async function waitForLive(track: MediaStreamTrack, timeoutMs = 3000): Promise<void> {
  if (track.readyState === "live") return;
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => {
      cleanup();
      reject(new Error("unmute timeout"));
    }, timeoutMs);
    const cleanup = () => {
      try { clearTimeout(to as any); } catch {}
      track.removeEventListener("unmute", onUnmute as any);
      track.removeEventListener("ended", onEnded as any);
    };
    const onUnmute = () => { cleanup(); resolve(); };
    const onEnded = () => { cleanup(); reject(new Error("track ended")); };
    track.addEventListener("unmute", onUnmute as any, { once: true } as any);
    track.addEventListener("ended", onEnded as any, { once: true } as any);
  });
}

export class WebcamSource implements VideoStreamSource {
  private deviceId: string;
  private orig: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }

  async toWebGL(): Promise<WebGLHandle | null> {
    const v = await this.ensureVideo();
    if (!v) return null;
    try { await v.play(); } catch {}
    return { kind: "video", element: v };
  }

  async toCanvas(target: HTMLCanvasElement, opts?: { fitMax?: number }): Promise<CanvasHandle | null> {
    const v = await this.ensureVideo();
    if (!v) return null;
    try { await v.play(); } catch {}
    const ctx = target.getContext("2d");
    if (!ctx) return null;
    let raf = 0;
    const fitMax = opts?.fitMax ?? 640;
    const loop = () => {
      if (v.readyState >= 2) {
        const vw = v.videoWidth || fitMax;
        const vh = v.videoHeight || 1;
        // Fit within a square box of fitMax keeping aspect
        const ratio = Math.min(fitMax / vw, fitMax / vh);
        const cssW = Math.max(1, Math.round(vw * ratio));
        const cssH = Math.max(1, Math.round(vh * ratio));
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
        ctx.drawImage(v, 0, 0, cssW, cssH);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    const stop = () => cancelAnimationFrame(raf);
    const dispose = () => stop();
    // autostart
    start();
    return { start, stop, dispose };
  }

  dispose(): void {
    try { this.video?.pause(); } catch {}
    try { if (this.video) this.video.srcObject = null; } catch {}
    this.video = null;
    try { this.orig?.getTracks().forEach((t) => t.stop()); } catch {}
    this.orig = null;
  }

  private async ensureVideo(): Promise<HTMLVideoElement | null> {
    if (!this.orig) {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: this.deviceId } as any,
          width: { ideal: 4096 },
          height: { ideal: 2160 },
          aspectRatio: 16 / 9,
        },
        audio: false,
      });
      this.orig = s;
      const vt = s.getVideoTracks()[0];
      try { await waitForLive(vt); } catch {}
    }
    if (!this.video) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true as any;
      v.srcObject = this.orig as any;
      this.video = v;
    }
    return this.video;
  }
}
