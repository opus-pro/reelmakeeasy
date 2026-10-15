import type { Atom, PrimitiveAtom } from 'jotai'
import { atom, useAtomValue } from 'jotai'

import { JotaiStore } from './jotai-types'

export function createAtom<T>(initialValue: T, debugLabel?: string): PrimitiveAtom<T> {
  const a = atom(initialValue)
  if (debugLabel) {
    a.debugLabel = debugLabel
  }
  return a
}

export function createNullableAtom<T>(debugLabel?: string): PrimitiveAtom<null | T> {
  return createAtom<null | T>(null, debugLabel)
}

const UNDEFINED_ATOM: Atom<undefined> = atom(undefined)

export type FalsyValue = 0 | 0n | '' | false | null | undefined

export function useFalsyAtomValue<T>(targetAtom?: Atom<T> | FalsyValue) {
  return useAtomValue(targetAtom || UNDEFINED_ATOM)
}

export function useNullableAtomValue<T>(targetAtom?: Atom<T> | null) {
  return useAtomValue(targetAtom ?? UNDEFINED_ATOM)
}

export function when<T, R extends T>(
  store: JotaiStore,
  atom: Atom<T>,
  isOkFn: (value: T) => value is R,
  whenOk: (value: R) => void,
): (() => void) | undefined
export function when<T>(
  store: JotaiStore,
  atom: Atom<T>,
  isOkFn: (value: T) => unknown,
  whenOk: (value: T) => void,
): (() => void) | undefined
export function when<T>(
  store: JotaiStore,
  atom: Atom<T>,
  isOkFn: (value: T) => unknown,
  whenOk: (value: T) => void,
) {
  const value = store.get(atom)
  const ok = isOkFn(value)
  if (ok) {
    whenOk(value)
    return
  }
  const dispose = store.sub(atom, () => {
    const value = store.get(atom)
    const ok = isOkFn(value)
    if (ok) {
      whenOk(value)
      dispose()
    }
  })
  return dispose
}

export function whenNonNullable<T>(
  store: JotaiStore,
  atom: Atom<T>,
  whenOk: (value: NonNullable<T>) => void,
) {
  const value = store.get(atom)
  if (value != null) {
    whenOk(value)
    return
  }
  const dispose = store.sub(atom, () => {
    const value = store.get(atom)
    if (value != null) {
      whenOk(value)
      dispose()
    }
  })
  return dispose
}
