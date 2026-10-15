'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useApi } from './useApi'

export interface SourcePreferenceSettings {
  blockedSites: string[]
  youtubeFilter: 'all' | 'blockAll' | 'creativeCommonsOnly'
}

interface SourcePreferenceResponse {
  blockedSites: string[]
  createdAt: string
  id: string
  updatedAt: string
  userId: string
  youtubeFilter: 'all' | 'blockAll' | 'creativeCommonsOnly'
}

const SOURCE_PREFERENCES_QUERY_KEY = ['sourcePreferences'] as const

export function useSourcePreferences() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  // Query to get source preferences
  const {
    data: preferences,
    isLoading,
    error,
  } = useQuery({
    queryKey: SOURCE_PREFERENCES_QUERY_KEY,
    queryFn: async () => {
      const response = await fetchApiDomain<SourcePreferenceResponse>('/api/source-preferences', {
        method: 'GET',
      })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch source preferences')
      }
      return response.data
    },
  })

  // Mutation to update source preferences.
  const updateMutation = useMutation({
    mutationFn: async (settings: SourcePreferenceSettings) => {
      const response = await fetchApiDomain<SourcePreferenceResponse>('/api/source-preferences', {
        method: 'PUT',
        data: settings,
      })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to update source preferences')
      }
      return response.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SOURCE_PREFERENCES_QUERY_KEY, data)
    },
  })

  const updatePreferences = useCallback(
    async (settings: SourcePreferenceSettings) => {
      return updateMutation.mutateAsync(settings)
    },
    [updateMutation],
  )

  return {
    preferences: preferences
      ? {
          youtubeFilter: preferences.youtubeFilter,
          blockedSites: preferences.blockedSites,
        }
      : null,
    isLoading,
    error,
    updatePreferences,
    isUpdating: updateMutation.isPending,
  }
}
