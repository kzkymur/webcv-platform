import TeencyCommunicator from "@/module/teencyInterface";
import {
  Operation,
  OperationId,
  StopFlag,
  execOperation,
  shotFactory,
} from "./operation";
import { NodeId } from "@/node/Node";
import {
  getCurrentNamespace,
  updateNamespacedStore,
} from "@/module/loaclStorage";
import {
  OperationMap,
  getOperationKey,
  operationMapKey,
} from "./operation/hooks";
import { Coordinate } from "./calcHomography";
import { renderDot } from "./canvas";

export const key = (id: NodeId) => `sequencer-${id}`;

export class Sequencer {
  private storeKey: string;
  public now: number = 0;
  public operations: OperationId[] = [];
  public operationsParentId: NodeId;
  constructor(id: NodeId, operationParentId: NodeId) {
    this.storeKey = key(id);
    this.operationsParentId = operationParentId;
    this.operations = getCurrentNamespace(this.storeKey) || [];
  }
  public push = (operationId: OperationId) => {
    this.operations.push(operationId);
    updateNamespacedStore(this.storeKey, this.operations);
  };
  public remove = (index: number) => {
    this.operations.splice(index, 1);
    updateNamespacedStore(this.storeKey, this.operations);
  };

  public getOperations = (): Operation[] => {
    const operations: Operation[] = [];
    const map = getCurrentNamespace<OperationMap>(
      operationMapKey(this.operationsParentId)
    );
    if (map === null) return operations;
    const newOperations: OperationId[] = [];
    this.operations.forEach((id) => {
      const ope = getCurrentNamespace<Operation>(
        getOperationKey(map[id], this.operationsParentId, id)
      );
      if (ope) {
        operations.push(ope);
        newOperations.push(id);
      }
    });
    this.operations = newOperations;
    return operations;
  };

  public getTotalTime = () => {
    const operations = this.getOperations();
    return operations.reduce((a, c) => a + c.time, 0);
  };

  public render = (ctx: CanvasRenderingContext2D) => {
    const operations = this.getOperations();
    const totalTime = this.getTotalTime();
    const { height, width } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    let x = 0;
    operations.forEach((o) => {
      ctx.strokeStyle = o.color;
      ctx.beginPath();
      const wx = (o.time / totalTime) * width;
      ctx.rect(x, 0, wx, height);
      x += wx;
      ctx.stroke();
      ctx.closePath();
    });
  };

  public playOnlyRender = (
    ctx: CanvasRenderingContext2D,
    isLoop: boolean
  ): (() => void) => {
    const operations = this.getOperations();
    const stopFlag: StopFlag = { v: false };
    let loop = 0;
    const stop = () => {
      stopFlag.v = true;
    };
    if (operations.length === 0) return stop;
    const shotAndDraw = (p: Coordinate) => {
      renderDot(ctx, "white", p, 8);
    };
    const exec = async () => {
      while (loop < 1) {
        for (let i = 0; i < operations.length; i++) {
          const o = operations[i];
          const passedTime = operations
            .slice(0, i)
            .reduce((a, c) => a + c.time, 0);
          const setNow = (p: number) => {
            this.now = (passedTime + p * o.time) / this.getTotalTime();
          };
          if (stopFlag.v) return;
          await execOperation(o, shotAndDraw, stopFlag, setNow);
        }
        if (!isLoop) loop++;
      }
    };
    exec();
    return stop;
  };

  public play = (
    teency: TeencyCommunicator,
    cameraToGalvoHomography: number[],
    ctx: CanvasRenderingContext2D,
    isLoop: boolean
  ): (() => void) => {
    const operations = this.getOperations();
    const stopFlag: StopFlag = { v: false };
    let loop = 0;
    const stop = () => {
      stopFlag.v = true;
    };
    if (operations.length === 0) return stop;
    const shot = shotFactory(teency, cameraToGalvoHomography);
    const shotAndDraw = (p: Coordinate) => {
      shot(p);
      renderDot(ctx, "white", p, 8);
    };
    const exec = async () => {
      while (loop < 1) {
        for (let i = 0; i < operations.length; i++) {
          const o = operations[i];
          const passedTime = operations
            .slice(0, i)
            .reduce((a, c) => a + c.time, 0);
          const setNow = (p: number) => {
            this.now = (passedTime + p * o.time) / this.getTotalTime();
          };
          if (stopFlag.v) return;
          await execOperation(o, shotAndDraw, stopFlag, setNow);
        }
        if (!isLoop) loop++;
      }
    };
    exec();
    return stop;
  };
}
