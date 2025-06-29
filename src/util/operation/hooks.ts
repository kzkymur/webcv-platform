import { useCallback, useMemo } from "react";
import { useStore } from "@/module/useStore";
import { NodeId } from "@/node/Node";
import { Operation, OperationId, OperationType } from ".";
import {
  getCurrentNamespace,
  updateNamespacedStore,
} from "@/module/loaclStorage";

export type OperationMap = Record<OperationId, OperationType>;

export const getOperationKey = (
  operationType: OperationType,
  parentId: NodeId,
  id: OperationId
) => `${operationType}-${parentId}-${id}`;

export const operationMapKey = (id: NodeId) => `operation-map-${id}`;
const latestOperationIdKey = (id: NodeId) => `latest-operation-id-${id}`;

export const useOperationMap = (
  id: NodeId
): [
    OperationMap,
    OperationId,
    (o: Operation) => void,
    (id: OperationId) => void
  ] => {
  const [operationMap, setOperationMap] = useStore<OperationMap>(
    operationMapKey(id),
    undefined,
    {}
  );
  const [latestOperationId, setLatestOperationId] = useStore<OperationId>(
    latestOperationIdKey(id),
    undefined,
    1
  );

  const add = useCallback(
    (operation: Omit<Operation, "id">) => {
      if (latestOperationId === null) return;
      setOperationMap({
        ...operationMap,
        [latestOperationId]: operation.type,
      });
      updateNamespacedStore(
        getOperationKey(operation.type, id, latestOperationId),
        operation
      );
      setLatestOperationId(latestOperationId + 1);
    },
    [latestOperationId, operationMap, id]
  );

  const del = useCallback(
    (operationId: OperationId) => {
      const copyMap = { ...operationMap };
      delete copyMap[operationId];
      setOperationMap(copyMap);
    },
    [operationMap]
  );

  return [operationMap || {}, latestOperationId || 0, add, del];
};

export const useOperationIds = (
  id: NodeId,
  targetTypes?: OperationType[]
): OperationId[] => {
  const [map] = useStore<OperationMap>(operationMapKey(id), undefined, {});
  const targetIds = useMemo<number[]>(
    () =>
      map !== null
        ? (Object.entries(map)
          .map(([id, type]) =>
            targetTypes === undefined
              ? Number(id)
              : targetTypes.includes(type)
                ? Number(id)
                : undefined
          )
          .filter((v) => v !== undefined) as number[])
        : [],
    [targetTypes, map]
  );
  return targetIds;
};

export const useOperation = (
  parentId: NodeId,
  id: OperationId
): [Operation | null, (v: Operation) => void, () => void] => {
  const [map, , , delFromMap] = useOperationMap(parentId);
  const operationType = useMemo(() => map![id] || null, [map, id]);
  const key = useMemo(
    () => getOperationKey(operationType, parentId, id),
    [operationType, parentId, id]
  );
  const [operation, setOperation, delOperation] = useStore<Operation>(key);
  const del = useCallback(() => {
    delOperation();
    delFromMap(id);
  }, [id, delFromMap, delOperation]);
  return [operation, setOperation, del];
};

export const useOperations = (parentId: NodeId): Operation[] => {
  const [map] = useOperationMap(parentId);
  const operations = useMemo(
    () =>
      Object.keys(map)
        .map((id: string) => {
          return getCurrentNamespace<Operation>(
            getOperationKey(map[Number(id)], parentId, Number(id))
          );
        })
        .filter((o) => o !== null) as Operation[],
    [map]
  );
  return operations;
};
