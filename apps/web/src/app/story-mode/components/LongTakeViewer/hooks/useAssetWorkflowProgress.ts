'use client'

import type { AssetState } from '@reelmakeeasy/common/media/types'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'
import type { CreateSSEConnection } from '@/hooks/useApi'

export type AssetWorkflowKind = 'keyframe_regen' | 'transition_regen'

export type AssetWorkflowProgressConnectionCallbacks<TResult> = {
  onCompleted?: (result: TResult | undefined, state: AssetState) => void
  onConnectionError?: (message: string) => void
  onFailed?: (error: AssetState['error'] | undefined, state: AssetState) => void
  onParseError?: () => void
}

export type AssetWorkflowProgressDisplay = {
  displayPercent: null | number
  progressPercent: null | number
  stage: NonNullable<AssetState['progress']>['stage'] | null
  status: 'idle' | 'processing'
  statusText: null | string
}

type UseAssetWorkflowProgressOptions = {
  createSSEConnection: CreateSSEConnection
  workflowKind: AssetWorkflowKind
}

const FEW_SECONDS_REMAINING_MS = 5_000
const REGEN_PROGRESS_CAP = 90

export function buildAssetWorkflowProgressDisplay({
  nowMs,
  startedAtMs,
  state,
  workflowKind,
}: {
  nowMs: number
  startedAtMs: null | number
  state: AssetState | null
  workflowKind: AssetWorkflowKind
}): AssetWorkflowProgressDisplay {
  if (!state) {
    return {
      displayPercent: null,
      progressPercent: null,
      stage: null,
      status: 'idle',
      statusText: null,
    }
  }

  const progressPercent =
    typeof state.progress?.percent === 'number' && !Number.isNaN(state.progress.percent)
      ? state.progress.percent
      : null
  const displayPercent = clampAssetWorkflowDisplayPercent(progressPercent)

  if (state.status !== 'processing') {
    return {
      displayPercent: null,
      progressPercent: null,
      stage: null,
      status: 'idle',
      statusText: null,
    }
  }

  if (progressPercent === null) {
    return {
      displayPercent: 0,
      progressPercent: null,
      stage: state.progress?.stage ?? null,
      status: state.status,
      statusText: 'Generating...',
    }
  }

  const averageDurationMs = getAssetWorkflowAverageDurationMs(workflowKind)
  const elapsedMs = Math.max(0, nowMs - (startedAtMs ?? nowMs))
  const remainingMs = Math.max(0, averageDurationMs - elapsedMs)
  const isAlmostDone =
    (displayPercent ?? 0) >= REGEN_PROGRESS_CAP || remainingMs <= FEW_SECONDS_REMAINING_MS

  return {
    displayPercent: displayPercent ?? 0,
    progressPercent,
    stage: state.progress?.stage ?? null,
    status: state.status,
    statusText: isAlmostDone
      ? 'Complete in few seconds...'
      : `Complete in ${Math.max(1, Math.ceil(remainingMs / 1000))}s...`,
  }
}

export function clampAssetWorkflowDisplayPercent(progressPercent?: null | number): null | number {
  if (typeof progressPercent !== 'number' || Number.isNaN(progressPercent)) {
    return null
  }

  return Math.max(0, Math.min(REGEN_PROGRESS_CAP, progressPercent))
}

export function getAssetWorkflowAverageDurationMs(workflowKind: AssetWorkflowKind): number {
  return workflowKind === 'keyframe_regen' ? 45_000 : 90_000
}

export function useAssetWorkflowProgress<TResult>({
  createSSEConnection,
  workflowKind,
}: UseAssetWorkflowProgressOptions) {
  const connectionRef = useRef<null | ReturnType<CreateSSEConnection>>(null)
  const startedAtRef = useRef<null | number>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [state, setState] = useState<AssetState | null>(null)

  const reset = useRefCallback(() => {
    connectionRef.current?.close()
    connectionRef.current = null
    startedAtRef.current = null
    setState(null)
  })

  useEffect(() => reset, [reset])

  useEffect(() => {
    if (state?.status !== 'processing') {
      return
    }

    const timerId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [state?.status])

  const connect = useRefCallback(
    (streamPath: string, callbacks?: AssetWorkflowProgressConnectionCallbacks<TResult>): void => {
      reset()

      startedAtRef.current = Date.now()
      setNowMs(Date.now())
      setState({
        status: 'processing',
        updatedAt: Date.now(),
      })

      const connection = createSSEConnection(streamPath, {
        message: () => void 0,
        update: async (payload: { data: string }) => {
          let nextState: AssetState

          try {
            nextState = JSON.parse(payload.data) as AssetState
          } catch {
            reset()
            callbacks?.onParseError?.()
            return
          }

          if (!nextState || typeof nextState !== 'object' || typeof nextState.status !== 'string') {
            reset()
            callbacks?.onParseError?.()
            return
          }

          if (nextState.status === 'completed') {
            const result =
              (nextState.result as TResult | undefined) ?? (undefined as TResult | undefined)
            reset()
            callbacks?.onCompleted?.(result, nextState)
            return
          }

          if (nextState.status === 'failed') {
            reset()
            callbacks?.onFailed?.(nextState.error, nextState)
            return
          }

          setState(nextState)
        },
        error: (payload: { data?: string; raw_error?: Error }) => {
          if (payload.raw_error?.name === 'AbortError') {
            return
          }

          const message =
            payload.data || payload.raw_error?.message || 'Lost connection to regeneration progress'
          reset()
          callbacks?.onConnectionError?.(message)
        },
      })

      connectionRef.current = connection

      void connection.start().catch((error: Error) => {
        if (error.name === 'AbortError' || connectionRef.current !== connection) {
          return
        }

        const message = error.message || 'Lost connection to regeneration progress'
        reset()
        callbacks?.onConnectionError?.(message)
      })
    },
  )

  const display = useMemo(
    () =>
      buildAssetWorkflowProgressDisplay({
        nowMs,
        startedAtMs: startedAtRef.current,
        state,
        workflowKind,
      }),
    [nowMs, state, workflowKind],
  )

  return {
    connect,
    reset,
    ...display,
  }
}
