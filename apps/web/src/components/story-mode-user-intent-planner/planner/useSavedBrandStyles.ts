'use client'

import { useEffect, useMemo, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import { type StoryModeStyleOption, useStoryModeStyleOptions } from '@/hooks/useStoryModeConfig'
import { latestScenePreviewUrls, useUserSavedStyles } from '@/hooks/useUserSavedStyles'

import {
  type BrandBriefStyleSnapshot,
  listBrandBriefs,
} from '../../omni-chat-box-v2/brand/brand-briefs-client'
import { brandStylesToOptions } from '../../omni-chat-box-v2/brand/brand-style-options'

export interface SelectedStyleInput {
  name: null | string
  text: null | string
  thumbnailUrl: null | string
}

interface SavedBrandStylesResult {
  defaultStyleId: null | string
  loading: boolean
  styles: StoryModeStyleOption[]
}

const SELECTED_STYLE_ID = 'uip-selected-style'

// The brand's own saved styles for a reused saved brief, resolved the
// same way the submission-box picker does: each
// brief snapshot is a pointer, so it's matched against the live style catalog
// (presets + the user's saved styles) for the real name + scene previews.
// Refless legacy snapshots are dropped by brandStylesToOptions.
export function useSavedBrandStyles(
  savedBriefId: null | string,
  selectedStyle?: null | SelectedStyleInput,
): SavedBrandStylesResult {
  const { fetchApiDomain } = useApi()
  const presetOptions = useStoryModeStyleOptions()
  const { styles: userSavedStyles } = useUserSavedStyles()
  const [snapshots, setSnapshots] = useState<BrandBriefStyleSnapshot[]>([])
  const [loading, setLoading] = useState(false)

  const liveById = useMemo(() => {
    const userOptions: StoryModeStyleOption[] = userSavedStyles.map((style) => ({
      id: style.id,
      label: style.name,
      scenePreviewUrls: latestScenePreviewUrls(style),
      styleText: style.styleText,
      thumbnailUrl: style.thumbnailUrl || '',
    }))
    return new Map([...userOptions, ...presetOptions].map((option) => [option.id, option]))
  }, [presetOptions, userSavedStyles])

  useEffect(() => {
    if (!savedBriefId) {
      setSnapshots([])
      return
    }
    let cancelled = false
    setLoading(true)
    void listBrandBriefs(fetchApiDomain)
      .then((rows) => {
        if (!cancelled) {
          setSnapshots(rows.find((row) => row.id === savedBriefId)?.styles ?? [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshots([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [fetchApiDomain, savedBriefId])

  const brandStyles = useMemo(
    () => brandStylesToOptions(snapshots, liveById),
    [liveById, snapshots],
  )

  // Surface the user's current pick as a selected card. If it's already one of
  // the brand styles, just preselect that card; if it's a style from outside
  // the brand, prepend it so the user sees what they actually chose.
  const { defaultStyleId, styles } = useMemo(() => {
    const current = toSelectedOption(selectedStyle)
    if (!current) {
      return { defaultStyleId: resolveDefaultStyleId(snapshots, brandStyles), styles: brandStyles }
    }
    const match = brandStyles.find((style) => sameStyleName(style.label, current.label))
    if (match) {
      return { defaultStyleId: match.id, styles: brandStyles }
    }
    return { defaultStyleId: current.id, styles: [current, ...brandStyles] }
  }, [brandStyles, selectedStyle, snapshots])

  return { defaultStyleId, loading, styles }
}

function sameStyleName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function toSelectedOption(selected?: null | SelectedStyleInput): null | StoryModeStyleOption {
  const name = selected?.name?.trim()
  const thumbnailUrl = selected?.thumbnailUrl ?? ''
  if (!name && !thumbnailUrl) {
    return null
  }
  return {
    id: SELECTED_STYLE_ID,
    label: name || 'Selected style',
    styleText: selected?.text ?? undefined,
    thumbnailUrl,
  }
}

// The brand's marked-default style (falling back to the first), mapped to the
// live style id so the picker can preselect it. Falls back to the first
// renderable option when the default snapshot was dropped (refless/legacy).
function resolveDefaultStyleId(
  snapshots: BrandBriefStyleSnapshot[],
  styles: StoryModeStyleOption[],
): null | string {
  const preferred = snapshots.find((snapshot) => snapshot.isDefault) ?? snapshots[0]
  const ref = preferred?.styleRef
  const preferredId = ref ? (ref.kind === 'preset' ? ref.presetId : ref.userSavedStyleId) : null
  if (preferredId && styles.some((style) => style.id === preferredId)) {
    return preferredId
  }
  return styles[0]?.id ?? null
}
