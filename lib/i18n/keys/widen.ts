/** Zet letterlijke `as const`-types om naar gewone strings, recursief. */
export type Widen<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
};
