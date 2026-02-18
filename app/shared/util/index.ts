// Minimal utility types for legacy modules
export type Brand<T, B extends string> = T & { __brand: B };
