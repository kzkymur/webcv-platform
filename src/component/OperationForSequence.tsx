import React, { useCallback } from "react";
import styled from "styled-components";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import { OperationId } from "@/util/operation";
import { NodeId } from "../node/Node";
import { useOperation } from "@/util/operation/hooks";
import { Button } from "@mui/material";

export type Props = {
  parentId: NodeId;
  id: OperationId;
  push?: (id: number) => void;
};

const Name = styled.span`
  display: block;
`;

const Color = styled.div<{ $color: string }>`
  padding: 4px;
  width: 4px;
  height: 4px;
  background: ${(props) => props.$color};
`;

const OperationForSequence: React.FC<Props> = (props) => {
  const [operation] = useOperation(props.parentId, props.id);
  const onClick = useCallback(() => {
    if (props.push !== undefined) props.push(props.id);
  }, [props.push, props.id]);
  return (
    operation !== null && (
      <TableRow>
        <TableCell align="left">
          <Color $color={operation.color} />
        </TableCell>
        <TableCell align="right">
          <Name>{operation.type}</Name>
        </TableCell>
        <TableCell align="right">
          <span>{operation.time} ms</span>
        </TableCell>
        <TableCell align="center">
          <Button variant="contained" onClick={onClick}>
            ADD
          </Button>
        </TableCell>
      </TableRow>
    )
  );
};

export default OperationForSequence;
