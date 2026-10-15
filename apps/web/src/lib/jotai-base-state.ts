import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import type { Atom, WritableAtom } from 'jotai'
import { useAtomValue } from 'jotai'
import { useEffect, useLayoutEffect, useRef as useReactRef } from 'react'

import type { JotaiStore } from './jotai-types'

export type BaseState = ReturnType<typeof createBaseState>

export function createBaseState(store: JotaiStore) {
  function get<C extends object, T>(this: C, block: (ctx: C) => Atom<T>) {
    return store.get(block(this))
  }

  function useValue<C extends object, T>(this: C, block: (ctx: C) => Atom<T>) {
    return useAtomValue(block(this))
  }

  function useSync<C extends object, T, A extends unknown[]>(
    this: C,
    block: (ctx: C) => WritableAtom<T, A, void>,
    ...args: A
  ) {
    const a = block(this)
    return useEffect(() => {
      store.set(a, ...args)
    }, [a, store, ...args])
  }

  function useNullRegister<C extends object, T>(
    this: C,
    block: (ctx: C) => WritableAtom<null | T, [null | T], void>,
    value: null | T,
  ) {
    const a = block(this)
    // Latest value, updated during render so the cleanup below compares against the
    // newest value rather than the stale one captured when the cleanup was created.
    const valueRef = useReactRef(value)
    valueRef.current = value
    // Register in a layout effect rather than during render: a render-phase store.set
    // triggers React's "cannot update a component while rendering" warning when another
    // component subscribes to the atom. useLayoutEffect runs after render but before
    // paint, so children still observe the registered value on the first committed frame.
    //
    // On a value change the previous cleanup runs before this setup. Because valueRef
    // was already advanced to the new value during render, the cleanup's guard
    // (store.get(a) === valueRef.current) is false while the atom still holds the old
    // value, so the atom is never flipped through null between updates. The guard is
    // only true on unmount (no re-render, so the ref still matches what we wrote), where
    // it correctly resets to null. The setup guard skips a redundant write when the atom
    // already holds the value (e.g. another consumer registered it first).
    useLayoutEffect(() => {
      if (store.get(a) !== value) {
        const thunk = typeof value === 'function' ? ((() => value) as unknown as T) : value
        store.set(a, thunk)
      }
      return () => {
        if (store.get(a) === valueRef.current) {
          store.set(a, null)
        }
      }
    }, [a, value])
  }

  const toRef = createWeakMapFn(<T>(a: WritableAtom<T, [T], void>) => ({
    get current() {
      return store.get(a)
    },
    set current(value) {
      store.set(a, value)
    },
  }))

  function useRef<C extends object, T>(this: C, block: (ctx: C) => WritableAtom<T, [T], void>) {
    return toRef(block(this))
  }

  function ensure<C extends object, T>(this: C, block: (ctx: C) => Atom<null | T | undefined>) {
    const a = block(this)
    const value = store.get(a)
    if (value == null) {
      throw new Error(`${a.debugLabel || 'Atom'} is empty`)
    }
    return value
  }

  function set<C extends object, T, A extends unknown[]>(
    this: C,
    block: (ctx: C) => WritableAtom<T, A, void>,
    ...args: A
  ) {
    store.set(block(this), ...args)
  }

  return {
    store,
    get,
    useValue,
    useSync,
    toRef,
    useRef,
    useNullRegister,
    ref: useRef,
    ensure,
    set,
  }
}
