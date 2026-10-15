'use client'

import { useMemo } from 'react'

import { matchStylePreset } from '@/components/omni-chat-box/StoryModePanel'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import { useStoryModeStyleOptions } from '@/hooks/useStoryModeConfig'
import { latestScenePreviewUrls, useUserSavedStyles } from '@/hooks/useUserSavedStyles'

export type ResolvedProjectStyle = {
  /** Style text to generate with: the project's own, else the matched preset's. */
  effectiveStyleText?: string
  styleName: string
  thumbnailUrl?: string
}

/**
 * Resolve a long-take project's style for display: match its styleText against
 * the preset catalog and the owner's saved styles, falling back to whatever the
 * API returned for viewers who have neither (e.g. a shared link).
 *
 * Extracted from DetailPanel unchanged; several surfaces (share actions, the
 * action buttons, the style card, the restyle entry) all need the same answer.
 */
export function useResolvedProjectStyle({
  fallbackStyleName,
  fallbackThumbnailUrl,
  isOwner,
  styleText,
}: {
  fallbackStyleName?: string
  fallbackThumbnailUrl?: string
  isOwner: boolean
  styleText?: string
}): ResolvedProjectStyle {
  const styleOptions = useStoryModeStyleOptions()
  const { styles: userSavedStyles } = useUserSavedStyles()

  // Only match against the owner's saved styles - a logged-in non-owner viewing via shared link
  // should not have their own private styles match the project styleText.
  const userStyleOptions = useMemo<StoryModeStyleOption[]>(
    () =>
      isOwner
        ? userSavedStyles.map((style) => ({
            id: style.id,
            label: style.name,
            styleText: style.styleText,
            // Prefer the rendered scene_0 over the uploaded reference so the
            // editor style card matches the gallery card.
            thumbnailUrl:
              latestScenePreviewUrls(style)
                .find((url) => url.trim())
                ?.trim() ||
              style.thumbnailUrl ||
              '',
          }))
        : [],
    [isOwner, userSavedStyles],
  )

  const allStyleOptions = useMemo(
    () => [...userStyleOptions, ...styleOptions],
    [userStyleOptions, styleOptions],
  )

  // Match styleText against both user-saved styles and presets for styleName and thumbnailUrl.
  // Fall back to API-provided values for unauthenticated viewers (e.g. shared links).
  const {
    styleName: matchedStyleName,
    styleText: matchedStyleText,
    thumbnailUrl: matchedThumbnailUrl,
  } = useMemo(
    () => matchStylePreset(styleText, allStyleOptions, fallbackStyleName),
    [styleText, allStyleOptions, fallbackStyleName],
  )
  // matchStylePreset returns thumbnailUrl=undefined only when no match found (custom style fallback).
  // For matched styles (even those without a thumbnail), thumbnailUrl is '' not undefined.
  const hasMatch = matchedThumbnailUrl !== undefined

  return {
    effectiveStyleText: styleText || matchedStyleText || undefined,
    styleName: hasMatch ? matchedStyleName : (fallbackStyleName ?? matchedStyleName),
    // Use || (not ??) so empty string thumbnailUrls fall through to the next fallback.
    thumbnailUrl: matchedThumbnailUrl || fallbackThumbnailUrl || undefined,
  }
}
