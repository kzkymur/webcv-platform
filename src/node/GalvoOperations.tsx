import React, { useCallback, useState } from "react";
import { styled } from "styled-components";
import { useStore } from "@/module/useStore";
import { CanvasId } from "@/store/ctx";
import { useCtx } from "@/store/ctx/hooks";
import CanvasComponent from "../component/Canvas";
import CanavsIdSelector from "../component/CanvasIdSelector";
import useFpsOptimization from "@/module/useFpsOptimization";
import { renderCopy } from "@/util/canvas";
import { Button } from "@mui/material";
import { OperationType, renderOperation } from "@/util/operation";
import { Coordinate } from "@/util/calcHomography";
import { CreatePolygonKit } from "@/util/operation/polygon";
import { useOperationMap, useOperations } from "@/util/operation/hooks";
import Operations from "../component/Operations";
import { hsl } from "@/util/color";
import { roundTheta } from "@/util/math";

export type Props = {
  id: CanvasId;
};

const PanelContainer = styled.div`
  padding: 8px;
  display: flex;
  flex-direction: column;
  row-gap: 12px;
`;
const Panel = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
`;

export const keys = {
  homographyId: "homographyId",
} as const;

const GalvoOperations: React.FC<Props> = (props) => {
  const [homographyId] = useStore<number>(keys.homographyId, props.id);

  const orgCtx = useCtx(homographyId as CanvasId);
  const ctx = useCtx(props.id as CanvasId);
  const renderOrgCtx = useCallback(() => {
    if (ctx === null || orgCtx === null) return;
    renderCopy(ctx, orgCtx);
  }, [ctx, orgCtx]);

  const [operationMap, latestOperationId, add] = useOperationMap(props.id);

  const [isMakingPolygonNow, setIsMakingPolygonNow] = useState(false);
  const [createPolygonKit, setCreatePolygonKit] =
    useState<CreatePolygonKit | null>(null);
  const startMakingPolygon = useCallback(() => {
    if (ctx === null) return;
    setIsMakingPolygonNow(true);
    setCreatePolygonKit(
      new CreatePolygonKit(
        ctx,
        hsl(Math.sin(roundTheta((latestOperationId / 10) * 7) / 4))
      )
    );
  }, [ctx, latestOperationId]);
  const endMakingPolygon = useCallback(() => {
    if (createPolygonKit === null || operationMap === null) return;
    setIsMakingPolygonNow(false);
    add({
      id: 1,
      type: OperationType.polygon,
      content: createPolygonKit.make(),
      color: createPolygonKit.color,
      time: 1000,
    });
    setCreatePolygonKit(null);
  }, [createPolygonKit, add]);
  const onCanvasClick = useCallback(
    (p: Coordinate) => {
      if (createPolygonKit !== null) {
        createPolygonKit.push(p);
        return;
      }
    },
    [createPolygonKit]
  );

  const operations = useOperations(props.id);
  const renderOperations = useCallback(() => {
    if (ctx === null || operations === null) return;
    operations.forEach((o) => {
      renderOperation(ctx, o);
    });
  }, [ctx, operations]);
  const renderCreatePolygonKit = useCallback(() => {
    if (ctx === null || createPolygonKit === null) return;
    createPolygonKit.render();
  }, [ctx, createPolygonKit]);

  const render = useCallback(() => {
    renderOrgCtx();
    renderOperations();
    renderCreatePolygonKit();
  }, [renderOrgCtx, renderOperations, renderCreatePolygonKit]);
  useFpsOptimization(render);

  return (
    <div>
      <CanvasComponent id={props.id} onClick={onCanvasClick} />
      <PanelContainer>
        <Panel>
          <CanavsIdSelector
            exceptedIds={[props.id]}
            keyName={`${keys.homographyId}-${props.id}`}
            nodeKeys={["GalvoHomography"]}
            label="homography"
          />
          <Button
            variant="contained"
            onClick={isMakingPolygonNow ? endMakingPolygon : startMakingPolygon}
          >
            {isMakingPolygonNow ? "end" : "CREATE"}
          </Button>
        </Panel>
        <Operations id={props.id} />
      </PanelContainer>
    </div>
  );
};

export default GalvoOperations;
