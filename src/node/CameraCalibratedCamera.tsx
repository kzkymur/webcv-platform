import React, { useCallback, useEffect, useMemo, useState } from "react";
import { styled } from "styled-components";
import { Button, Slider } from "@mui/material";
import { useF32ArrayPointer } from "@/wasm/memory";
import { useStore } from "@/module/useStore";
import useFpsOptimization from "@/module/useFpsOptimization";
import { CanvasId } from "@/store/ctx";
import { useCtx, useGlCtx, useWasmModule } from "@/store/ctx/hooks";
import { calcUndistMap, calibration } from "@/util/calibrateCamera";
import { GlCanvasComponent } from "../component/Canvas";
import { useResolution } from "../component/ResolutionSelector";
import CanavsIdSelector from "../component/CanvasIdSelector";
import {
  MapXY,
  createRenderTexture,
  makeObjTexture,
  mapxAndMapyToMapxy,
} from "@/module/uvRendering";

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

const keys = {
  nImagesUsedForCalib: "nImagesUsedForCalib",
  durationBetweenGetImages: "durationBetweenGetImages",
  originalId: "originalId",
  intrMat: "intrMat",
  distCoeffs: "distCoeffs",
} as const;

const REMAP_TEXTURE_SAMPLING_RATE = 100;

const CalibratedCamera: React.FC<Props> = (props) => {
  const module = useWasmModule();
  const [resolution] = useResolution(props.id);
  const [nImages, setNImages] = useStore<number>(
    keys.nImagesUsedForCalib,
    props.id
  );
  const [duration, setDuration] = useStore<number>(
    keys.durationBetweenGetImages,
    props.id
  );
  const [isCalibratingNow, setIsCalibratingNow] = useState(false);
  const updateNImages = useCallback(
    (_: unknown, value: number | number[]) => {
      setNImages(typeof value === "object" ? value[0] : value);
    },
    [setNImages]
  );
  const updateDuration = useCallback(
    (_: unknown, value: number | number[]) => {
      setDuration(typeof value === "object" ? value[0] : value);
    },
    [setDuration]
  );
  const gl = useGlCtx(props.id);
  const [originalId] = useStore<number>(keys.originalId, props.id);
  const [intrMat, setIntrMat] = useStore<number[]>(
    keys.intrMat,
    originalId || 0
  );
  const [distCoeffs, setDistCoeffs] = useStore<number[]>(
    keys.distCoeffs,
    originalId || 0
  );
  const [mapXY, setMapXY] = useState<MapXY>([]);
  const draw = useMemo(() => {
    return gl !== null && mapXY.length !== 0
      ? createRenderTexture(
        gl,
        makeObjTexture(mapXY, resolution.w, REMAP_TEXTURE_SAMPLING_RATE),
        resolution.w / resolution.h
      )
      : null;
  }, [gl, mapXY, resolution]);

  const orgCtx = useCtx(originalId as CanvasId);
  const startCalib = useCallback(async () => {
    if (
      nImages === null ||
      duration === null ||
      module === null ||
      orgCtx === null
    )
      return;
    setIsCalibratingNow(true);
    const [cameraMat, distCoeff] = await calibration(
      module,
      orgCtx,
      resolution,
      nImages,
      duration
    );
    setIsCalibratingNow(false);
    setIntrMat(Array.from(cameraMat.data));
    setDistCoeffs(Array.from(distCoeff.data));
    cameraMat.clear();
    distCoeff.clear();
  }, [orgCtx, module, nImages, duration, resolution]);

  const intrMatPointer = useF32ArrayPointer(intrMat, 3 * 3);
  const distCoeffsPointer = useF32ArrayPointer(distCoeffs, 8);

  useEffect(() => {
    if (module === null || intrMatPointer === 0 || distCoeffsPointer === 0)
      return;
    const [mapX, mapY] = calcUndistMap(
      module,
      resolution,
      intrMatPointer,
      distCoeffsPointer
    );
    setMapXY(mapxAndMapyToMapxy(Array.from(mapX.data), Array.from(mapY.data)));
    mapX.clear();
    mapY.clear();
  }, [module, resolution, intrMatPointer, distCoeffsPointer]);

  const renderCalibratedCamera = useCallback(() => {
    if (draw === null || orgCtx === null) return;
    draw(orgCtx.canvas);
  }, [draw, orgCtx, resolution]);

  useFpsOptimization(renderCalibratedCamera);

  return (
    <div>
      <PanelContainer>
        <p>
          <span>The number of images for Calibration: {nImages}</span>
        </p>
        <p>
          <Slider
            value={nImages || 10}
            step={1}
            onChange={updateNImages}
            min={1}
            max={30}
          />
        </p>
        <p>
          <span>Duration between get Images: {duration} ms</span>
        </p>
        <p>
          <Slider
            value={duration || 10}
            step={100}
            onChange={updateDuration}
            min={500}
            max={5000}
          />
        </p>
        <PanelFooter>
          <CanavsIdSelector
            exceptedIds={[props.id]}
            keyName={`${keys.originalId}-${props.id}`}
          />
          <Button
            disabled={
              isCalibratingNow ||
              orgCtx === null ||
              nImages === null ||
              duration === null
            }
            onClick={startCalib}
            variant="contained"
          >
            Calib Start
          </Button>
        </PanelFooter>
      </PanelContainer>
      <GlCanvasComponent id={props.id} />
    </div>
  );
};

export default CalibratedCamera;
