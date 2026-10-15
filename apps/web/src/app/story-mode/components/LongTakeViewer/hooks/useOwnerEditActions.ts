'use client'

import type { TransitionRegenWorkflowResult } from '@shared/types/api/long-take'
import { toast } from '@shared/ui'
import { useMutation } from '@tanstack/react-query'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useRef } from 'react'

import type { StoryTransitionSegment } from '@/app/story-mode/long-take.types'
import { longtakeHistoryStore } from '@/atom/longtake-history.store'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { ApiError, isApiError } from '@/lib/api-error'

import { useAssetWorkflowProgress } from './useAssetWorkflowProgress'

export type RegenerateTransitionCallbacks = {
  onFailure?: () => void
  onSuccess?: () => void
}

export type RegenerateTransitionOptions = {
  keyframeDriven?: boolean
  targetTransitionId?: string
}

const BLOCKED_UNSUPPORTED_REQUEST_CODE = 'blockedUnsupportedRequest'

type UseOwnerEditActionsResult = {
  activeTransitionProgress: null | {
    statusText: string
  }
  handleRegenerateTransition: (
    prompt: string,
    callbacks?: RegenerateTransitionCallbacks,
    options?: RegenerateTransitionOptions,
  ) => void
  isRegeneratingTransition: boolean
  regeneratingTransitionIds: Set<string>
}

