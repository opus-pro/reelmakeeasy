'use client'

import { useQuery } from '@tanstack/react-query'

import { useApi } from './useApi'

export type StoryModeStyleOption = {
  id: string
  label: string
  /** Optional hover preview video URL (e.g. webm/mp4) for desktop style preview */
  previewVideoUrl?: string
  /**
   * Rendered scene-preview URLs (portrait/landscape/action) of a user saved
   * style's latest snapshot. When present these are the card's front image -- a
   * carousel cycles them -- instead of `thumbnailUrl` (the uploaded reference).
   * Preset styles leave this undefined and fall back to thumbnail.
   */
  scenePreviewUrls?: string[]
  /** Concise visual-only description used when a preset's full prompt is too long. */
  shortDescription?: string
  /** Style text used for Long Take generation */
  styleText?: string
  thumbnailUrl: string
}

const EMPTY_STYLE_OPTIONS: StoryModeStyleOption[] = []

export type StoryModeStyleVariant = 'song'

type StoryModeStylesResponse = {
  songStyles: StoryModeStyleOption[]
  styles: StoryModeStyleOption[]
}

const STORY_MODE_STYLES_QUERY_KEY = ['story-mode-styles'] as const

function useStoryModeStylesQuery() {
  const { fetchApiDomain } = useApi()
  return useQuery({
    queryKey: STORY_MODE_STYLES_QUERY_KEY,
    queryFn: async () => {
      const response = await fetchApiDomain<StoryModeStylesResponse>('/api/story-mode/styles', {
        method: 'GET',
      })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch story mode styles')
      }
      return response.data
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
}

/**
 * Story mode preset style options, bundled in presets/story-mode/styles.json and
 * served by GET /api/story-mode/styles. The `song` variant uses the song styles,
 * falling back to the default ones when there are none. Empty while loading.
 */
export function useStoryModeStyleOptions(variant?: StoryModeStyleVariant): StoryModeStyleOption[] {
  const { data } = useStoryModeStylesQuery()
  if (!data) return EMPTY_STYLE_OPTIONS
  return variant === 'song' && data.songStyles.length > 0 ? data.songStyles : data.styles
}

/** The default preset styles (as `useStoryModeStyleOptions()`), plus whether loading them
 *  failed and a retry, for a picker that has to say so. */
export function useStoryModeStyleOptionsState(): {
  isError: boolean
  retry: () => void
  styles: StoryModeStyleOption[]
} {
  const { data, isError, refetch } = useStoryModeStylesQuery()
  return {
    isError,
    retry: () => void refetch(),
    styles: data?.styles ?? EMPTY_STYLE_OPTIONS,
  }
}

/**
 * Base image URL for style preview generation. Used when calling
 * POST /api/media/generate-style-preview. Empty means the API's default, the
 * bundled presets/style-preview-base.png.
 */
export function useStylePreviewBaseImage(): string {
  return ''
}
