import * as twgl from "twgl.js";
import m from "./mathIV";

const vs = `
attribute vec3 position;
attribute vec2 texcoord;
uniform   mat4 mvpMatrix;
varying   vec2 vTextureCoord;

void main(){
    vTextureCoord = texcoord;
    gl_Position   = mvpMatrix * vec4(position, 1.0);
}
`;

const fs = `
precision mediump float;

uniform sampler2D texture;
varying vec2      vTextureCoord;

void main(){
    vec4 smpColor = texture2D(texture, vTextureCoord);
    gl_FragColor  = smpColor;
}
`;

export type MapXY = [number, number][];

export const mapxAndMapyToMapxy = (mapX: number[], mapY: number[]): MapXY => {
  if (mapX.length !== mapY.length) {
    throw new Error("It’s not the same size as mapX and mapY");
  }
  const mapXY: MapXY = [];
  for (let i = 0; i < mapX.length; i++) {
    mapXY.push([mapX[i], mapY[i]]);
  }
  return mapXY;
};

type TexObj = {
  position: number[];
  texcoord: number[];
  indices: number[];
};

export const makeObjTexture = (
  mapXY: MapXY,
  width: number,
  samplingRate: number
): TexObj => {
  const height = mapXY.length / width;
  const samplingSizeX = width / samplingRate;
  const samplingSizeY = height / samplingRate;
  const sampledMapXY: MapXY = [];
  const mapUV = [];

  const xList = [];
  const yList = [];
  for (let i = 0; i < width; i += samplingSizeX) {
    xList.push(Math.floor(i));
  }
  for (let i = 0; i < height; i += samplingSizeY) {
    yList.push(Math.floor(i));
  }

  const indices = [];
  for (let i = 0; i < samplingRate - 1; i++) {
    for (let j = 0; j < samplingRate - 1; j++) {
      const p0 = i * samplingRate + j;
      const p1 = i * samplingRate + j + 1;
      const p2 = (i + 1) * samplingRate + j;
      const p3 = (i + 1) * samplingRate + j + 1;
      indices.push(...[p0, p1, p2], ...[p3, p2, p1]);
    }
  }

  for (const y of yList) {
    for (const x of xList) {
      sampledMapXY.push([
        (mapXY[y * width + x][0] / width) * 2 - 1,
        (mapXY[y * width + x][1] / height) * 2 - 1,
      ]);
      mapUV.push([x / width, y / height]);
    }
  }

  const position = [];
  const texcoord = [];
  for (const i in sampledMapXY) {
    position.push(...sampledMapXY[i], 0.0);
    texcoord.push(...mapUV[i]);
  }

  console.log(mapUV);
  console.log(texcoord);

  return {
    position,
    texcoord,
    indices,
  };
  // return {
  //   position: [-1.0, 1.0, 0.0, 1.0, 1.0, 0.0, -1.0, -1.0, 0.0, 1.0, -1.0, 0.0],
  //   texcoord: [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0],
  //   indices: [0, 1, 2, 3, 2, 1],
  // };
};

const getMvpMatrix = (aspectRatio: number) => {
  const mMatrix = m.identity();
  const vMatrix = m.lookAt([0.0, 0.0, 1.0], [0, 0, 0], [0, 1, 0]);
  const pMatrix = m.perspective(90, aspectRatio, 0.1, 100);

  return m.multiply(m.multiply(pMatrix, vMatrix), mMatrix);
};

export const createRenderTexture = (
  gl: WebGLRenderingContext,
  texObj: TexObj,
  aspectRatio: number
) => {
  const programInfo = twgl.createProgramInfo(gl, [vs, fs]);
  const bufferInfo = twgl.createBufferInfoFromArrays(gl, texObj);
  twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
  const mvpMatrix = getMvpMatrix(aspectRatio);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  return (orgCanvas: HTMLCanvasElement) => {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(programInfo.program);
    twgl.resizeCanvasToDisplaySize(gl.canvas as HTMLCanvasElement);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    const uniforms = {
      mvpMatrix,
      texture: twgl.createTexture(gl, {
        src: orgCanvas,
      }),
    };
    twgl.setUniforms(programInfo, uniforms);
    twgl.drawBufferInfo(gl, bufferInfo);
  };
};
