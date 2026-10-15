import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'

export const STORY_MODE_CUSTOM_STYLE_ID = 'custom'
// Sentinel for the "Auto" style tile. Distinct
// from STORY_MODE_CUSTOM_STYLE_ID: selecting it means "no concrete seed
// style -- let the backend auto-select at session-create" rather than a
// user-authored custom style.
export const STORY_MODE_AUTO_STYLE_ID = 'auto'
export const TEXT_STYLE_PREVIEW_SNIPPET_LENGTH = 84
export const TEXT_STYLE_THUMBNAIL_SNIPPET_LENGTH = 26
export const MOUSE_DRAG_THRESHOLD_PX = 4

function findPresetByLabel(
  normalizedFallbackLabel: string,
  options: StoryModeStyleOption[],
): StoryModeStyleOption | undefined {
  for (const preset of options) {
    if (preset.label.toLowerCase().trim() === normalizedFallbackLabel) {
      return preset
    }
  }
  return undefined
}

function findPresetByStyleText(
  normalizedInput: string,
  options: StoryModeStyleOption[],
): StoryModeStyleOption | undefined {
  for (const preset of options) {
    if (preset.styleText && normalizedInput === preset.styleText.toLowerCase()) {
      return preset
    }
  }

  for (const preset of options) {
    if (!preset.styleText) {
      continue
    }
    const presetTextLower = preset.styleText.toLowerCase()
    if (normalizedInput.includes(presetTextLower) || presetTextLower.includes(normalizedInput)) {
      return preset
    }
  }

  return undefined
}

/**
 * Match styleText (or fallback style name) to a preset and return the style info.
 * Returns undefined for thumbnailUrl if no match (custom style).
 * Options should come from the preset catalog (useStoryModeStyleOptions); when empty, any
 * styleText is treated as custom.
 */
export type TextStyleVisualProps = {
  mode: 'preview' | 'thumbnail'
  styleText?: string
}

export function matchStylePreset(
  styleText?: string,
  options: StoryModeStyleOption[] = [],
  fallbackStyleName?: string,
): {
  styleName: string
  styleText: string | undefined
  thumbnailUrl: string | undefined
} {
  const normalizedInput = styleText?.toLowerCase().trim()

  if (normalizedInput) {
    const matchedByStyleText = findPresetByStyleText(normalizedInput, options)
    if (matchedByStyleText) {
      return {
        styleName: matchedByStyleText.label,
        styleText: matchedByStyleText.styleText,
        thumbnailUrl: matchedByStyleText.thumbnailUrl,
      }
    }
  }

  const normalizedFallbackLabel = fallbackStyleName?.toLowerCase().trim()
  if (normalizedFallbackLabel) {
    const matchedByLabel = findPresetByLabel(normalizedFallbackLabel, options)
    if (matchedByLabel) {
      return {
        styleName: matchedByLabel.label,
        styleText: matchedByLabel.styleText,
        thumbnailUrl: matchedByLabel.thumbnailUrl,
      }
    }
  }

  // No match - custom style; preserve the user-given name if available
  return {
    styleName: fallbackStyleName?.trim() || 'Custom style',
    styleText: undefined,
    thumbnailUrl: undefined,
  }
}

export const getStyleTextSnippet = (mode: TextStyleVisualProps['mode'], styleText?: string) => {
  const normalized = styleText?.replace(/\s+/g, ' ').trim() || 'Text style'
  const maxLength =
    mode === 'thumbnail' ? TEXT_STYLE_THUMBNAIL_SNIPPET_LENGTH : TEXT_STYLE_PREVIEW_SNIPPET_LENGTH
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}
