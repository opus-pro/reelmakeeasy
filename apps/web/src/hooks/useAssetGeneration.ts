'use client'

import { AspectRatio, AssetState, GenerateAssetResult } from '@reelmakeeasy/common/media/types'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { useApi } from './useApi'

export interface GenerateAssetParamsAndActions {
  duration?: number
  onInteractionNeeded?: (request: { candidates: string[]; workflowId: string }) => void
  onProgress?: (progress: GenerateProgress) => void
  onWorkflowStarted?: (workflowId: string) => void
  projectId: string
  prompt: string
  ratio?: AspectRatio
  referenceUrl: string
  sceneId: string
  shotId: string
}

export interface GenerateProgress {
  message?: string
  percent: number
  /** High-level phase: 'keyframe' or 'video' */
  phase?: 'keyframe' | 'video'
  stage: string
}

/**
 * Hook for generating assets (images/videos) using the async SSE-based workflow.
 *
 * The generation flow:
 * 1. POST to /api/assets/generate to start the workflow (returns workflowId)
 * 2. Subscribe to SSE at /api/assets/events/:workflowId for progress updates
 * 3. Resolve when complete/error event is received
 */
export function useAssetGeneration() {
  const { createSSEConnection, fetchApiDomain } = useApi()

  // Use Map to store connection instances per shot, allowing concurrent generations
  const sseConnectionMapRef = useRef<Map<string, ReturnType<typeof createSSEConnection>>>(new Map())

  const cleanup = useCallback((shotId?: string) => {
    if (shotId) {
      // Clean up specific shot's connection
      const connection = sseConnectionMapRef.current.get(shotId)
      if (connection) {
        connection.close()
        sseConnectionMapRef.current.delete(shotId)
      }
    } else {
      // Clean up all connections
      sseConnectionMapRef.current.forEach((connection) => connection.close())
      sseConnectionMapRef.current.clear()
    }
  }, [])

  const cancelGeneration = useCallback(
    async (workflowId: string, shotId?: string): Promise<void> => {
      // Clean up local connection first to prevent subsequent messages from triggering useless state updates
      if (shotId) {
        cleanup(shotId)
      }

      const res = await fetchApiDomain(`/api/assets/cancel/${workflowId}`, {
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to cancel workflow')
      }
    },
    [cleanup, fetchApiDomain],
  )

  const submitSelection = useCallback(
    async (workflowId: string, selectedUri: string) => {
      const res = await fetchApiDomain(`/api/assets/select-keyframe/${workflowId}`, {
        data: {
          selectedLastFrameUri: selectedUri,
        },
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to submit keyframe selection')
      }
    },
    [fetchApiDomain],
  )

  const mutation = useMutation<
    GenerateAssetResult,
    Error & { errorCategory?: string },
    GenerateAssetParamsAndActions
  >({
    mutationFn: async ({
      duration,
      prompt,
      projectId,
      ratio,
      referenceUrl,
      sceneId,
      shotId,
      onProgress,
      onInteractionNeeded,
      onWorkflowStarted,
    }) => {
      // Step 1: Start the async generation workflow
      const res = await fetchApiDomain<{
        message?: string
        status: 'queued'
        workflowId: string
      }>('/api/assets/generate-async', {
        data: {
          duration,
          projectId,
          prompt,
          ratio,
          referenceUrl,
          sceneId,
          shotId,
        },
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Generate failed')
      }

      const { workflowId } = res.data

      // Notify caller that workflow has started (for immediate UI updates like opening dialog)
      onWorkflowStarted?.(workflowId)

      // Step 2: Subscribe to SSE for state updates
      return new Promise<GenerateAssetResult>((resolve, reject) => {
        // Clean up any existing connection for this specific shot
        cleanup(shotId)

        const handleStateUpdate = (payload: { data: string }) => {
          try {
            const state = JSON.parse(payload.data) as AssetState

            if (state.progress && onProgress) {
              onProgress(state.progress)
            }

            // Handle waiting_for_selection state - trigger interaction callback
            if (state.status === 'waiting_for_selection' && state.keyframeCandidates?.lastFrame) {
              if (onInteractionNeeded) {
                onInteractionNeeded({
                  candidates: state.keyframeCandidates.lastFrame,
                  workflowId,
                })
              }
              return
            }

            if (state.status === 'completed' && state.result?.fileUri) {
              cleanup(shotId)
              resolve({
                fileUri: state.result.fileUri,
                previewThumbnail: state.result.previewThumbnail,
              })
            } else if (state.status === 'failed') {
              cleanup(shotId)
              const error = Object.assign(new Error(state.error?.message || 'Generation failed'), {
                errorCategory: state.error?.code,
              })
              reject(error)
            }
            // If still processing/queued, continue listening for next update
          } catch {
            // Ignore parse errors, wait for next event
          }
        }

        // Create SSE connection for this shot
        const sseConnectionRef = createSSEConnection(`/api/assets/events/${workflowId}`, {
          message: () => {
            // Default message handler - no-op
          },
          // Unified 'update' event - handles all state changes
          update: handleStateUpdate,
          // Handle SSE connection errors during streaming (network drops, server errors)
          error: (payload: { data?: string; raw_error?: Error }) => {
            cleanup(shotId)
            const rawError = payload.raw_error
            const isCancelled = rawError?.name === 'AbortError'

            const error = Object.assign(
              new Error(payload.data || 'SSE connection error during asset generation'),
              { errorCategory: isCancelled ? 'CANCELLED' : 'SSE_CONNECTION_ERROR' },
            )

            reject(error)
          },
        })

        sseConnectionMapRef.current.set(shotId, sseConnectionRef)

        // Start the SSE connection
        sseConnectionRef.start().catch((err) => {
          cleanup(shotId)
          reject(err)
        })
      })
    },
  })

  // Auto cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    cancelGeneration,
    cleanup,
    submitSelection,
    error: mutation.error,
    generateAsset: mutation.mutate,
    generateAssetAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
  }
}
