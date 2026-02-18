import { Brand } from "@/shared/util";

interface EmscriptenModuleWithCcall extends EmscriptenModule {
  ccall: (...args: any[]) => any;
}

export type U8AP = Brand<number, "U8AP">;
export type U32AP = Brand<number, "U32AP">;
export type I32AP = Brand<number, "I32AP">;
export type F32AP = Brand<number, "F32AP">;
export type F64AP = Brand<number, "F64AP">;

export default class ModuleWrapper {
  private module: EmscriptenModuleWithCcall;

  constructor(module: EmscriptenModule) {
    this.module = module as EmscriptenModuleWithCcall;
  }

  public getU8Buffer(size: number): U8AP {
    return this.module.ccall(
      "getU8Buffer",
      "number",
      ["number"],
      [size]
    ) as U8AP;
  }

  public getU32Buffer(size: number): U32AP {
    return this.module.ccall(
      "getU32Buffer",
      "number",
      ["number"],
      [size]
    ) as U32AP;
  }

  public getI32Buffer(size: number): I32AP {
    return this.module.ccall(
      "getI32Buffer",
      "number",
      ["number"],
      [size]
    ) as I32AP;
  }

  public getF32Buffer(size: number): F32AP {
    return this.module.ccall(
      "getFloatBuffer",
      "number",
      ["number"],
      [size]
    ) as F32AP;
  }

  public getF64Buffer(size: number): F64AP {
    return this.module.ccall(
      "getDoubleBuffer",
      "number",
      ["number"],
      [size]
    ) as F64AP;
  }

  public clearBuffer(pointer: number): void {
    this.module.ccall("clearBuffer", null, ["number"], [pointer]);
    return;
  }

  public timesBy2(
    pointer: U8AP | U32AP,
    width: number,
    height: number,
    dest: U8AP | U32AP
  ): number {
    return this.module.ccall(
      "timesBy2",
      "number",
      ["number", "number", "number", "number"],
      [pointer, width, height, dest]
    );
  }

  public findChessboardCorners(
    pointer: U8AP,
    width: number,
    height: number,
    cornersImgDest: F32AP
  ): boolean {
    return this.module.ccall(
      "findChessboardCorners",
      "boolean",
      ["number", "number", "number", "number"],
      [pointer, width, height, cornersImgDest]
    );
  }

  public calcInnerParams(
    pointer: U32AP,
    nPointer: number,
    width: number,
    height: number,
    cameraMatDest: F32AP,
    distCoeffsDest: F32AP
  ): boolean {
    return this.module.ccall(
      "calcInnerParams",
      "boolean",
      ["number", "number", "number", "number", "number", "number"],
      [pointer, nPointer, width, height, cameraMatDest, distCoeffsDest]
    );
  }

  public calcUndistMap(
    intr: F32AP,
    dist: F32AP,
    width: number,
    height: number,
    mapXDest: F32AP,
    mapYDest: F32AP
  ): null {
    return this.module.ccall(
      "calcUndistMap",
      null,
      ["number", "number", "number", "number", "number", "number"],
      [intr, dist, width, height, mapXDest, mapYDest]
    );
  }

  public undistort(
    org: U8AP,
    width: number,
    height: number,
    mapX: F32AP,
    mapY: F32AP,
    dest: U8AP
  ): null {
    return this.module.ccall(
      "undistort",
      null,
      ["number", "number", "number", "number", "number", "number"],
      [org, width, height, mapX, mapY, dest]
    );
  }

  public undistortPoint(
    x: number,
    y: number,
    cameraMat: F32AP,
    distCoeffs: F32AP,
    dest: F32AP
  ): null {
    return this.module.ccall(
      "undistortPoint",
      null,
      ["number", "number", "number", "number", "number"],
      [x, y, cameraMat, distCoeffs, dest]
    );
  }

  public calcHomography(
    galvoDots: F32AP,
    cameraDots: F32AP,
    size: number,
    dest: F32AP
  ): null {
    return this.module.ccall(
      "calcHomography",
      null,
      ["number", "number", "number", "number"],
      [galvoDots, cameraDots, size, dest]
    );
  }

  public transform(
    x: number,
    y: number,
    homography: F32AP,
    cameraMat: F32AP,
    distCoeffs: F32AP,
    dest: F32AP
  ): null {
    return this.module.ccall(
      "transform",
      null,
      ["number", "number", "number", "number", "number", "number"],
      [x, y, homography, cameraMat, distCoeffs, dest]
    );
  }
}
