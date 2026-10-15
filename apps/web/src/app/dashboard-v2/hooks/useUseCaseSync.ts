'use client'

import { useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'

import {
  dashboardSelectedUseCaseKeyAtom,
  DEFAULT_DASHBOARD_USE_CASE_KEY,
} from '@/app/dashboard-v2/state/dashboard-v2-atoms'
import {
  CREATE_USE_CASE_QUERY_PARAM,
  CREATE_USE_CASES,
  type CreateUseCaseKey,
} from '@/constants/create-use-cases'

type Params = {
  searchParams: null | SearchParamsLike | undefined
  selectedUseCaseKey: CreateUseCaseKey
  setQuery: SetQueryLike
}

type SearchParamsLike = {
  get: (name: string) => null | string
}

type SetQueryLike = (
  query: Record<string, string>,
  options?: {
    mode?: 'push' | 'replace'
  },
) => void

export function useUseCaseSync({ searchParams, selectedUseCaseKey, setQuery }: Params) {
  const setSelectedUseCaseKey = useSetAtom(dashboardSelectedUseCaseKeyAtom)
  const hasInitializedUseCaseQuerySyncRef = useRef(false)
  const previousSelectedUseCaseKeyRef = useRef(selectedUseCaseKey)

  useEffect(() => {
    const useCaseFromQuery = searchParams?.get(CREATE_USE_CASE_QUERY_PARAM)
    const nextUseCaseKey = useCaseFromQuery
      ? CREATE_USE_CASES.find((item) => item.key === useCaseFromQuery)?.key
      : undefined

    if (!nextUseCaseKey) {
      // No valid use case in the URL. The sidebar Home button (and browser back)
      // land on /home without the param, so reset the selection or the previous
      // use case view stays on screen and Home looks unresponsive.
      setSelectedUseCaseKey((prev) =>
        prev === DEFAULT_DASHBOARD_USE_CASE_KEY ? prev : DEFAULT_DASHBOARD_USE_CASE_KEY,
      )
      return
    }

    setSelectedUseCaseKey((prev) => (prev === nextUseCaseKey ? prev : nextUseCaseKey))
  }, [searchParams, setSelectedUseCaseKey])

  useEffect(() => {
    const previousSelectedUseCaseKey = previousSelectedUseCaseKeyRef.current
    previousSelectedUseCaseKeyRef.current = selectedUseCaseKey

    if (!hasInitializedUseCaseQuerySyncRef.current) {
      hasInitializedUseCaseQuerySyncRef.current = true
      return
    }

    if (previousSelectedUseCaseKey === selectedUseCaseKey) {
      return
    }

    const currentUseCaseInQuery = searchParams?.get(CREATE_USE_CASE_QUERY_PARAM)
    if (currentUseCaseInQuery === selectedUseCaseKey) {
      return
    }

    // The default use case with no ?create param is the canonical /home state
    // (it is where the Home button navigates), so skip the query write-back.
    if (!currentUseCaseInQuery && selectedUseCaseKey === DEFAULT_DASHBOARD_USE_CASE_KEY) {
      return
    }

    setQuery(
      {
        [CREATE_USE_CASE_QUERY_PARAM]: selectedUseCaseKey,
      },
      { mode: 'replace' },
    )
  }, [searchParams, selectedUseCaseKey, setQuery])
}
