import ModuleWrapper from "@/wasm/wrapper";
import { WMF32A } from "@/wasm/memory";
import TeencyCommunicator from "@/module/teencyInterface";
import { sleep } from ".";
import { affine } from "./math";
import { renderDot } from "./canvas";

export type Coordinate = {
  x: number;
  y: number;
};

export const GALVO_MAX_X = 65534;
export const GALVO_MIN_X = 0;
export const GALVO_MAX_Y = 65534;
export const GALVO_MIN_Y = 0;

export const crampGalvoCoordinate = (coordinate: Coordinate): Coordinate => ({
  x: Math.max(GALVO_MIN_X, Math.min(GALVO_MAX_X, coordinate.x)),
  y: Math.max(GALVO_MIN_Y, Math.min(GALVO_MAX_Y, coordinate.y)),
});

const detectWhitePixels = (
  arr_1: Uint8ClampedArray,
  arr_2: Uint8ClampedArray,
  colorThreshold: number
) => {
  const errors = [];
  for (let i = 0, l = arr_1.length; i < l; i += 4) {
    if (
      // only light on
      arr_2[i] - arr_1[i] > colorThreshold &&
      arr_2[i + 1] - arr_1[i + 1] > colorThreshold &&
      arr_2[i + 2] - arr_1[i + 2] > colorThreshold
    ) {
      errors.push(i);
    }
  }
  return errors;
};

// export const detectRedPoint = (
//   arr_1: Uint8ClampedArray,
//   arr_2: Uint8ClampedArray,
//   colorThreshold: number
// ) => {
//   const errors = [];
//   for (let i = 0, l = arr_1.length; i < l; i += 4) {
//     if (arr_2[i] - arr_1[i] > colorThreshold) {
//       errors.push(i);
//     }
//   }
//   return errors;
// };

const detectLaserPoint = async (
  ctx: CanvasRenderingContext2D,
  colorThreshold: number,
  fps: number,
  timeout: number
): Promise<[boolean, Coordinate]> => {
  const { width, height } = ctx.canvas;
  let preFrame = ctx.getImageData(0, 0, width, height).data;
  const cycle = 1000 / fps / 2;
  const start = performance.now();
  for (let i = 0; performance.now() - start < timeout; i++) {
    await sleep(cycle);
    const currentFrame = ctx.getImageData(0, 0, width, height).data;
    const errs = detectWhitePixels(preFrame, currentFrame, colorThreshold);
    preFrame = currentFrame;
    if (errs.length !== 0) {
      const pErrs = errs.map((e) => ({
        x: (e / 4) % width,
        y: Math.floor(e / 4 / width),
      }));
      return [
        true,
        pErrs.reduce(
          (a, c) => ({
            x: a.x + c.x / errs.length,
            y: a.y + c.y / errs.length,
          }),
          { x: 0, y: 0 }
        ),
      ];
    }
  }
  return [false, { x: 0, y: 0 }];
};

export const calcHomography = async (
  module: EmscriptenModule,
  orgCtx: CanvasRenderingContext2D,
  teency: TeencyCommunicator,
  nDots: number,
  colorThreshold: number,
  duration: number
): Promise<WMF32A> => {
  const moduleWrapper = new ModuleWrapper(module);
  const dest = new WMF32A(module, 3 * 3);
  const galvoArray: number[] = [];
  const cameraArray: number[] = [];
  const dotsSpanX = (GALVO_MAX_X - GALVO_MIN_X) / (nDots - 1);
  const dotsSpanY = (GALVO_MAX_Y - GALVO_MIN_Y) / (nDots - 1);

  for (let i = 0; i < nDots; i++) {
    const x = Math.floor(dotsSpanX * i);
    for (let j = 0; j < nDots; j++) {
      await sleep(duration);
      const y = Math.floor(dotsSpanY * j);
      const detectResult = detectLaserPoint(
        orgCtx,
        colorThreshold,
        30,
        duration
      );
      await sleep(100);
      teency.setGalvoPos({ x, y });
      const [detect, camera] = await detectResult;
      console.log(detect, camera);
      if (detect) {
        galvoArray.push(x, y);
        cameraArray.push(camera.x, camera.y);
      }
    }
  }

  if (galvoArray.length < 4) return dest;
  const galvo = new WMF32A(module, galvoArray.length);
  galvo.data = new Float32Array(galvoArray);
  const camera = new WMF32A(module, galvoArray.length);
  camera.data = new Float32Array(cameraArray);
  moduleWrapper.calcHomography(
    galvo.pointer,
    camera.pointer,
    galvoArray.length / 2,
    dest.pointer
  );
  return dest;
};

export const renderDots = (
  ctx: CanvasRenderingContext2D,
  invHomography: number[],
  nDots: number
) => {
  const dotsSpanX = (GALVO_MAX_X - GALVO_MIN_X) / (nDots - 1);
  const dotsSpanY = (GALVO_MAX_Y - GALVO_MIN_Y) / (nDots - 1);

  for (let i = 0; i < nDots; i++) {
    const x = Math.floor(dotsSpanX * i);
    for (let j = 0; j < nDots; j++) {
      const y = Math.floor(dotsSpanY * j);
      renderDot(
        ctx,
        `rgba(${(j / nDots) * 255}, ${(i / nDots) * 255}, 255, 1)`,
        affine({ x, y }, invHomography),
        8
      );
    }
  }
};
