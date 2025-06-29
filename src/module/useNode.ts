import { NodeKey } from "@/node/Nodes";
import { useStore } from "./useStore";
import { useCallback, useMemo } from "react";
import { NodeId } from "@/node/Node";

type NodeMap = Record<NodeId, NodeKey>;

const nodeMapKey = "node-map";
const latestNodeIdKey = "latest-node-id";

export const useNodeMap = (): [
  NodeMap,
  (n: NodeKey) => void,
  (id: NodeId) => void
] => {
  const [nodeMap, setNodeMap] = useStore<NodeMap>(nodeMapKey, undefined, {});
  const [latestNodeId, setLatestNodeId] = useStore<NodeId>(
    latestNodeIdKey,
    undefined,
    1
  );

  const add = useCallback(
    (nodeKey: NodeKey) => {
      setNodeMap({
        ...nodeMap,
        [latestNodeId!]: nodeKey,
      });
      setLatestNodeId(latestNodeId! + 1);
    },
    [latestNodeId, nodeMap]
  );

  const del = useCallback(
    (nodeId: NodeId) => {
      const copyNodeMap = { ...nodeMap };
      delete copyNodeMap[nodeId];
      setNodeMap(copyNodeMap);
    },
    [nodeMap]
  );

  return [nodeMap!, add, del];
};

export const useNodeIds = (targetNodeKeys?: NodeKey[]): NodeId[] => {
  const [nodeMap] = useStore<NodeMap>(nodeMapKey, undefined, {});
  const targetNodeIds = useMemo<number[]>(
    () =>
      nodeMap !== null
        ? (Object.entries(nodeMap)
          .map(([id, key]) =>
            targetNodeKeys === undefined
              ? Number(id)
              : targetNodeKeys.includes(key)
                ? Number(id)
                : undefined
          )
          .filter((v) => v !== undefined) as number[])
        : [],
    [targetNodeKeys, nodeMap]
  );
  return targetNodeIds;
};