export function useOwnerEditActions(
  projectId: string,
  activeTransition: null | StoryTransitionSegment,
): UseOwnerEditActionsResult {
  const { fetchApiDomain, createSSEConnection } = useApi()
  const buildTransitionRegenerateContext = useAtomValue(
    longtakeHistoryStore.transitionRegenerateContextAtom,
  )
  const applyRegeneratedTransitions = useSetAtom(
    longtakeHistoryStore.applyRegeneratedTransitionsAtom,
  )
  const store = useStore()
  const [regeneratingTransitionIds, setRegeneratingTransitionIds] = useAtom(
    longtakeHistoryStore.regeneratingTransitionIdsAtom,
  )
  const activeTransitionRegenRef = useRef<null | {
    affectedTransitionIds: string[]
    transitionId: string
  }>(null)
  const {
    connect: connectTransitionProgress,
    reset: resetTransitionProgress,
    statusText: transitionStatusText,
  } = useAssetWorkflowProgress<TransitionRegenWorkflowResult[]>({
    createSSEConnection,
    workflowKind: 'transition_regen',
  })

  const addRegeneratingIds = useRefCallback((transitionIds: string[]) => {
    setRegeneratingTransitionIds((prev: Set<string>) => {
      const next = new Set(prev)
      for (const transitionId of transitionIds) {
        next.add(transitionId)
      }
      return next
    })
  })

  const removeRegeneratingIds = useRefCallback((transitionIds: string[]) => {
    setRegeneratingTransitionIds((prev: Set<string>) => {
      const next = new Set(prev)
      for (const transitionId of transitionIds) {
        next.delete(transitionId)
      }
      return next
    })
  })

  const clearActiveRegenState = useRefCallback(() => {
    const activeRegen = activeTransitionRegenRef.current
    resetTransitionProgress()
    if (!activeRegen) {
      return
    }

    removeRegeneratingIds(activeRegen.affectedTransitionIds)
    activeTransitionRegenRef.current = null
  })

  const clearRegenState = useRefCallback(
    (affectedTransitionIds: string[], transitionId: string) => {
      resetTransitionProgress()
      removeRegeneratingIds(affectedTransitionIds)

      if (activeTransitionRegenRef.current?.transitionId === transitionId) {
        activeTransitionRegenRef.current = null
      }
    },
  )

  const finalizeRegen = useRefCallback(
    (
      affectedTransitionIds: string[],
      transitionId: string,
      message?: string,
      showVerbatim = false,
    ) => {
      clearRegenState(affectedTransitionIds, transitionId)
      if (!message) {
        return
      }

      if (showVerbatim) {
        toast.error(message, { duration: Infinity })
        return
      }

      toast.error('Something went wrong. Please try again.', { duration: Infinity })
    },
  )

  const connectRegenSSE = useRefCallback(
    (
      transitionId: string,
      affectedTransitionIds: string[],
      callbacks?: RegenerateTransitionCallbacks,
    ) => {
      connectTransitionProgress(
        `/api/long-take-videos/${projectId}/transitions/${transitionId}/regenerate/stream`,
        {
          onCompleted: (result) => {
            const workflowResults = normalizeWorkflowResultsForApply(affectedTransitionIds, result)
            if (!workflowResults) {
              const failReason = 'Regenerated video URL is missing'
              callbacks?.onFailure?.()
              finalizeRegen(affectedTransitionIds, transitionId, failReason)
              return
            }

            const applied = applyRegeneratedTransitions({
              affectedTransitionIds,
              workflowResults,
            })
            if (!applied) {
              callbacks?.onFailure?.()
              finalizeRegen(
                affectedTransitionIds,
                transitionId,
                "Couldn't apply the regenerated shot. Refresh and try again.",
                true,
              )
              return
            }

            callbacks?.onSuccess?.()
            finalizeRegen(affectedTransitionIds, transitionId)
            toast.success(
              store.get(longtakeHistoryStore.renderRequiredAtom)
                ? 'Regenerated. Hit Download to apply it to your video'
                : 'Transition regenerated',
            )
          },
          onConnectionError: (failReason) => {
            callbacks?.onFailure?.()
            finalizeRegen(affectedTransitionIds, transitionId, failReason, false)
          },
          onFailed: (error) => {
            const failReason = error?.message || 'Regeneration failed'

            callbacks?.onFailure?.()
            finalizeRegen(
              affectedTransitionIds,
              transitionId,
              failReason,
              error?.code === BLOCKED_UNSUPPORTED_REQUEST_CODE,
            )
          },
          onParseError: () => {
            callbacks?.onFailure?.()
            clearRegenState(affectedTransitionIds, transitionId)
            toast.error('Something went wrong. Please try again.', { duration: Infinity })
          },
        },
      )
    },
  )

  const regenTransitionMutation = useMutation({
    mutationFn: ({
      body,
      transitionId,
    }: {
      affectedTransitionIds: string[]
      body: {
        keyframeDriven?: boolean
        prompt: string
        transitionList: Array<{
          firstFrameUrl: string
          lastFrameUrl: string
          transitionId: string
        }>
      }
      callbacks?: RegenerateTransitionCallbacks
      transitionId: string
    }) =>
      fetchApiDomain<{ workflowId: string }>(
        `/api/long-take-videos/${projectId}/transitions/${transitionId}/regenerate`,
        { method: 'POST', data: body },
      ),
    onMutate: ({ affectedTransitionIds, transitionId }) => {
      clearActiveRegenState()
      addRegeneratingIds(affectedTransitionIds)
      activeTransitionRegenRef.current = {
        affectedTransitionIds,
        transitionId,
      }
    },
    onSuccess: (res, { affectedTransitionIds, callbacks, transitionId }) => {
      if (!res.ok) {
        const errRes = res as { code?: string; error?: string; status?: number }
        throw new ApiError(errRes.error || 'Regeneration failed', errRes.status ?? 0, errRes.code)
      }
      connectRegenSSE(transitionId, affectedTransitionIds, callbacks)
    },
    onError: (err, { affectedTransitionIds, callbacks, transitionId }) => {
      const failReason = err instanceof Error ? err.message : 'Regeneration failed'
      callbacks?.onFailure?.()
      // ApiError carries an actionable backend message; raw network errors do not.
      finalizeRegen(affectedTransitionIds, transitionId, failReason, isApiError(err))
    },
  })

  const handleRegenerateTransition = useRefCallback(
    (
      prompt: string,
      callbacks?: RegenerateTransitionCallbacks,
      options?: RegenerateTransitionOptions,
    ) => {
      const transitionId = options?.targetTransitionId ?? activeTransition?.transitionId
      if (!transitionId) {
        return
      }
      const context = buildTransitionRegenerateContext(transitionId, prompt)
      if (!context) {
        toast.error('Something went wrong. Please try again.')
        return
      }
      // Only the explicit keyframe-apply path may suppress the timeline_edit block. Inferring it
      // from stale state would let a typed "remove this shot" bypass the block after a keyframe edit.
      const keyframeDriven = options?.keyframeDriven ?? false

      regenTransitionMutation.mutate({
        affectedTransitionIds: context.affectedTransitionIds,
        body: { ...context.body, keyframeDriven },
        callbacks,
        transitionId,
      })
    },
  )

  const activeTransitionId = activeTransition?.transitionId ?? ''
  const activeTransitionProgress = regeneratingTransitionIds.has(activeTransitionId)
    ? {
        statusText: transitionStatusText ?? 'Generating...',
      }
    : null

  return {
    activeTransitionProgress,
    handleRegenerateTransition,
    isRegeneratingTransition: regeneratingTransitionIds.has(activeTransitionId),
    regeneratingTransitionIds,
  }
}

/** Normalize SSE `result` so every affected id has a non-empty fileUri, or return null. */
function normalizeWorkflowResultsForApply(
  affectedIds: string[],
  results: unknown,
): null | TransitionRegenWorkflowResult[] {
  if (!Array.isArray(results) || affectedIds.length === 0) {
    return null
  }
  const map = new Map<string, string>()
  for (const item of results) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const transitionId = (item as { transitionId?: string }).transitionId
    const raw = (item as { fileUri?: string }).fileUri
    if (typeof transitionId !== 'string' || typeof raw !== 'string' || !raw.trim()) {
      continue
    }
    map.set(transitionId, raw.trim())
  }
  const out: TransitionRegenWorkflowResult[] = []
  for (const id of affectedIds) {
    const fileUri = map.get(id)
    if (!fileUri) {
      return null
    }
    out.push({ transitionId: id, fileUri })
  }
  return out
}
