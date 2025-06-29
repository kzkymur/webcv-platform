import React, { ReactNode, useCallback, useMemo, useRef } from "react";
import { Rnd } from "react-rnd";
import styled from "styled-components";
import { useStore } from "@/module/useStore";
import { getRandomInt } from "@/util";
import { useNodeMap } from "@/module/useNode";

export type NodeId = number;

export const keys = {
  gridUnit: "gridUnit",
  nodePosition: "nodePosition",
  nodeSize: "nodeSize",
  nodeIndex: "nodeIndex",
  latestIndex: "latestIndex",
} as const;

type Position = {
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

const getDefault = (pos: Partial<Position>, size: Partial<Size>) => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  ...pos,
  ...size,
});

export const NodeField = styled.div`
  width: 100%;
  height: 100%;
`;

export const IdLabel = styled.span`
  top: 0;
`;
const NodeContainer = styled.div`
  padding: 8px;
  outline: 1px solid black;
  border-radius: 4px;
  width: 100%;
  height: fit-content;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: white;
  row-gap: 4px;
`;
const Header = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  white-space: nowrap;
  font-size: 16px;
`;
const HeaderRight = styled.div`
  display: flex;
  column-gap: 8px;
`;
const DeleteButton = styled.div`
  width: 15px;
  text-align: center;
  cursor: pointer;
`;
const Body = styled.div`
  width: 100%;
  flex-grow: 1;
  cursor: initial;
`;

type Props = {
  id: NodeId;
  name: string;
  children: ReactNode;
};

const Node: React.FC<Props> = (props) => {
  const [, , del] = useNodeMap();
  const [grid] = useStore<number>(keys.gridUnit, undefined, 10);
  const [latestIndex, updateLatestIndex] = useStore<number>(
    keys.latestIndex,
    undefined,
    1
  );
  const [nodeIndex, updateNodeIndex] = useStore<number>(
    keys.nodeIndex,
    props.id,
    1
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useStore<Position>(keys.nodePosition, props.id, {
    x: getRandomInt(100),
    y: getRandomInt(100),
  });
  const [size, setSize] = useStore<Size>(keys.nodeSize, props.id, {
    width: 200,
    height: 200,
  });
  const defaultParams = useMemo(() => getDefault(pos!, size!), [pos, size]);
  const onDragStop = useCallback(
    (_: unknown, d: Position) => setPos({ x: d.x, y: d.y }),
    [setPos]
  );
  const onResizeStop = useCallback(
    (_: unknown, __: unknown, ref: HTMLElement) => {
      if (containerRef.current === null) return;
      const height = containerRef.current.offsetHeight;
      ref.style.height = `${height}px`;
      setSize({
        width: ref.offsetWidth,
        height,
      });
    },
    [setSize]
  );
  const deleteNode = useCallback(() => {
    del(props.id);
  }, [del, props.id]);
  const bringInFront = useCallback(() => {
    if (latestIndex === null) return;
    updateLatestIndex(latestIndex + 1);
    updateNodeIndex(latestIndex);
  }, [latestIndex, updateNodeIndex, updateLatestIndex]);

  return (
    <Rnd
      dragGrid={[grid!, grid!]}
      default={defaultParams}
      onDragStop={onDragStop}
      onResizeStop={onResizeStop}
      cancel=".rnd-cancel"
      style={{ zIndex: `${nodeIndex}` }}
    >
      <NodeContainer ref={containerRef} onDoubleClick={bringInFront}>
        <Header>
          <IdLabel>#{props.id}</IdLabel>
          <HeaderRight>
            <span>{props.name}</span>
            <DeleteButton onClick={deleteNode}>x</DeleteButton>
          </HeaderRight>
        </Header>
        <Body className="rnd-cancel">{props.children}</Body>
      </NodeContainer>
    </Rnd>
  );
};

export default Node;
