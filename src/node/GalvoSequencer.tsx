import React, { useCallback, useEffect, useMemo, useState } from "react";
import { styled } from "styled-components";
import { Button } from "@mui/material";
import { useStore } from "@/module/useStore";
import { CanvasId } from "@/store/ctx";
import { useCtx, useSerialIds, useWriteSerial } from "@/store/ctx/hooks";
import CanvasComponent from "../component/Canvas";
import CanavsIdSelector from "../component/CanvasIdSelector";
import TeencyCommunicator from "@/module/teencyInterface";
import SelectBox from "../component/SelectBox";
import useFpsOptimization from "@/module/useFpsOptimization";
import { keys as opeKeys } from "./GalvoOperations";
import { keys as homoKeys } from "./GalvoHomography";
import { renderCopy } from "@/util/canvas";
import OperationsForSequence from "../component/OperationsForSequence";
import { Sequencer } from "@/util/sequencer";
import { OperationId } from "@/util/operation";
import SequencerComponent from "../component/Sequencer";
import { cloneInstance } from "@/util";

export type Props = {
  id: CanvasId;
};

const PanelContainer = styled.div`
  padding: 8px;
`;
const Panel = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 8px 0;
`;

const keys = {
  operationsId: "operationsId",
  serialId: "serialId",
} as const;

const GalvoSequencer: React.FC<Props> = (props) => {
  const [operationsId] = useStore<number>(keys.operationsId, props.id);
  const [homographyId] = useStore<number>(
    opeKeys.homographyId,
    operationsId || 0
  );
  const serialIds = useSerialIds();
  const [serialId, setSerialId] = useStore<number>(
    keys.serialId,
    homographyId || 0
  );
  const writeSerialPort = useWriteSerial(serialId || 0);
  const teency = useMemo(
    () =>
      writeSerialPort !== null ? new TeencyCommunicator(writeSerialPort) : null,
    [writeSerialPort]
  );
  const [homography] = useStore<number[]>(
    homoKeys.homography,
    homographyId || 0
  );

  const orgCtx = useCtx(operationsId as CanvasId);
  const ctx = useCtx(props.id as CanvasId);

  const renderOrgCtx = useCallback(() => {
    if (ctx === null || orgCtx === null) return;
    renderCopy(ctx, orgCtx);
  }, [ctx, orgCtx]);

  const [sequencer, setSequencer] = useState<Sequencer | null>(null);
  useEffect(() => {
    operationsId === null
      ? null
      : setSequencer(new Sequencer(props.id, operationsId));
  }, [operationsId, props.id]);
  const push = useCallback(
    (id: OperationId) => {
      if (sequencer === null) return;
      sequencer.push(id);
      setSequencer(cloneInstance(sequencer));
    },
    [sequencer, setSequencer]
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [stop, setStop] = useState<() => void>(() => () => { });
  const playOnlyRender = useCallback(() => {
    if (sequencer === null || ctx === null || isPlaying) return;
    setIsPlaying(true);
    const stopFunc = sequencer.playOnlyRender(ctx, true);
    setStop(() => () => {
      stopFunc();
      setIsPlaying(false);
    });
  }, [sequencer, isPlaying, teency, homography, ctx]);
  const play = useCallback(() => {
    if (
      sequencer === null ||
      teency === null ||
      homography === null ||
      ctx === null ||
      isPlaying
    )
      return;
    setIsPlaying(true);
    const stopFunc = sequencer.play(teency, homography, ctx, true);
    setStop(() => () => {
      stopFunc();
      setIsPlaying(false);
    });
  }, [sequencer, isPlaying, teency, homography, ctx]);

  const render = useCallback(() => {
    renderOrgCtx();
  }, [renderOrgCtx]);
  useFpsOptimization(render);

  return (
    <div>
      <CanvasComponent id={props.id} />
      <PanelContainer>
        <Panel>
          <CanavsIdSelector
            exceptedIds={[props.id]}
            keyName={`${keys.operationsId}-${props.id}`}
            nodeKeys={["GalvoOperations"]}
            label="operations"
          />
          <SelectBox
            onChange={(v) => setSerialId(Number(v))}
            value={String(serialId)}
            values={serialIds.map(String)}
            label="serial-port"
            labels={serialIds.map((i) => `#${i}`)}
            minWidth={80}
            maxWidth={80}
          />
        </Panel>
        <Panel>
          <Button
            variant="contained"
            onClick={isPlaying ? stop : play}
            disabled={
              sequencer === null ||
              teency === null ||
              homography === null ||
              ctx === null
            }
          >
            {isPlaying ? "Stop" : "Play"}
          </Button>
          <Button
            variant="outlined"
            onClick={isPlaying ? stop : playOnlyRender}
            disabled={sequencer === null || ctx === null}
          >
            {isPlaying ? "Stop" : "PlayOnlyRender"}
          </Button>
        </Panel>
        {operationsId !== null && sequencer !== null && (
          <OperationsForSequence id={operationsId} push={push} />
        )}
      </PanelContainer>
      {sequencer !== null && <SequencerComponent sequencer={sequencer} />}
    </div>
  );
};

export default GalvoSequencer;
