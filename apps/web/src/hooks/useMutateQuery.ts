// hooks/useMutateQuery.ts
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type NextNavigateOptions = NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]>

type QueryMutation =
  | {
      keys: string[]
      kind: 'remove'
      options?: QueryNavOptions
      pathnameSnapshot: string
      router: ReturnType<typeof useRouter>
      searchSnapshot: string
    }
  | {
      kind: 'set'
      options?: QueryNavOptions
      pathnameSnapshot: string
      query: Record<string, string>
      router: ReturnType<typeof useRouter>
      searchSnapshot: string
    }

type QueryNavOptions = NextNavigateOptions & {
  mode?: 'push' | 'replace'
  pathname?: string
}

let pendingMutations: QueryMutation[] = []
let flushScheduled = false

export function useMutateQuery() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname() ?? ''

  const setQuery = (query: Record<string, string>, options?: QueryNavOptions) => {
    enqueueQueryMutation({
      kind: 'set',
      options,
      pathnameSnapshot: pathname,
      query,
      router,
      searchSnapshot: searchParams?.toString() ?? '',
    })
  }

  const removeQuery = (keys: string[], options?: QueryNavOptions) => {
    enqueueQueryMutation({
      kind: 'remove',
      keys: [...keys],
      options,
      pathnameSnapshot: pathname,
      router,
      searchSnapshot: searchParams?.toString() ?? '',
    })
  }

  return {
    removeQuery,
    setQuery,
  }
}

function enqueueQueryMutation(mutation: QueryMutation) {
  pendingMutations.push(mutation)

  if (flushScheduled) {
    return
  }

  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    flushQueryMutations()
  })
}

function flushQueryMutations() {
  if (pendingMutations.length === 0) {
    return
  }

  const mutations = pendingMutations
  pendingMutations = []

  const fallbackMutation = mutations[mutations.length - 1]
  const { pathname: locationPathname, search: locationSearch } = resolveCurrentLocation(
    fallbackMutation.pathnameSnapshot,
    fallbackMutation.searchSnapshot,
  )
  const startingQuery = stripLeadingQuestionMark(locationSearch)
  const params = new URLSearchParams(startingQuery)
  const shouldNavigateBySet = mutations.some((mutation) => mutation.kind === 'set')
  let removedAny = false

  mutations.forEach((mutation) => {
    if (mutation.kind === 'set') {
      Object.entries(mutation.query).forEach(([key, value]) => {
        params.set(key, value)
      })
      return
    }

    mutation.keys.forEach((key) => {
      if (params.has(key)) {
        removedAny = true
      }
      params.delete(key)
    })
  })

  const finalMutation = mutations[mutations.length - 1]
  const { mode, pathname: nextPathname, ...routerOptions } = finalMutation.options ?? {}
  const targetPath = nextPathname ?? finalMutation.pathnameSnapshot
  const query = params.toString()
  const targetUrl = query ? `${targetPath}?${query}` : targetPath
  const currentUrl = startingQuery ? `${locationPathname}?${startingQuery}` : locationPathname

  if (!shouldNavigateBySet && !removedAny && targetUrl === currentUrl) {
    return
  }

  const targetPathname = targetUrl.split('?')[0]
  if (typeof window !== 'undefined' && targetPathname === locationPathname) {
    // Next.js static export bug: router.replace/push for same-pathname query changes calls
    // replaceState with a stale cached url. Use the history api directly instead; Next.js
    // patches these methods and syncs useSearchParams on static routes. NOTE: on statically
    // exported dynamic [param] routes reached via client-side navigation this does NOT
    // refresh useSearchParams; such pages must drive view state locally.
    // Keep the state argument null: Next's patched history methods copy their
    // internals (__NA + tree) onto external writes AND dispatch the
    // useSearchParams/usePathname sync -- but only when the state does NOT
    // already carry __NA. Passing history.state through skips that sync.
    const historyMethod = mode === 'replace' ? 'replaceState' : 'pushState'
    window.history[historyMethod](null, '', targetUrl)
  } else {
    const navigate = mode === 'replace' ? finalMutation.router.replace : finalMutation.router.push
    navigate(targetUrl, { scroll: false, ...routerOptions })
  }
}

function resolveCurrentLocation(pathnameSnapshot: string, searchSnapshot: string) {
  if (typeof window === 'undefined') {
    return {
      pathname: pathnameSnapshot,
      search: searchSnapshot ? `?${searchSnapshot}` : '',
    }
  }

  return {
    pathname: window.location.pathname || pathnameSnapshot,
    search: window.location.search,
  }
}

function stripLeadingQuestionMark(value: string): string {
  return value.startsWith('?') ? value.slice(1) : value
}
