import React, { useEffect } from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import Wasm from "@wasm";
import "./Home.css";
import ZoomableNodeField from "./ZoomableNodeField";
import { Nodes } from "../node/Nodes";
import { SetWasmModule } from "@/store/ctx/action";
import { useNodeMap } from "@/module/useNode";
import Header from "./Header";

const Container = styled.div`
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const Home: React.FC = () => {
  const dispatch = useDispatch();
  const [nodeMap] = useNodeMap();
  useEffect(() => {
    Wasm().then((Module: EmscriptenModule) => {
      dispatch(SetWasmModule(Module));
    });
  }, []);
  return (
    <Container>
      <Header />
      <ZoomableNodeField>
        {Object.keys(nodeMap).map((id) => (
          <Nodes id={Number(id)} nodeKey={nodeMap[Number(id)]} key={id} />
        ))}
      </ZoomableNodeField>
    </Container>
  );
};

export default Home;
