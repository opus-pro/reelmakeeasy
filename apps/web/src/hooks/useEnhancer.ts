'use client'

import { useMutation } from '@tanstack/react-query'

import { useApi } from './useApi'

interface EnhancePromptResponse {
  enhancedPrompt: string
}

export function useEnhancer() {
  const { fetchApiDomain } = useApi()

  const enhanceMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const response = await fetchApiDomain<EnhancePromptResponse>('/api/project/enhance-prompt', {
        method: 'POST',
        data: { prompt },
      })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to enhance prompt')
      }
      return response.data.enhancedPrompt
    },
  })

  return {
    enhancePrompt: enhanceMutation.mutateAsync,
    isEnhancing: enhanceMutation.isPending,
    error: enhanceMutation.error,
  }
}
