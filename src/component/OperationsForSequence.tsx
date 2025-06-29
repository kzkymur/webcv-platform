import React, { useMemo } from "react";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Paper from "@mui/material/Paper";
import { NodeId } from "../node/Node";
import { useOperationMap } from "@/util/operation/hooks";
import OperationForSequence from "./OperationForSequence";

export type Props = {
  id: NodeId;
  push?: (id: number) => void;
};

const OperationsForSequence: React.FC<Props> = (props) => {
  const [map] = useOperationMap(props.id);
  const idList = useMemo(() => Object.keys(map).map(Number), [map]);
  return (
    <TableContainer component={Paper} sx={{ maxHeight: 200 }}>
      <Table sx={{ minWidth: 200 }} size="small">
        <TableHead>
          <TableRow>
            <TableCell align="left">Color</TableCell>
            <TableCell align="left">Type</TableCell>
            <TableCell align="left">Time</TableCell>
            <TableCell align="left">Add</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {idList.map((id) => (
            <OperationForSequence
              key={id}
              parentId={props.id}
              id={id}
              push={props.push}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default OperationsForSequence;
