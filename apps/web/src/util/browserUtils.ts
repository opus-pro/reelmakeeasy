'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

export type SharedMediaQuery = {
  dispose: () => void
  getMatches: () => boolean
  query: string
  subscribe: (onStoreChange: () => void) => () => void
  useMatches: () => boolean
}

type MediaQueryStore = {
  dispose: () => void
  getSnapshot: () => boolean
  release: () => void
  retain: () => void
  subscribe: (onStoreChange: () => void) => () => void
}

const mediaQueryStores = new Map<string, MediaQueryStore>()
const noop = () => undefined

export function createSharedMediaQuery(query: string): SharedMediaQuery {
  const store = getMediaQueryStore(query)
  let disposed = false
  store.retain()

  const releaseStore = () => {
    if (disposed) {
      return
    }
    disposed = true
    store.release()
  }

  return {
    query,
    getMatches: () => store.getSnapshot(),
    subscribe: (onStoreChange: () => void) => {
      if (disposed) {
        return noop
      }
      return store.subscribe(onStoreChange)
    },
    useMatches: () => useSyncExternalStore(store.subscribe, store.getSnapshot, () => false),
    dispose: releaseStore,
  }
}

/**
 * Reads a breakpoint through the query Tailwind's own `max-*` variant compiles to, so
 * `isBelowLg` and the `lg:` classes agree at every width including 1024px itself, where
 * `lg:` starts applying. Don't reach for a plain `max-width`: it answers the
 * boundary pixel the other way, and it matches nothing without matchMedia (SSR, jsdom),
 * reporting an unmeasurable viewport as mobile instead of desktop.
 */
export function useBreakpoint<K extends keyof typeof breakpoints>(breakpointKey: K) {
  const breakpointValue = breakpoints[breakpointKey as keyof typeof breakpoints]
  const isBelow = useSharedMediaQuery(`not all and (min-width: ${breakpointValue})`)
  return getBreakpointResult(breakpointKey, breakpointValue, isBelow)
}

/**
 * One-time client breakpoint for route/session entry decisions. Unlike useBreakpoint,
 * this starts unresolved so callers never act on the desktop SSR fallback.
 * It then freezes the first client value, avoiding resize/rotation redirects or
 * surface swaps that would discard active work.
 */
export function useInitialBreakpoint<K extends keyof typeof breakpoints>(breakpointKey: K) {
  const breakpointValue = breakpoints[breakpointKey as keyof typeof breakpoints]
  const [isBelow, setIsBelow] = useState<boolean | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setIsBelow(false)
      return
    }

    setIsBelow(window.matchMedia(`not all and (min-width: ${breakpointValue})`).matches)
  }, [breakpointValue])

  return {
    ...getBreakpointResult(breakpointKey, breakpointValue, isBelow ?? false),
    isResolved: isBelow !== null,
  }
}

function getBreakpointResult<K extends keyof typeof breakpoints>(
  breakpointKey: K,
  breakpointValue: string,
  isBelow: boolean,
) {
  const capitalizedKey = breakpointKey[0].toUpperCase() + breakpointKey.slice(1)

  type KeyAbove = `isAbove${Capitalize<K>}`
  type KeyBelow = `isBelow${Capitalize<K>}`

  return {
    [breakpointKey]: Number(String(breakpointValue).replace(/[^0-9]/g, '')),
    [`isAbove${capitalizedKey}`]: !isBelow,
    [`isBelow${capitalizedKey}`]: isBelow,
  } as Record<K, number> & Record<KeyAbove | KeyBelow, boolean>
}

/**
 * The breakpoint every mobile layout branch here keys off, kept as one string so
 * a rendered layout and anything reporting on it cannot disagree.
 *
 * Pairs with Tailwind's `max-sm` variant, which compiles to
 * `not all and (min-width: 640px)` -- i.e. strictly below 640. This query is
 * inclusive, so the two disagree on a viewport of exactly 640px, where CSS lays
 * out desktop and this reads mobile. That 1px seam is shared by every component
 * that pairs `useIsMobile()` with `max-sm:` classes; `useBreakpoint` reads the
 * negated `min-width` and has none. Closing it here touches 70+ call sites, so
 * it ships separately.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 640px)'

export function useIsMobile() {
  return useSharedMediaQuery(MOBILE_MEDIA_QUERY)
}

/**
 * Non-hook read of MOBILE_MEDIA_QUERY, for code that runs outside render (an
 * analytics call at fire time). Reports the viewport, NOT the device: a
 * narrowed desktop window reads mobile because that is the layout that
 * rendered. Returns false when there is no window (SSR).
 */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

export function useSharedMediaQuery(query: string) {
  const store = getMediaQueryStore(query)
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => false)
}

function getMediaQueryStore(query: string): MediaQueryStore {
  const existingStore = mediaQueryStores.get(query)
  if (existingStore) {
    return existingStore
  }

  const listeners = new Set<() => void>()
  let retainedCount = 0
  const mediaQueryList =
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? null
      : window.matchMedia(query)

  const emitChange = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const cleanupIfUnused = () => {
    const isUnused = retainedCount === 0 && listeners.size === 0
    if (!isUnused) {
      return
    }
    if (mediaQueryList) {
      mediaQueryList.removeEventListener('change', emitChange)
    }
    mediaQueryStores.delete(query)
  }

  const subscribe = (onStoreChange: () => void) => {
    const shouldAttachListener = listeners.size === 0
    listeners.add(onStoreChange)
    if (shouldAttachListener && mediaQueryList) {
      mediaQueryList.addEventListener('change', emitChange)
    }

    return () => {
      listeners.delete(onStoreChange)
      if (listeners.size === 0 && mediaQueryList) {
        mediaQueryList.removeEventListener('change', emitChange)
      }
      cleanupIfUnused()
    }
  }

  const store: MediaQueryStore = {
    dispose: () => {
      listeners.clear()
      if (mediaQueryList) {
        mediaQueryList.removeEventListener('change', emitChange)
      }
      retainedCount = 0
      mediaQueryStores.delete(query)
    },
    getSnapshot: () => mediaQueryList?.matches ?? false,
    release: () => {
      retainedCount = Math.max(0, retainedCount - 1)
      cleanupIfUnused()
    },
    retain: () => {
      retainedCount += 1
    },
    subscribe,
  }

  mediaQueryStores.set(query, store)
  return store
}

const breakpoints = {
  xs: '480px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
}
