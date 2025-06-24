import React, { useCallback, useEffect } from "react";
import { useDispatch } from "react-redux";
import { styled } from "styled-components";
import "./Home.css";
import { use2dCanvas, useGlCanvas } from "@/module/use2dCanvas";
import { Resolution } from "@/module/camera";
import { SetCtx, SetGlCtx } from "@/store/ctx/action";
import { CanvasId } from "@/store/ctx";
import ResolutionSelector, { useResolution } from "./ResolutionSelector";
import { Checkbox } from "@mui/material";
import { useStore } from "@/module/useStore";
import { Coordinate } from "@/util/calcHomography";

type Props = {
  id: CanvasId;
  onClick?: (cordinate: Coordinate) => void;
};

const Container = styled.div<{
  $resolution: Resolution;
}>`
  width: 100%;
  position: relative;
  border: 1px solid;
  &::before {
    content: "";
    display: block;
    padding-top: ${(props) =>
      (props.$resolution.h / props.$resolution.w) * 100}%;
  }
`;

const StyledCanvas = styled.canvas<{
  $isVisible: boolean;
}>`
  position: absolute;
  width: 100%;
  height: 100%;
  display: ${(props) => (props.$isVisible ? "block" : "none")};
  top: 0;
  z-index: 1;
`;

const CheckboxContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
`;
const ResolutionContainer = styled.div`
  position: absolute;
  margin: 8px;
  top: 0;
  right: 0;
  z-index: 2;
`;

const IS_VISIBLE_KEY = "IS_VISIBLE";

const CanvasComponent: React.FC<Props> = (props) => {
  const dispatch = useDispatch();
  const [resolution] = useResolution(props.id);
  const [canvasRef, ctx] = use2dCanvas(resolution);
  const [isVisible, setIsVisible] = useStore<boolean>(
    IS_VISIBLE_KEY,
    props.id,
    true
  );
  const onVisibleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setIsVisible(Boolean(e.target.checked));
    },
    [setIsVisible]
  );

  const onCilck = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (props.onClick === undefined || canvasRef.current === null) return;
      const cr = canvasRef.current.getBoundingClientRect();
      const x = Math.ceil((e.pageX - cr.left) / (cr.width / resolution.w));
      const y = Math.ceil((e.pageY - cr.top) / (cr.height / resolution.h));
      props.onClick({ x, y });
    },
    [props.onClick, resolution]
  );

  useEffect(() => {
    if (ctx !== null) dispatch(SetCtx(props.id, () => ctx));
    else dispatch(SetCtx(props.id));

    return () => {
      dispatch(SetCtx(props.id));
    };
  }, [props.id, ctx]);

  return (
    <Container $resolution={resolution}>
      <StyledCanvas
        ref={canvasRef}
        $isVisible={isVisible || false}
        width={resolution.w}
        height={resolution.h}
        onClick={onCilck}
      />
      <CheckboxContainer>
        <Checkbox defaultChecked onChange={onVisibleChange} />
      </CheckboxContainer>
      <ResolutionContainer>
        <ResolutionSelector id={props.id} />
      </ResolutionContainer>
    </Container>
  );
};

export default CanvasComponent;

export const GlCanvasComponent: React.FC<Props> = (props) => {
  const dispatch = useDispatch();
  const [resolution] = useResolution(props.id);
  const [canvasRef, gl] = useGlCanvas(resolution);
  const [isVisible, setIsVisible] = useStore<boolean>(
    IS_VISIBLE_KEY,
    props.id,
    true
  );
  const onVisibleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setIsVisible(Boolean(e.target.checked));
    },
    [setIsVisible]
  );

  const onCilck = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (props.onClick === undefined || canvasRef.current === null) return;
      const cr = canvasRef.current.getBoundingClientRect();
      const x = Math.ceil((e.pageX - cr.left) / (cr.width / resolution.w));
      const y = Math.ceil((e.pageY - cr.top) / (cr.height / resolution.h));
      props.onClick({ x, y });
    },
    [props.onClick, resolution]
  );

  useEffect(() => {
    if (gl !== null) dispatch(SetGlCtx(props.id, () => gl));
    else dispatch(SetGlCtx(props.id));

    return () => {
      dispatch(SetGlCtx(props.id));
    };
  }, [props.id, gl]);

  return (
    <Container $resolution={resolution}>
      <StyledCanvas
        ref={canvasRef}
        $isVisible={isVisible || false}
        width={resolution.w}
        height={resolution.h}
        onClick={onCilck}
      />
      <CheckboxContainer>
        <Checkbox defaultChecked onChange={onVisibleChange} />
      </CheckboxContainer>
      <ResolutionContainer>
        <ResolutionSelector id={props.id} />
      </ResolutionContainer>
    </Container>
  );
};
