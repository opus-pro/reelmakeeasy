// Plain-text beat-sheet prompt adapter (TTS / no-uploaded-audio mode).
//
// UIP no-audio does not maintain a separate route prompt. Instead, it turns
// the script into a synthetic timestamped transcript at the unified TTS rate
// and then calls the same classic beat-sheet prompt wrapper used by the
// timestamped path. This keeps route-specific prompt text identical between
// classic/audio and UIP/no-audio; only the provenance of timestamps differs.

import type { Pacing, UipPromptRoute } from '../types'

import { buildLongTakeBeatSheetExpertPrompt } from './long-take-beat-sheet-expert-prompt'

const WORDS_PER_MINUTE = 150

export function buildLongTakeBeatSheetPlainTextPrompt(params: {
  auditFeedback?: Parameters<typeof buildLongTakeBeatSheetExpertPrompt>[0]['auditFeedback']
  // No-audio refinement still needs per-turn segmentation intent ("more shots",
  // "make it tighter"). We append it as advisory text after the classic prompt.
  latestUserMessage?: string
  pacing: null | Pacing
  promptRoute?: UipPromptRoute
  script: string
  transitionVideoModel?: string
}): string {
  const prompt = buildLongTakeBeatSheetExpertPrompt({
    auditFeedback: params.auditFeedback,
    pacing: params.pacing,
    promptRoute: params.promptRoute,
    transitionVideoModel: params.transitionVideoModel,
    timestampedTranscript: buildSyntheticTimestampedTranscript(params.script, WORDS_PER_MINUTE),
  })
  return `${prompt}${renderPlainTextUserFeedbackSection(params.latestUserMessage)}`
}

export function buildSyntheticTimestampedTranscript(
  script: string,
  wordsPerMinute = WORDS_PER_MINUTE,
): string {
  const tokens = script
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  const secondsPerWord = 60 / wordsPerMinute
  return tokens
    .map((word, index) => `${word}(${((index + 1) * secondsPerWord).toFixed(1)}s)`)
    .join(' ')
}

function renderPlainTextUserFeedbackSection(latestUserMessage?: string): string {
  const feedback = latestUserMessage?.trim()
  if (!feedback) {
    return ''
  }

  return `

---

User Feedback (advisory for segmentation intent only):
${feedback}

Use this feedback to choose cut cadence, such as more/fewer/tighter/slower shots.
Hard timing rules, route segmentation rules, and verbatim transcript coverage still take precedence.
`
}
