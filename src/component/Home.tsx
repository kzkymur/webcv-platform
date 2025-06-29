import React, { useEffect } from "react";
import { useDispatch } from "react-redux";
import Wasm from "@wasm";
import "./Home.css";
import { NodeField } from "../node/Node";
import { Nodes } from "../node/Nodes";
import { SetWasmModule } from "@/store/ctx/action";
import { useNodeMap } from "@/module/useNode";
import Header from "./Header";

const Home: React.FC = () => {
  const dispatch = useDispatch();
  const [nodeMap] = useNodeMap();
  useEffect(() => {
    Wasm().then((Module: EmscriptenModule) => {
      dispatch(SetWasmModule(Module));
    });
  }, []);
  return (
    <NodeField>
      <Header />
      {Object.keys(nodeMap).map((id) => (
        <Nodes id={Number(id)} nodeKey={nodeMap[Number(id)]} key={id} />
      ))}
    </NodeField>
  );
};

export default Home;
