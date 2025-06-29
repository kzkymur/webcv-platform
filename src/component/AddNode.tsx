import React, { useCallback, useState } from "react";
import styled from "styled-components";
import { Button } from "@mui/material";
import { useNodeMap } from "@/module/useNode";
import { NodeList, isNodeKey } from "../node/Nodes";
import SelectBox from "./SelectBox";

const Container = styled.div`
  padding: 8px;
  display: flex;
  column-gap: 8px;
  width: 300px;
  height: 36px;

  .MuiOutlinedInput-input {
    padding: 8.7px !important;
  }
`;

const AddNode: React.FC = () => {
  const [, add] = useNodeMap();
  const [label, setLabel] = useState<string>("");
  const onClickAddButton = useCallback(() => {
    if (isNodeKey(label)) add(label);
  }, [add, label]);

  return (
    <Container>
      <SelectBox
        onChange={setLabel}
        value={label}
        values={Object.keys(NodeList)}
        label="node type"
      />
      <Button onClick={onClickAddButton} variant="contained">
        ADD
      </Button>
    </Container>
  );
};

export default AddNode;
