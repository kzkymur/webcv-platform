import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { styled } from "styled-components";
import "./Home.css";
import {
  Resolution,
  playCameraMovie,
  resolutionXGA,
  useDeviceId,
} from "@/module/camera";
import CanvasComponent from "./Canvas";
import { CanvasId } from "@/store/ctx";
import { useCtx } from "@/store/ctx/hooks";
import { useResolution } from "./ResolutionSelector";
import useFpsOptimization from "@/module/useFpsOptimization";

export type Props = {
  id: CanvasId;
};

const InvisibleVideo = styled.video`
  display: none;
`;

const OriginalCameraVideo: React.FC<Props> = (props) => {
  const ctx = useCtx(props.id);
  const [deviceId] = useDeviceId(props.id);
  const [cameraResolution, setCameraResolution] =
    useState<Resolution>(resolutionXGA);
  const [resolution] = useResolution(props.id);
  const canvasHeight = useMemo(
    () => resolution.w * (cameraResolution.h / cameraResolution.w),
    [cameraResolution, resolution]
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && deviceId !== null) {
      playCameraMovie(videoRef.current, deviceId, setCameraResolution);
    }
  }, [deviceId]);

  const renderCameraImg = useCallback(() => {
    if (ctx === null || videoRef.current === null) return;
    ctx.drawImage(
      videoRef.current,
      0,
      0,
      cameraResolution.w,
      cameraResolution.h,
      0,
      (resolution.h - canvasHeight) / 2,
      resolution.w,
      canvasHeight
    );
  }, [ctx, resolution, cameraResolution]);

  useFpsOptimization(renderCameraImg);

  return (
    <>
      <CanvasComponent id={props.id} />
      <InvisibleVideo ref={videoRef} />
    </>
  );
};

export default OriginalCameraVideo;
