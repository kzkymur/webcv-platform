import React, { ReactNode } from "react";
import styled from "styled-components";
import ZoomableBoard from "./ZoomableBoard";
import { NodeField } from "@/node/Node";

interface ZoomableNodeFieldProps {
  children: ReactNode;
}

const FieldContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`;

const ZoomableNodeField: React.FC<ZoomableNodeFieldProps> = ({ children }) => {
  return (
    <FieldContainer>
      <ZoomableBoard>
        <NodeField>
          {children}
        </NodeField>
      </ZoomableBoard>
    </FieldContainer>
  );
};

export default ZoomableNodeField;
