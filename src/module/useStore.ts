import { useCallback, useEffect, useMemo } from "react";
import {
  addNamespacedStoreListener,
  addStoreListener,
  deleteNamespacedStore,
  deleteStore,
  get,
  getCurrentNamespace,
  removeNamespacedStoreListener,
  removeStoreListener,
  updateNamespacedStore,
  updateStore,
} from "./loaclStorage";
import useCounter from "./useCounter";

type Id = string | number;

const fetchId = (key: string, id?: Id) =>
  id !== undefined ? `${key}-${id}` : key;

export const useGlobalStore = <T>(
  key: string,
  id?: Id,
  initialValue?: T
): [T | null, (v: T) => void, () => void] => {
  const KEY = useMemo(() => fetchId(key, id), [key, id]);
  const [count, increment] = useCounter();
  const update = useCallback(
    (value: T) => {
      updateStore(KEY, value);
    },
    [KEY]
  );
  const del = useCallback(() => {
    deleteStore(KEY);
  }, [KEY]);
  const value = useMemo(
    () => get<T>(KEY) || initialValue || null,
    [KEY, count, initialValue]
  );
  useEffect(() => {
    addStoreListener(KEY, increment);
    return () => removeStoreListener(KEY, increment);
  }, []);
  return [value, update, del];
};

export function useStore<T>(
  key: string,
  id?: Id
): [T | null, (v: T) => void, () => void];          // initialValue なし

export function useStore<T>(
  key: string,
  id: Id | undefined,
  initialValue: T
): [T, (v: T) => void, () => void]; 

export function useStore <T>(
  key: string,
  id?: Id,
  initialValue?: T
): [ T | null, (v: T) => void, () => void] {
  const KEY = useMemo(() => fetchId(key, id), [key, id]);
  const [count, increment] = useCounter();
  const update = useCallback(
    (value: T) => {
      updateNamespacedStore(KEY, value);
    },
    [KEY]
  );
  const del = useCallback(() => {
    deleteNamespacedStore(KEY);
  }, [KEY]);
  const value = useMemo(
    () =>
      typeof initialValue === "boolean"
        ? getCurrentNamespace<T>(KEY)
        : getCurrentNamespace<T>(KEY) || initialValue || null,
    [KEY, initialValue, count]
  );
  useEffect(() => {
    if (value === null && initialValue !== undefined) update(initialValue);
  }, [initialValue]);
  useEffect(() => {
    addNamespacedStoreListener(KEY, increment);
    return () => removeNamespacedStoreListener(KEY, increment);
  }, [KEY, increment]);
  return [value, update, del];
};
