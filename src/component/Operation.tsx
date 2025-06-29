import React, { useCallback } from "react";
import styled from "styled-components";
import { Slider } from "@mui/material";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import { OperationId } from "@/util/operation";
import { NodeId } from "../node/Node";
import { useOperation } from "@/util/operation/hooks";

export type Props = {
  parentId: NodeId;
  id: OperationId;
  onClick?: (id: number) => void;
};

const ColoredSlider = styled(Slider) <{ $color: string }>`
  display: flex;
  width: 150px;
  .MuiSlider-thumb {
    color: ${(props) => props.$color} !important;
  }
  .MuiSlider-rail {
    color: ${(props) => props.$color} !important;
  }
  .MuiSlider-track {
    color: ${(props) => props.$color} !important;
  }
`;

const Time = styled.div`
  display: flex;
  min-width: 200px;
  justify-content: space-between;
`;

const Name = styled.span`
  display: block;
`;

const Color = styled.div<{ $color: string }>`
  padding: 4px;
  width: 4px;
  height: 4px;
  background: ${(props) => props.$color};
`;

const DelButton = styled.span`
  cursor: pointer;
`;

const OperationComponent: React.FC<Props> = (props) => {
  const [operation, setOperation, del] = useOperation(props.parentId, props.id);
  const updateTime = useCallback(
    (_: unknown, value: number | number[]) => {
      if (operation === null) return;
      const time = typeof value === "object" ? value[0] : value;
      setOperation({ ...operation, time });
    },
    [setOperation, operation]
  );
  const onClick = useCallback(() => {
    if (props.onClick) props.onClick(props.id);
  }, [props.onClick, props.id]);
  return (
    operation !== null && (
      <TableRow onClick={onClick}>
        <TableCell align="left">
          <Color $color={operation.color} />
        </TableCell>
        <TableCell align="right">
          <Name>{operation.type}</Name>
        </TableCell>
        <TableCell align="right">
          <Time>
            <ColoredSlider
              min={10}
              max={2000}
              value={operation.time}
              color={"info"}
              onChange={updateTime}
              $color={operation.color}
            />
            <span>{operation.time} ms</span>
          </Time>
        </TableCell>
        <TableCell align="right">
          <DelButton onClick={del}>x</DelButton>
        </TableCell>
      </TableRow>
    )
  );
};

export default OperationComponent;
