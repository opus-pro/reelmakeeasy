import { Getter, Setter } from 'jotai'
import { useAtomCallback } from 'jotai/utils'
import { useCallback, useRef } from 'react'

export function useRefAtomCallback<Result, Args extends unknown[]>(
  callback: (get: Getter, set: Setter, ...args: Args) => Result,
  options?: Parameters<typeof useAtomCallback>[1],
) {
  const ref = useRef(callback)
  ref.current = callback
  const callbackResult = useAtomCallback(
    (get, set, ...args) => ref.current(get, set, ...(args as Args)),
    options,
  ) as (...args: Args) => Result
  return useRefCallback(callbackResult)
}

export function useRefCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const ref = useRef<T>(callback)
  ref.current = callback
  return useCallback((...args: Parameters<T>) => ref.current(...args), [ref]) as T
}
