export const LONG_TAKE_PROMPT_ROUTES = [
  'abstract',
  'ads-tangible',
  'ads-intangible',
  'general',
  // Kept in sync with story-mode-runtime/long-take-prompt-router.ts. The route classifier never emits
  // 'music'; the long-take workflow forces it when uploaded audio is music and
  // enable_music_video_improvement is on, so music videos get the music-aware visual-script prompt.
  'music',
] as const

export type LongTakePromptRoute = (typeof LONG_TAKE_PROMPT_ROUTES)[number]

export type LongTakePromptTemplateName =
  | 'asset-manager'
  | 'asset-manifest'
  | 'beat-sheet'
  | 'keyframe-prompts'
  | 'motion-prompts'
  | 'transition-refinement'
  | 'transition-selection'
  | 'transition-video'
  | 'video-prompts'
  | 'visual-script'
  | 'world-bible'

export function buildLongTakeRoutedPromptTemplate(params: {
  generalPrompt: string
  promptRoute?: LongTakePromptRoute
  templateName: LongTakePromptTemplateName
}): string {
  const { generalPrompt } = params
  return generalPrompt
}
