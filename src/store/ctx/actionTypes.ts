import { Action } from "redux";
import { CanvasId, GetCtx, GetGlCtx, SerialId, WriteSerialPort } from ".";

export const ActionTypes = {
  setWasmModule: "SETWASMMODULE",
  setCtx: "SETCTX",
  setGlCtx: "SETGLCTX",
  setWriteSerialPort: "SETWRITESERIALPORT",
} as const;

interface SetWasmModule extends Action {
  type: typeof ActionTypes.setWasmModule;
  payload: {
    module: EmscriptenModule;
  };
}
interface SetCtx extends Action {
  type: typeof ActionTypes.setCtx;
  payload: {
    canvasId: CanvasId;
    getCtx: GetCtx | undefined;
  };
}
interface SetGlCtx extends Action {
  type: typeof ActionTypes.setGlCtx;
  payload: {
    canvasId: CanvasId;
    getGlCtx: GetGlCtx | undefined;
  };
}
interface SetWriteSerialPort extends Action {
  type: typeof ActionTypes.setWriteSerialPort;
  payload: {
    serialId: SerialId;
    writeSerialPort: WriteSerialPort | undefined;
  };
}

type ActionType = SetWasmModule | SetCtx | SetGlCtx | SetWriteSerialPort;

export default ActionType;
