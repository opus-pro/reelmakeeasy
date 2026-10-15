'use client'

import { useCallback, useEffect, useState } from 'react'

import { SourcePreferenceSettings, useSourcePreferences } from '@/hooks/useSourcePreferences'

import type { SourceFilterSettings } from './SourceFilterDialog'

export interface SourceFilterState {
  blockedSites: string[]
  handleAddSite: () => void
  handleInputChange: (index: number, value: string) => void
  handleRemoveSite: (index: number) => void
  isLoading: boolean
  isUpdating: boolean
  save: () => Promise<SourceFilterSettings>
  setYoutubeContentType: (type: 'all' | 'creativeCommonsOnly') => void
  setYoutubeEnabled: (enabled: boolean) => void
  youtubeContentType: 'all' | 'creativeCommonsOnly'
  youtubeEnabled: boolean
}

/**
 * Shared hook for source filter state management.
 * Encapsulates preferences loading, state updates, and save logic.
 */
export function useSourceFilterState(options?: {
  /** Whether the component is currently mounted/visible (for Dialog, this is the open state) */
  isActive?: boolean
}): SourceFilterState {
  const { isActive = true } = options ?? {}
  const { preferences, updatePreferences, isLoading, isUpdating } = useSourcePreferences()

  const [youtubeEnabled, setYoutubeEnabled] = useState(true)
  const [youtubeContentType, setYoutubeContentType] = useState<'all' | 'creativeCommonsOnly'>('all')
  const [blockedSites, setBlockedSites] = useState<string[]>([])
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false)

  // Load preferences once when they become available
  useEffect(() => {
    if (preferences && !isLoading && !hasLoadedPreferences && isActive) {
      if (preferences.youtubeFilter === 'blockAll') {
        setYoutubeEnabled(false)
        setYoutubeContentType('all')
      } else {
        setYoutubeEnabled(true)
        setYoutubeContentType(preferences.youtubeFilter as 'all' | 'creativeCommonsOnly')
      }
      setBlockedSites(preferences.blockedSites)
      setHasLoadedPreferences(true)
    }
  }, [preferences, isLoading, hasLoadedPreferences, isActive])

  // Reset the loaded flag when component becomes inactive (e.g., dialog closes)
  useEffect(() => {
    if (!isActive) {
      setHasLoadedPreferences(false)
    }
  }, [isActive])

  const handleInputChange = useCallback((index: number, value: string) => {
    setBlockedSites((prev) => {
      const newBlockedSites = [...prev]
      newBlockedSites[index] = value
      return newBlockedSites
    })
  }, [])

  const handleAddSite = useCallback(() => {
    setBlockedSites((prev) => (prev.length < 5 ? [...prev, ''] : prev))
  }, [])

  const handleRemoveSite = useCallback((index: number) => {
    setBlockedSites((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const save = useCallback(async (): Promise<SourceFilterSettings> => {
    const filteredBlockedSites = blockedSites.filter((site) => site.trim() !== '')

    let youtubeFilter: SourceFilterSettings['youtubeFilter']
    if (youtubeEnabled) {
      youtubeFilter = youtubeContentType
    } else {
      youtubeFilter = 'blockAll'
    }

    const settings: SourceFilterSettings = {
      youtubeFilter,
      blockedSites: filteredBlockedSites,
    }

    await updatePreferences(settings as SourcePreferenceSettings)
    return settings
  }, [blockedSites, youtubeEnabled, youtubeContentType, updatePreferences])

  return {
    youtubeEnabled,
    setYoutubeEnabled,
    youtubeContentType,
    setYoutubeContentType,
    blockedSites,
    handleInputChange,
    handleAddSite,
    handleRemoveSite,
    isLoading,
    isUpdating,
    save,
  }
}
