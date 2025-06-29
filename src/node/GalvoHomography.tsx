import React, { useCallback, useMemo, useState } from "react";
import { styled } from "styled-components";
import * as math from "mathjs";
import { Button, Slider } from "@mui/material";
import { useStore } from "@/module/useStore";
import { CanvasId } from "@/store/ctx";
import {
  useCtx,
  useSerialIds,
  useWasmModule,
  useWriteSerial,
} from "@/store/ctx/hooks";
import CanvasComponent from "../component/Canvas";
import { useResolution } from "../component/ResolutionSelector";
import CanavsIdSelector from "../component/CanvasIdSelector";
import { Coordinate, calcHomography, renderDots } from "@/util/calcHomography";
import TeencyCommunicator from "@/module/teencyInterface";
import SelectBox from "../component/SelectBox";
import useFpsOptimization from "@/module/useFpsOptimization";
import { affine, arrayToMatrix } from "@/util/math";

export type Props = {
  id: CanvasId;
};

const PanelContainer = styled.div`
  padding: 8px;
`;
const PanelFooter = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
`;

export const keys = {
  nDots: "nDots",
  colorThreshold: "colorThreshold",
  durationBetweenShots: "durationBetweenShots",
  originalCanvasId: "originalCanvasId",
  serialId: "serialId",
  homography: "homography",
  invHomography: "invHomography",
} as const;

const GalvoHomography: React.FC<Props> = (props) => {
  const module = useWasmModule();
  const [resolution] = useResolution(props.id);
  const [nDots, setNDots] = useStore<number>(keys.nDots, props.id);
  const [colorThreshold, setColorThreshold] = useStore<number>(
    keys.colorThreshold,
    props.id,
    10
  );
  const [duration, setDuration] = useStore<number>(
    keys.durationBetweenShots,
    props.id
  );
  const [isCalcculatingNow, setIsCalculatingNow] = useState(false);
  const updateNDots = useCallback(
    (_: unknown, value: number | number[]) => {
      setNDots(typeof value === "object" ? value[0] : value);
    },
    [setNDots]
  );
  const updateDuration = useCallback(
    (_: unknown, value: number | number[]) => {
      setDuration(typeof value === "object" ? value[0] : value);
    },
    [setDuration]
  );
  const updateColorThreshold = useCallback(
    (_: unknown, value: number | number[]) => {
      setColorThreshold(typeof value === "object" ? value[0] : value);
    },
    [setColorThreshold]
  );
  const [originalCanvasId] = useStore<number>(keys.originalCanvasId, props.id);
  const serialIds = useSerialIds();
  const [serialId, setSerialId] = useStore<number>(keys.serialId, props.id);
  const writeSerialPort = useWriteSerial(serialId || 0);
  const teency = useMemo(
    () =>
      writeSerialPort !== null ? new TeencyCommunicator(writeSerialPort) : null,
    [writeSerialPort]
  );
  const [homography, setHomography] = useStore<number[]>(
    keys.homography,
    props.id || 0
  );
  const [invHomography, setInvHomography] = useStore<number[]>(
    keys.invHomography,
    props.id || 0
  );

  const orgCtx = useCtx(originalCanvasId as CanvasId);
  const ctx = useCtx(props.id as CanvasId);
  const startCalcHomography = useCallback(async () => {
    if (
      nDots === null ||
      duration === null ||
      colorThreshold === null ||
      teency === null ||
      module === null ||
      orgCtx === null
    )
      return;
    setIsCalculatingNow(true);
    const homography = await calcHomography(
      module,
      orgCtx,
      teency,
      nDots,
      colorThreshold,
      duration
    );
    setIsCalculatingNow(false);
    const h = Array.from(homography.data);
    setHomography(h);
    setInvHomography(math.inv(arrayToMatrix(h, 3)).flat());
    homography.clear();
  }, [orgCtx, module, teency, nDots, duration, resolution]);

  const shotDot = useCallback(
    (p: Coordinate) => {
      if (teency === null || homography === null) return;
      teency.setGalvoPos(affine(p, homography));
    },
    [teency, homography]
  );

  const renderCopy = useCallback(() => {
    if (ctx === null || orgCtx === null) return;
    ctx.putImageData(
      orgCtx.getImageData(0, 0, orgCtx.canvas.width, orgCtx.canvas.height),
      0,
      0
    );
  }, [ctx, orgCtx]);
  const renderHomographyDots = useCallback(() => {
    if (ctx === null || invHomography === null || nDots === null) return;
    renderDots(ctx, invHomography, nDots);
  }, [ctx, invHomography, nDots]);

  const render = useCallback(() => {
    if (ctx === null) return;
    ctx.reset();
    renderCopy();
    renderHomographyDots();
  }, [ctx, renderCopy, renderHomographyDots]);
  useFpsOptimization(render);

  return (
    <div>
      <PanelContainer>
        <p>
          <span>
            The number of dots for Calc homography: {nDots} x {nDots}
          </span>
        </p>
        <p>
          <Slider
            value={nDots || 10}
            step={1}
            onChange={updateNDots}
            min={3}
            max={20}
          />
        </p>
        <p>
          <span>color threshold: {colorThreshold}</span>
        </p>
        <p>
          <Slider
            value={colorThreshold || 10}
            step={5}
            onChange={updateColorThreshold}
            min={10}
            max={250}
          />
        </p>
        <p>
          <span>Duration between shot dots: {duration} ms</span>
        </p>
        <p>
          <Slider
            value={duration || 10}
            step={50}
            onChange={updateDuration}
            min={100}
            max={1000}
          />
        </p>
        <PanelFooter>
          <CanavsIdSelector
            exceptedIds={[props.id]}
            keyName={`${keys.originalCanvasId}-${props.id}`}
          />
          <SelectBox
            onChange={(v) => setSerialId(Number(v))}
            value={String(serialId)}
            values={serialIds.map(String)}
            label="serial-port"
            labels={serialIds.map((i) => `#${i}`)}
          />
          <Button
            disabled={
              isCalcculatingNow ||
              orgCtx === null ||
              nDots === null ||
              writeSerialPort === null ||
              colorThreshold === null ||
              duration === null
            }
            onClick={startCalcHomography}
            variant="contained"
          >
            Start Homography Calc
          </Button>
        </PanelFooter>
      </PanelContainer>
      <CanvasComponent id={props.id} onClick={shotDot} />
    </div>
  );
};

export default GalvoHomography;
