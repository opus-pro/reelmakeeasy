import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'

export function findExistingStyleMatch(
  styleText: string,
  options: StoryModeStyleOption[],
): StoryModeStyleOption | undefined {
  const normalized = styleText.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }
  return options.find((s) => s.styleText?.trim().toLowerCase() === normalized)
}

export function resolveReconciledStyleId(params: {
  customStyleText: string | undefined
  isCustomStyleSelected: boolean
  options: StoryModeStyleOption[]
}): null | string {
  if (!params.isCustomStyleSelected) {
    return null
  }
  if (!params.customStyleText?.trim()) {
    return null
  }
  const match = findExistingStyleMatch(params.customStyleText, params.options)
  return match?.id ?? null
}
