import { buildLongTakeBeatSheetExpertPrompt as buildClassicLongTakeBeatSheetExpertPrompt } from '@reelmakeeasy/common/long-take/prompts/long-take-beat-sheet-expert-prompt'

import type { Pacing, UipPromptRoute } from '../types'

export function buildLongTakeBeatSheetExpertPrompt(params: {
  auditFeedback?: Array<{
    attempt: number
    previousOutput: Array<{ beat_id?: number; duration?: number; segment_text: string }>
    reasons: string[]
  }>
  // Accepted for UIP call-site compatibility. The classic prompt does not
  // inject per-turn segmentation feedback into this expert.
  latestUserMessage?: string
  // Accepted for UIP call-site compatibility. Intentionally ignored so UIP
  // timestamped beat sheets use the same segmentation prompt as classic.
  pacing: null | Pacing
  promptRoute?: UipPromptRoute
  timestampedTranscript: string
  transitionVideoModel?: string
}): string {
  return buildClassicLongTakeBeatSheetExpertPrompt({
    auditFeedback: params.auditFeedback,
    promptRoute: params.promptRoute,
    transitionVideoModel: params.transitionVideoModel,
    timestampedTranscript: params.timestampedTranscript,
  })
}
