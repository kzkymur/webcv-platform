import { crampGalvoCoordinate, GALVO_MAX_X, GALVO_MAX_Y } from "@/shared/util/calcHomography";

// TeencyCommunicator was removed; SerialCommunicator below is the single source.

// Web Serial adapter that exposes the legacy-friendly API used across pages.
// This consolidates the implementation in this file as requested and removes
// the need for app/shared/hardware/serial.ts.
export class SerialCommunicator {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private encoder = new TextEncoder();

  async connect(): Promise<boolean> {
    try {
      this.port = await (navigator as any).serial.requestPort();
      if (!this.port) return false;
      await this.port.open({ baudRate: 115200 });
      this.writer = (this.port.writable as WritableStream<Uint8Array>).getWriter();
      await this.writer.write(this.encoder.encode("HELLO\n"));
      return true;
    } catch (e) {
      console.warn("Serial connect error", e);
      this.port = null;
      this.writer = null;
      return false;
    }
  }

  async disconnect() {
    try { await this.writer?.close(); } catch {}
    try { await this.port?.close(); } catch {}
    this.writer = null;
    this.port = null;
  }

  private async send(line: string) {
    if (!this.writer) throw new Error("Serial not connected");
    await this.writer.write(this.encoder.encode(line + "\n"));
  }

  async setLaserOutput(percent: number) {
    const p = Math.max(0, Math.min(100, Math.floor(percent)));
    await this.send(`A${p}`);
  }

  async setGalvoPos(x: number, y: number) {
    // Apply legacy center-shift + wrap, then clamp (old behavior)
    const clamped = crampGalvoCoordinate({ x, y });
    const sx = (clamped.x + GALVO_MAX_X / 2 + 1) % (GALVO_MAX_X + 1);
    const sy = (clamped.y + GALVO_MAX_Y / 2 + 1) % (GALVO_MAX_Y + 1);
    await this.send(`B${Math.floor(sx)},${Math.floor(sy)}`);

    /*
    // Newer/raw implementation (no center shift, direct send):
    // Source: removed app/shared/hardware/serial.ts
    // Uncomment to use raw XY (ensure downstream expects this convention)
    // const xi = Math.floor(x);
    // const yi = Math.floor(y);
    // await this.send(`B${xi},${yi}`);
    */
  }
}

declare global {
  interface Navigator {
    serial: {
      requestPort(opts?: any): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
    };
  }
  interface SerialPort {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    readable?: ReadableStream<Uint8Array> | null;
    writable?: WritableStream<Uint8Array> | null;
  }
}
