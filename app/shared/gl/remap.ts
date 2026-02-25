/*
 Minimal WebGL2 remap renderer.
 - Pass 1: undistort source video using per-pixel remap (map XY) → FBO
 - Pass 2: inter-camera remap using map XY sampling from Pass1 → default framebuffer (canvas)
 - Textures for maps are RG32F (interleaved [sx, sy]); sampling uses NEAREST to avoid interpolation on coordinates
 - All coordinates are in pixel units with origin at top-left. Shaders convert to normalized UVs.
*/

export type RemapDims = { width: number; height: number };

function createGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  // preserveDrawingBuffer is required so that readPixels() can be called
  // outside the exact rAF that performed the draw (e.g. from UI handlers).
  // Without it, many browsers clear the default framebuffer after presenting
  // and captures would return all zeros (black images).
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL2 not supported");
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "";
    gl.deleteShader(sh);
    throw new Error("Shader compile failed: " + log);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || "";
    gl.deleteProgram(prog);
    throw new Error("Program link failed: " + log);
  }
  return prog;
}

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv_top; // top-left origin uv
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  // Convert NDC [-1,1] to uv with top-left origin: (x:0..1, y:0..1 top→bottom)
  v_uv_top = vec2(0.5 * (a_pos.x + 1.0), 0.5 * (1.0 - a_pos.y));
}
`;

const FS_REMAP = `#version 300 es
precision highp float;
in vec2 v_uv_top; // dest pixel in [0,1] with top-left origin
out vec4 outColor;
uniform sampler2D uSrc;   // source image
uniform sampler2D uMapXY; // RG32F, dest-sized, pixel units (source coordinate x,y)
uniform vec2 uSrcSize;    // source image size in pixels (actual)
uniform vec2 uMapSrcSize; // size (W,H) that map's pixel coordinates are based on

