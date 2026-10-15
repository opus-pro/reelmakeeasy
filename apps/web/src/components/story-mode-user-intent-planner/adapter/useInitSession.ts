'use client'

import { useEffect } from 'react'

import { useApi } from '@/hooks/useApi'
import { useCdnOrigin } from '@/hooks/useCdnOrigin'

import type { PlannerState } from '../state/planner-state'

import { getAdapterRuntimeAtom } from './adapter-atoms'
import { initializePlannerState } from './planner-api-bridge'

export function useInitSession(state: PlannerState, projectId: string) {
  const { createSSEConnection, fetchApiDomain } = useApi()
  const cdnOrigin = useCdnOrigin()

  useEffect(() => {
    initializePlannerState({
      cdnOrigin,
      createSSEConnection,
      fetchApiDomain,
      plannerState: state,
      sessionId: projectId,
    })
    const runtime = state.get(getAdapterRuntimeAtom)
    runtime?.start()
    return () => {
      runtime?.dispose()
    }
  }, [state, fetchApiDomain, createSSEConnection, projectId, cdnOrigin])
}
