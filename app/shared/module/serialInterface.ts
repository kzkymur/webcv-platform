// TeencyCommunicator was removed; SerialCommunicator below is the single source.

// Web Serial adapter that exposes the legacy-friendly API used across pages.
// This consolidates the implementation in this file as requested and removes
// the need for app/shared/hardware/serial.ts.
export class SerialCommunicator {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private writeChain: Promise<void> = Promise.resolve();
  private writeEpoch = 0;
  private pendingRealtimeGalvoLine: string | null = null;
  private realtimeGalvoPumpRunning = false;
  private realtimeGalvoEnabled = true;

  async connect(): Promise<boolean> {
    try {
      this.port = await (navigator as any).serial.requestPort();
      if (!this.port) return false;
      await this.port.open({ baudRate: 115200 });
      this.writer = (
        this.port.writable as WritableStream<Uint8Array>
      ).getWriter();
      this.writeChain = Promise.resolve();
      this.writeEpoch = 0;
      this.pendingRealtimeGalvoLine = null;
      this.realtimeGalvoPumpRunning = false;
      this.realtimeGalvoEnabled = true;
      await this.enqueueWrite("HELLO");
      return true;
    } catch (e) {
      console.warn("Serial connect error", e);
      this.port = null;
      this.writer = null;
      return false;
    }
  }

  async disconnect() {
    this.disableRealtimeGalvo();
    this.writeEpoch += 1;
    try {
      await this.writeChain.catch(() => {});
    } catch {}
    try {
      await this.writer?.close();
    } catch {}
    try {
      await this.port?.close();
    } catch {}
    this.writer = null;
    this.port = null;
    this.writeChain = Promise.resolve();
    this.writeEpoch = 0;
  }

  private enqueueWrite(line: string, epoch: number = this.writeEpoch): Promise<void> {
    const op = this.writeChain.then(async () => {
      if (epoch !== this.writeEpoch) return;
      if (!this.writer) throw new Error("Serial not connected");
      await this.writer.write(this.encoder.encode(line + "\n"));
    });
    this.writeChain = op.catch(() => {});
    return op;
  }

  private formatGalvoLine(x: number, y: number): string {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    return `B${xi},${yi}`;
  }

  private async drainRealtimeGalvo(): Promise<void> {
    try {
      while (this.realtimeGalvoEnabled && this.pendingRealtimeGalvoLine) {
        const line = this.pendingRealtimeGalvoLine;
        this.pendingRealtimeGalvoLine = null;
        await this.enqueueWrite(line);
      }
    } finally {
      this.realtimeGalvoPumpRunning = false;
      if (this.realtimeGalvoEnabled && this.pendingRealtimeGalvoLine) {
        this.realtimeGalvoPumpRunning = true;
        void this.drainRealtimeGalvo();
      }
    }
  }

  enableRealtimeGalvo() {
    this.realtimeGalvoEnabled = true;
  }

  disableRealtimeGalvo() {
    this.realtimeGalvoEnabled = false;
    this.pendingRealtimeGalvoLine = null;
  }

  setGalvoPosLatest(x: number, y: number) {
    if (!this.realtimeGalvoEnabled) return;
    this.pendingRealtimeGalvoLine = this.formatGalvoLine(x, y);
    if (this.realtimeGalvoPumpRunning) return;
    this.realtimeGalvoPumpRunning = true;
    void this.drainRealtimeGalvo();
  }

  async setLaserOutput(percent: number) {
    const p = Math.max(0, Math.min(100, Math.floor(percent)));
    await this.enqueueWrite(`A${p}`);
  }

  async emergencyLaserOff() {
    this.disableRealtimeGalvo();
    const epoch = ++this.writeEpoch;
    await this.enqueueWrite("A0", epoch);
  }

  async setGalvoPos(x: number, y: number) {
    await this.enqueueWrite(this.formatGalvoLine(x, y));
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
