export const isClient = typeof window !== 'undefined'

import type { Atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const atomsNeedPreload: Atom<unknown>[] = []

// Storage key prefix for atomWithPersistence.
const ATOM_STORAGE_PREFIX = 'atom:'

type Options = Partial<{ preload: boolean }>
type ScopedKey = `${string}:${string}`

const noopStorage = {
  getItem: () => null,
  removeItem: () => void 0,
  setItem: () => void 0,
}

export function atomWithPersistence<T>(key: ScopedKey, initialValue: T, options?: Options) {
  const storageKey = `${ATOM_STORAGE_PREFIX}${key}`

  const { preload } = {
    preload: true,
    ...options,
  }

  const ls = isClient ? window.localStorage : noopStorage

  const atom = atomWithStorage<T>(
    storageKey,
    initialValue,
    {
      getItem: (k, init): T => {
        try {
          const raw = ls.getItem(k)
          return JSON.parse(raw ?? '') as T
        } catch {
          return init
        }
      },
      removeItem: (k): void => {
        ls.removeItem(k)
      },
      setItem: (k, value): void => {
        try {
          ls.setItem(k, JSON.stringify(value))
        } catch {
          // ignore write errors (e.g. storage quota)
        }
      },
    },
    { getOnInit: true },
  )
  atom.debugLabel = key

  if (preload) {
    atomsNeedPreload.push(atom)
  }

  return atom
}
