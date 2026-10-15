'use client'

import { isEqual } from 'lodash-es'
import { useEffect, useRef } from 'react'

import { consumeUrlTransferEntry, putUrlTransferEntry } from '@/lib/url-transfer-registry'

import { useRefCallback } from './use-ref-callback'
import { useMutateQuery } from './useMutateQuery'
import { useQueryParams } from './useQueryParams'

export type UrlTransferKey<T, K extends string = string> = K & {
  // Type-only marker for compile-time payload inference.
  readonly __url_transfer_type__?: T
}

export type UrlTransferPayloadObject<K extends AnyUrlTransferKey = AnyUrlTransferKey> = {
  [P in K]?: UrlTransferValue<P>
}

type AnyUrlTransferKey = UrlTransferKey<unknown, string>

type UrlTransferValue<K extends AnyUrlTransferKey> =
  K extends UrlTransferKey<infer V, string> ? V : never

type UrlTransferValues<K extends readonly AnyUrlTransferKey[]> = {
  [I in keyof K]: K[I] extends AnyUrlTransferKey ? null | UrlTransferValue<K[I]> : never
}

type UseUrlTransferOptions = {
  mode?: 'push' | 'replace'
  once?: boolean
}

export function defineUrlTransferKey<T, K extends string = string>(
  queryKey: K,
): UrlTransferKey<T, K> {
  return queryKey as UrlTransferKey<T, K>
}

export function setUrlTransfer<K extends AnyUrlTransferKey>(
  payloads: UrlTransferPayloadObject<K>,
): Record<string, string> {
  // Returns a query object that can be passed directly to setQuery()/router.push().
  const query: Record<string, string> = {}

  Object.entries(payloads as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined) {
      return
    }
    const token = putUrlTransferEntry(key, value)
    query[key] = token
  })

  return query
}

export function useUrlTransfer<const K extends readonly AnyUrlTransferKey[]>(
  keys: K,
  onConsume: (...values: UrlTransferValues<K>) => void,
  options?: UseUrlTransferOptions,
) {
  const { all } = useQueryParams()
  const { removeQuery } = useMutateQuery()
  const consumeRef = useRefCallback(onConsume)
  const removeQueryRef = useRefCallback(removeQuery)
  const hasAttemptedRef = useRef(false)
  const lastTokenPairsRef = useRef<null | ReadonlyArray<readonly [string, string]>>(null)
  const paramsRef = useRef(all)
  const queryKeysRef = useRef(keys.map((key) => String(key)))
  const modeRef = useRef(options?.mode ?? 'replace')
  const onceValue = options?.once ?? false
  const onceRef = useRef(onceValue)
  const paramsSnapshot = all?.toString() ?? ''
  paramsRef.current = all
  queryKeysRef.current = keys.map((key) => String(key))
  modeRef.current = options?.mode ?? 'replace'
  onceRef.current = onceValue

  useEffect(() => {
    const isOnce = onceRef.current
    if (isOnce) {
      // Consume at most once per mount. This keeps transfer semantics one-shot.
      if (hasAttemptedRef.current) {
        return
      }
      hasAttemptedRef.current = true
    }

    const params = paramsRef.current
    const queryKeys = queryKeysRef.current
    const tokenPairs = queryKeys.map((key) => [key, params?.get(key) ?? ''] as const)
    if (!isOnce) {
      if (isEqual(lastTokenPairsRef.current, tokenPairs)) {
        return
      }
      lastTokenPairsRef.current = tokenPairs
    }

    const hitPairs = tokenPairs.filter(([, token]) => token !== '')
    if (hitPairs.length === 0) {
      return
    }

    const consumedValues = queryKeys.map((key) => {
      const token = params?.get(key) ?? ''
      if (!token) {
        return null
      }
      return consumeUrlTransferEntry(key, token)
    }) as UrlTransferValues<K>

    try {
      consumeRef(...consumedValues)
    } finally {
      // Always clear transfer params even if consumer logic throws.
      removeQueryRef(queryKeys, { mode: modeRef.current })
    }
  }, [onceValue, paramsSnapshot])
}
