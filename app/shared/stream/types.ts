export type WebGLHandle = {
  kind: "video";
  element: HTMLVideoElement;
};

export type CanvasHandle = {
  start: () => void;
  stop: () => void;
  dispose: () => void;
};

export interface VideoStreamSource {
  // Provide a WebGL-friendly input. For now we standardize on HTMLVideoElement.
  toWebGL(): Promise<WebGLHandle | null>;
  // Continuously draws into a target canvas. Returns a controller for lifecycle.
  toCanvas(target: HTMLCanvasElement, opts?: { fitMax?: number }): Promise<CanvasHandle | null>;
  // Release all underlying resources (tracks, processors, elements).
  dispose(): void;
}

