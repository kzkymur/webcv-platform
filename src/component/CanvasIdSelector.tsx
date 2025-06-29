import React, { useMemo } from "react";
import { CanvasId } from "@/store/ctx";
import { useCtxIds } from "@/store/ctx/hooks";
import { useStore } from "@/module/useStore";
import SelectBox from "./SelectBox";
import { NodeKey } from "../node/Nodes";
import { useNodeIds } from "@/module/useNode";

export type Props = {
  keyName: string;
  label?: string;
  exceptedIds?: CanvasId[];
  nodeKeys?: NodeKey[];
};

const CanavsIdSelector: React.FC<Props> = (props) => {
  const ctxIds = useCtxIds();
  const nodeIds = useNodeIds(props.nodeKeys);
  const filteredIds = useMemo(
    () =>
      ctxIds
        .filter((id) => nodeIds.includes(id))
        .filter((id) => !(props.exceptedIds || []).includes(id))
        .map(String),
    [ctxIds, props.nodeKeys, props.exceptedIds]
  );
  const filteredIdLabels = useMemo(
    () => filteredIds.map((v) => `#${v}`),
    [filteredIds]
  );
  const [originalId, setOriginalId] = useStore<number>(props.keyName);

  return (
    <SelectBox
      onChange={(v: string) => setOriginalId(Number(v))}
      value={String(originalId || 0)}
      values={filteredIds}
      labels={filteredIdLabels}
      label={props.label || "canvas id"}
      minWidth={80}
      maxWidth={80}
    />
  );
};

export default CanavsIdSelector;
