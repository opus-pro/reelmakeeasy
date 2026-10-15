import type { FetcherData, IFetcher } from '@reelmakeeasy/common/utils/fetcher'
import type { Atom } from 'jotai'
import { atom, useAtomValue, useStore } from 'jotai'

import type { FalsyValue } from './jotai-atom-utils'
import type { JotaiStore } from './jotai-types'

type StoreEntry = {
  readonly map: WeakMap<IFetcher<unknown>, Atom<FetcherData<unknown>>>
  readonly ref: WeakRef<JotaiStore>
}

const fetcherStoreAtoms = new WeakMap<JotaiStore, StoreEntry>()

/**
 * Bridges Fetcher updates into Jotai's dependency graph.
 *
 * In atom read functions, prefer `get(getFetcherAtom(store, fetcher))` over
 * reading `fetcher.data` directly. Direct `fetcher.data` access is a snapshot
 * read and will not be tracked as a reactive Jotai dependency.
 */
export function getFetcherAtom<T>(store: JotaiStore, fetcher: IFetcher<T>): Atom<FetcherData<T>> {
  let entry = fetcherStoreAtoms.get(store)
  if (!entry) {
    entry = { map: new WeakMap(), ref: new WeakRef(store) }
    fetcherStoreAtoms.set(store, entry)
  }

  const existed = entry.map.get(fetcher as IFetcher<unknown>)
  if (existed) {
    return existed as Atom<FetcherData<T>>
  }

  const a = atom(fetcher.data)
  const { ref } = entry
  const dispose = fetcher.onDataChange((data) => {
    const s = ref.deref()
    if (!s) {
      dispose()
      return
    }
    s.set(a, data)
  })

  entry.map.set(fetcher as IFetcher<unknown>, a)
  return a
}

const NULL_ATOM = atom<null>(null)

export function useFetcherData<T>(
  fetcher: IFetcher<T>,
  options?: { store?: JotaiStore },
): FetcherData<T>
export function useFetcherData<T>(
  fetcher: FalsyValue | IFetcher<T>,
  options?: { store?: JotaiStore },
): FetcherData<T> | null
export function useFetcherData<T>(
  fetcher: FalsyValue | IFetcher<T>,
  options?: { store?: JotaiStore },
): FetcherData<T> | null {
  const store = options?.store ?? useStore()
  const a = fetcher ? getFetcherAtom(store, fetcher) : NULL_ATOM
  return useAtomValue(a) as FetcherData<T> | null
}
