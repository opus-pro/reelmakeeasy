export type Dethunk<T> = T extends () => infer R ? R : T

export type ValueOf<T> = T[keyof T]

/** Distributive Omit -- applies Omit to each member of a union individually. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends infer O ? Omit<O, K> : never

export type Falsy = 0 | 0n | '' | false | null | undefined

export type LooseParameters<T, F = never[]> = T extends (...args: infer A) => infer _R ? A : F

export type LooseReturnType<T, F = never> = T extends (...args: infer _A) => infer R ? R : F

export type MaybePromiseLike<T> = PromiseLike<T> | T

export type Mutable<T> = T extends infer O ? { -readonly [P in keyof O]: O[P] } : never

export type Nil = null | undefined

export type Thunk<T> = () => T
