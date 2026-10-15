export type UpdaterFn<T> = (prev: T) => T
export type UpdaterFnOrValue<T> = T | UpdaterFn<T>

export function evalValueUpdater<T>(value: UpdaterFnOrValue<T>, prev: T): T {
  if (typeof value !== 'function') {
    return value
  }
  return (value as UpdaterFn<T>)(prev)
}
