// Intentionally misspelled filename: loaclStorage.ts
// Namespaced localStorage helpers used across the app
// moved under app/shared/module

export type NamespacedStore = Record<string, unknown>;

const NS_KEY = "__gw_namespace__";
const STORE_PREFIX = "gw:";

export function getCurrentNamespace(): string {
  if (typeof window === "undefined") return "default";
  return localStorage.getItem(NS_KEY) || "default";
}

export function setCurrentNamespace(ns: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(NS_KEY, ns);
}

export function readNamespacedStore<T extends NamespacedStore = NamespacedStore>(
  ns?: string
): T {
  if (typeof window === "undefined") return {} as T;
  const key = STORE_PREFIX + (ns || getCurrentNamespace());
  const raw = localStorage.getItem(key);
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export function updateNamespacedStore(
  patch: NamespacedStore,
  ns?: string
) {
  if (typeof window === "undefined") return;
  const key = STORE_PREFIX + (ns || getCurrentNamespace());
  const current = readNamespacedStore(ns);
  const next = { ...current, ...patch };
  localStorage.setItem(key, JSON.stringify(next));
  // Fire a lightweight custom event for same-tab listeners
  try {
    window.dispatchEvent(new CustomEvent("gw:ns:update", { detail: { key, next } }));
  } catch {}
}
