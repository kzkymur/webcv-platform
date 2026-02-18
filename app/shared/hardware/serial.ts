export class SerialCommunicator {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  async connect(): Promise<boolean> {
    try {
      // Request user to choose a port; do not auto-connect
      this.port = await (navigator as any).serial.requestPort();
      if (!this.port) return false;
      await this.port.open({ baudRate: 115200 });
      const encoder = new TextEncoder();
      this.writer = (this.port.writable as WritableStream<Uint8Array>).getWriter();
      // simple hello
      await this.writer.write(encoder.encode("HELLO\n"));
      return true;
    } catch (e) {
      console.warn("Serial connect error", e);
      this.port = null;
      this.writer = null;
      return false;
    }
  }

  async disconnect() {
    try {
      await this.writer?.close();
    } catch {}
    try {
      await this.port?.close();
    } catch {}
    this.writer = null;
    this.port = null;
  }

  private async send(line: string) {
    if (!this.writer) throw new Error("Serial not connected");
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(line + "\n"));
  }

  // Teensy firmware protocol (AGENTS.md):
  // Mode A sets laser PWM/DAC duty (0–100)
  async setLaserOutput(percent: number) {
    const p = Math.max(0, Math.min(100, Math.floor(percent)));
    await this.send(`A${p}`);
  }

  // Mode B sets galvo XY (XY2-100). Use with extreme care.
  async setGalvoPos(x: number, y: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    await this.send(`B${xi},${yi}`);
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
