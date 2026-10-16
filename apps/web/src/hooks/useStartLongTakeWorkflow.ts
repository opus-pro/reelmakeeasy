'use client'

import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import { AspectRatio } from '@reelmakeeasy/common/media/types'
import type { LongTakeScriptGeneratorPath } from '@shared/types/api/long-take'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { CreateUseCaseKey } from '@/constants/create-use-cases'

import { useApi } from './useApi'

/**
 * Hook to start a Story Mode workflow
 */
export function useStartLongTakeWorkflow() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  const startLongTake = useMutation({
    mutationFn: async (params: {
      audioUri?: string
      /** Background music: on/off and the user's wish for it (the Music pill). */
      bgmEnabled?: boolean
      bgmNote?: null | string
      /** Where the bed comes from ('generated' | 'library' | 'upload') and which track. */
      bgmSource?: null | string
      bgmTrackId?: null | string
      /** Camera style for the clips: 'calm' (default) or 'dynamic'. */
      cameraStyle?: CameraStyle
      createUseCase?: CreateUseCaseKey
      customStyle?: boolean
      /** Transition clip resolution (e.g. `{ videoResolution: '768p' }`). */
      generationResolution?: { videoResolution?: string }
      // initPrompt?: string  // REMOVED - using only userPrompt now
      isSavedStyle?: boolean
      isStyleCopy?: boolean
      perfectLoop?: boolean
      projectId?: string
      prompt?: string
      ratio?: AspectRatio
      remixProjectId?: string
      /** The saved style picked; an image style's picture guides every frame. */
      savedStyleId?: string
      script: string
      scriptGeneratorPath?: LongTakeScriptGeneratorPath
      styleName?: string
      styleText?: string
      styleThumbnailUrl?: string
      targetDurationSeconds?: number
      /** The clip model picked in the composer (Gemini); absent means the provider's default. */
      transitionVideoModel?: string
      userPrompt: string // Only source of truth (required)
      visualScriptTemperature?: number
      voiceId?: string
    }) => {
      const response = await fetchApiDomain<{
        projectId: string
        videoId: string
        workflowId: string
      }>('/api/long-take-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: params,
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to start Story Mode')
      }

      return response.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  return {
    startLongTake: startLongTake.mutate,
    startLongTakeAsync: startLongTake.mutateAsync,
    error: startLongTake.error,
    isLoading: startLongTake.isPending,
    isSuccess: startLongTake.isSuccess,
  }
}
