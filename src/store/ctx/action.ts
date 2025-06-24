import Action, { ActionTypes } from "./actionTypes";
import { CanvasId, GetCtx, GetGlCtx, SerialId, WriteSerialPort } from ".";

export const SetWasmModule: (module: EmscriptenModule) => Action = (
  module
) => ({
  type: ActionTypes.setWasmModule,
  payload: { module },
});

export const SetCtx: (canvasId: CanvasId, getCtx?: GetCtx) => Action = (
  canvasId,
  getCtx
) => ({
  type: ActionTypes.setCtx,
  payload: { canvasId, getCtx },
});

export const SetGlCtx: (canvasId: CanvasId, getGlCtx?: GetGlCtx) => Action = (
  canvasId,
  getGlCtx
) => ({
  type: ActionTypes.setGlCtx,
  payload: { canvasId, getGlCtx },
});

export const SetSendMsgSp: (
  serialId: SerialId,
  writeSerialPort?: WriteSerialPort
) => Action = (serialId, writeSerialPort) => ({
  type: ActionTypes.setWriteSerialPort,
  payload: { serialId, writeSerialPort },
});