void main(){
  // Read source coords (pixel units in map's reference space)
  vec2 sxy = texture(uMapXY, v_uv_top).rg;
  float sx = sxy.r;
  float sy = sxy.g;
  // Convert to UV on actual source texture. See analysis: divide by map's reference size.
  vec2 uvSrc = vec2(sx / uMapSrcSize.x, sy / uMapSrcSize.y);
  // Sample with linear filtering and clamp-to-edge to avoid NaNs outside
  vec4 c = texture(uSrc, uvSrc);
  outColor = c;
}
`;

// Fullscreen quad positions
const QUAD = new Float32Array([
  -1, -1,  +1, -1,  -1, +1,
  -1, +1,  +1, -1,  +1, +1,
]);

export class RemapRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;

  // Textures
  private texVideo: WebGLTexture | null = null;       // raw video
  private texUndist: WebGLTexture | null = null;      // undistorted B
  private texUndistMapXY: WebGLTexture | null = null; // RG32F
  private texInterMapXY: WebGLTexture | null = null;  // RG32F

  private fboUndist: WebGLFramebuffer | null = null;

  private undistSize: RemapDims | null = null; // B undist/output size of pass 1
  private interDestSize: RemapDims | null = null; // A size (=canvas buffer size)

  private videoEl: HTMLVideoElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = (this.gl = createGL(canvas));
    // Flip Y on upload so that sampling with top-left–origin UVs matches
    // the top-left–origin image/map data (HTMLVideoElement, Float32Array maps).
    // This avoids a vertical inversion when rendering to the canvas.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.prog = link(gl, VS, FS_REMAP);
    const vao = (this.vao = gl.createVertexArray());
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    [this.texVideo, this.texUndist, this.texUndistMapXY, this.texInterMapXY]
      .forEach((t) => t && gl.deleteTexture(t));
    if (this.fboUndist) gl.deleteFramebuffer(this.fboUndist);
    if (this.vao) gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
  }

  setSourceVideo(video: HTMLVideoElement | null) {
    this.videoEl = video;
    if (!video) return;
    const gl = this.gl;
    if (!this.texVideo) this.texVideo = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // no orientation toggles in the original implementation

  setUndistMapXY(mapXY: Float32Array, size: RemapDims) {
    const gl = this.gl;
    // Allocate undist output texture + FBO
    if (!this.texUndist) this.texUndist = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texUndist);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!this.fboUndist) this.fboUndist = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboUndist);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texUndist, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Upload map texture (RG32F)
    if (!this.texUndistMapXY) this.texUndistMapXY = gl.createTexture();
    this.uploadRG32F(this.texUndistMapXY, mapXY, size.width, size.height);
    this.undistSize = { ...size };
  }

  setInterMapXY(mapXY: Float32Array, destSize: RemapDims) {
    const gl = this.gl;
    if (!this.texInterMapXY) this.texInterMapXY = gl.createTexture();
    this.uploadRG32F(this.texInterMapXY, mapXY, destSize.width, destSize.height);
    this.interDestSize = { ...destSize };
    // Also size the canvas' backing store to destSize; CSS can scale it
    if (this.canvas.width !== destSize.width || this.canvas.height !== destSize.height) {
      this.canvas.width = destSize.width;
      this.canvas.height = destSize.height;
    }
  }

  private uploadRG32F(tex: WebGLTexture, data: Float32Array, width: number, height: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG32F,
      width,
      height,
      0,
      gl.RG,
      gl.FLOAT,
      data
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  render(): boolean {
    const gl = this.gl;
    const prog = this.prog;
    const v = this.videoEl;
    if (!v || v.readyState < 2) return false;
    if (!this.undistSize || !this.interDestSize) return false;
    if (!this.texVideo || !this.texUndist || !this.texUndistMapXY || !this.texInterMapXY) return false;

    // Update video texture
    gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    // Upload current frame; keep UNPACK_FLIP_Y disabled (we use top-left uv)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);

    // Common state
    gl.useProgram(prog);
    const locSrc = gl.getUniformLocation(prog, "uSrc");
    const locMapXY = gl.getUniformLocation(prog, "uMapXY");
    const locSrcSize = gl.getUniformLocation(prog, "uSrcSize");
    const locMapSrcSize = gl.getUniformLocation(prog, "uMapSrcSize");
    

    // Pass 1: undistort (dest = undistSize, src = video)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboUndist);
    gl.viewport(0, 0, this.undistSize.width, this.undistSize.height);
    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    gl.uniform1i(locSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texUndistMapXY);
    gl.uniform1i(locMapXY, 1);
    gl.uniform2f(locSrcSize, v.videoWidth, v.videoHeight);
    gl.uniform2f(locMapSrcSize, this.undistSize.width, this.undistSize.height);
    this.drawQuad();

    // Pass 2: inter-camera remap (dest = canvas/interDestSize, src = texUndist)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.interDestSize.width, this.interDestSize.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texUndist);
    gl.uniform1i(locSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texInterMapXY);
    gl.uniform1i(locMapXY, 1);
    gl.uniform2f(locSrcSize, this.undistSize.width, this.undistSize.height);
    gl.uniform2f(locMapSrcSize, this.undistSize.width, this.undistSize.height);
    this.drawQuad();

    return true;
  }

  // Returns RGBA8 buffer with top-left origin
  readPixels(): Uint8Array {
    if (!this.interDestSize) return new Uint8Array();
    const gl = this.gl;
    const w = this.interDestSize.width, h = this.interDestSize.height;
    const tmp = new Uint8Array(w * h * 4);
    gl.readBuffer?.(gl.BACK); // no-op on some browsers
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
    // Flip vertically to convert bottom-left to top-left orientation
    const out = new Uint8Array(tmp.length);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      out.set(tmp.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    return out;
  }

  getOutputSize(): RemapDims | null {
    return this.interDestSize ? { ...this.interDestSize } : null;
  }
}
