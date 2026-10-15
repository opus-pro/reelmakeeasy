import { type VoiceSpeed } from '@shared/types/api/voice-over'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { pinVoiceToTop } from '@/components/voice/components/voice-list-utils'
import { type VoiceOption } from '@/components/voice/components/voice-over-selection'

export type FilterGender = 'any' | 'female' | 'male'
export type FilterSpeed = 'any' | VoiceSpeed
export type SortBy = 'latest' | 'trending'

export type VoiceFilterState = ReturnType<typeof useVoiceFilter>

/** Index into VoiceOption.labels where gender is stored for preset voices. labels[0] is language/accent. */
export const LABEL_IDX_GENDER = 1
/** Index into VoiceOption.labels where use-case/category is stored for preset voices. */
export const LABEL_IDX_CATEGORY = 2

/** Provider display order for "Sort by latest": gemini -> minimax -> elevenlabs. */
const PROVIDER_SORT_ORDER: Record<string, number> = { gemini: 0, minimax: 1, elevenlabs: 2 }
const VOICE_SPEED_ORDER: VoiceSpeed[] = ['slow', 'medium', 'fast']

type UseVoiceFilterParams = {
  activeTab: 'library' | 'my-voices'
  dialogOpen: boolean
  displayVoices: VoiceOption[]
  libraryVoices: VoiceOption[]
  pinnedVoiceId?: null | string
}

export function useVoiceFilter({
  activeTab,
  dialogOpen,
  displayVoices,
  libraryVoices,
  pinnedVoiceId = null,
}: UseVoiceFilterParams) {
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('trending')
  const [filterGender, setFilterGender] = useState<FilterGender>('any')
  const [filterCategory, setFilterCategory] = useState<string>('any')
  const [filterSpeed, setFilterSpeed] = useState<FilterSpeed>('any')
  const [openSubmenu, setOpenSubmenu] = useState<'category' | 'gender' | 'speed' | null>(null)

  const filterContainerRef = useRef<HTMLDivElement>(null)

  // Derive unique categories from the preset voice list
  const availableCategories = useMemo(() => {
    const cats = new Set<string>()
    libraryVoices.forEach((v) => {
      if (v.visible === false) {
        return
      }
      const rawCat = v.labels?.[LABEL_IDX_CATEGORY]
      const cat = rawCat === 'Promotional videos' ? 'Promotional video' : rawCat
      if (cat && cat !== 'any') {
        cats.add(cat)
      }
    })
    return Array.from(cats).sort()
  }, [libraryVoices])

  const availableSpeeds = useMemo(() => {
    const speeds = new Set<VoiceSpeed>()
    libraryVoices.forEach((v) => {
      if (v.visible === false || !v.speed) {
        return
      }
      speeds.add(v.speed)
    })
    return VOICE_SPEED_ORDER.filter((speed) => speeds.has(speed))
  }, [libraryVoices])

  // Number of active filters (sort order counts too)
  const activeFilterCount =
    (filterGender === 'any' ? 0 : 1) +
    (filterCategory === 'any' ? 0 : 1) +
    (filterSpeed === 'any' ? 0 : 1) +
    (sortBy === 'trending' ? 0 : 1)

  // Filtered + sorted voice list, only applied on the library tab
  const filteredDisplayVoices = useMemo(() => {
    let voices = displayVoices.filter((v) => v.visible !== false)
    if (activeTab === 'library') {
      if (filterGender !== 'any') {
        voices = voices.filter((v) => v.labels?.[LABEL_IDX_GENDER]?.toLowerCase() === filterGender)
      }
      if (filterCategory !== 'any') {
        voices = voices.filter((v) => {
          const rawCat = v.labels?.[LABEL_IDX_CATEGORY]
          const cat = rawCat === 'Promotional videos' ? 'Promotional video' : rawCat
          return cat === filterCategory
        })
      }
      if (filterSpeed !== 'any') {
        voices = voices.filter((v) => v.speed === filterSpeed)
      }
      if (sortBy === 'latest') {
        voices = [...voices].sort(
          (a, b) =>
            (PROVIDER_SORT_ORDER[a.provider ?? ''] ?? 3) -
            (PROVIDER_SORT_ORDER[b.provider ?? ''] ?? 3),
        )
      }
    }
    return pinVoiceToTop(voices, pinnedVoiceId)
  }, [activeTab, displayVoices, filterCategory, filterGender, filterSpeed, pinnedVoiceId, sortBy])

  // Reset all filter/sort state when the dialog closes
  useEffect(() => {
    if (!dialogOpen) {
      setSortBy('trending')
      setFilterGender('any')
      setFilterCategory('any')
      setFilterSpeed('any')
      setIsFilterPanelOpen(false)
      setOpenSubmenu(null)
    }
  }, [dialogOpen])

  // Close filter panel when clicking outside
  useEffect(() => {
    if (!isFilterPanelOpen) {
      return
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (filterContainerRef.current && !filterContainerRef.current.contains(e.target as Node)) {
        setIsFilterPanelOpen(false)
        setOpenSubmenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isFilterPanelOpen])

  const handleClearAllFilters = useCallback(() => {
    setSortBy('trending')
    setFilterGender('any')
    setFilterCategory('any')
    setFilterSpeed('any')
    setIsFilterPanelOpen(false)
    setOpenSubmenu(null)
  }, [])

  const toggleFilterPanel = useCallback(() => {
    setIsFilterPanelOpen((prev) => !prev)
    setOpenSubmenu(null)
  }, [])

  const closeFilterPanel = useCallback(() => {
    setIsFilterPanelOpen(false)
    setOpenSubmenu(null)
  }, [])

  return {
    activeFilterCount,
    availableCategories,
    availableSpeeds,
    closeFilterPanel,
    filterCategory,
    filterContainerRef,
    filterGender,
    filterSpeed,
    filteredDisplayVoices,
    handleClearAllFilters,
    isFilterPanelOpen,
    openSubmenu,
    setFilterCategory,
    setFilterGender,
    setFilterSpeed,
    setOpenSubmenu,
    setSortBy,
    sortBy,
    toggleFilterPanel,
  }
}
