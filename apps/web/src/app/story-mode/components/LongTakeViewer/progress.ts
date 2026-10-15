import type { LongTakeStatusStage, LongTakeStatusState } from '@shared/types/api/long-take'

// Canonical render-pipeline order, in pipeline order. Also consumed by the
// story-mode-stage-mock admin harness (see stages.ts's PROCESSING_STAGES) so
// the two never drift again.
export const STAGES: Array<{ headline: string; id: LongTakeStatusStage; label: string }> = [
  { id: 'started', label: 'Started', headline: 'Preparing your video plan...' },
  { id: 'script', label: 'Script', headline: 'Writing script...' },
  { id: 'voiceover', label: 'Voiceover', headline: 'Generating voiceover...' },
  {
    id: 'user_assets_understanding',
    label: 'Image Understanding',
    headline: 'Understanding your uploaded images...',
  },
  {
    id: 'user_assets_analysis',
    label: 'References',
    headline: 'Analyzing your uploaded references...',
  },
  {
    id: 'experts_analysis',
    label: 'Experts Analysis',
    headline: 'Running expert analysis...',
  },
  {
    id: 'anchor_assets',
    label: 'Anchor Assets',
    headline: 'Generating anchor assets...',
  },
  { id: 'visual_script', label: 'Visual Script', headline: 'Building visual script...' },
  {
    id: 'keyframe_prompts',
    label: 'Keyframe Prompts',
    headline: 'Preparing keyframe prompts...',
  },
  { id: 'shot_plan', label: 'Shot Plan', headline: 'Planning shots...' },
  { id: 'keyframes', label: 'Keyframes', headline: 'Generating keyframes...' },
  { id: 'transitions', label: 'Transitions', headline: 'Generating transitions...' },
  { id: 'render', label: 'Render', headline: 'Rendering final video...' },
  { id: 'completed', label: 'Completed', headline: 'Video is ready.' },
]

/** What a failed video says when its writing step had no AI to run on and the failure carries
 *  no reason of its own. */
export const LLM_NOT_SET_UP_TEXT =
  'No AI is set up to write and plan your video. Open Setup in the sidebar, pick one, then try again.'

export function getConcurrentStageLabels(
  stage?: LongTakeStatusStage | null,
  concurrentStages?: LongTakeStatusStage[],
  status?: LongTakeStatusState | null,
): string[] {
  const stageIsCompleted = status === 'completed'
  const all = [stageIsCompleted ? null : stage, ...(concurrentStages ?? [])].filter(
    (s): s is LongTakeStatusStage => Boolean(s) && !isTerminalStage(s),
  )
  return [...new Set(all)].slice(0, 3).map((s) => getStageLabel(s))
}

export function getStageHeadline(stage?: LongTakeStatusStage | null): string {
  if (!stage) {
    return 'Preparing your video plan...'
  }
  if (isFailedStage(stage)) {
    return 'Project failed'
  }
  const found = STAGES.find((item) => item.id === stage)
  return found?.headline || `Processing ${getStageLabel(stage)}...`
}

export function getStageLabel(stage?: LongTakeStatusStage | null): string {
  if (!stage) {
    return 'Starting...'
  }
  if (isFailedStage(stage)) {
    return 'Error'
  }
  const found = STAGES.find((item) => item.id === stage)
  return found?.label || stage
}

export function getStageProgressPercent(
  stage?: LongTakeStatusStage | null,
  status?: LongTakeStatusState | null,
): number {
  if (!stage) {
    return 0
  }
  if (stage === 'completed') {
    return 100
  }
  if (isFailedStage(stage)) {
    return 100
  }
  const index = STAGES.findIndex((item) => item.id === stage)
  if (index === -1) {
    return 0
  }
  const step = status === 'completed' ? 1 : 0.5
  return Math.round(((index + step) / STAGES.length) * 100)
}

export function getStageSecondaryText(stage?: LongTakeStatusStage | null, detail?: string): string {
  if (isFailedStage(stage)) {
    if (detail === 'NON_SPEECH_AUDIO') {
      return "Instrumental or music-only audio isn't supported yet. Try a track with spoken vocals."
    }
    if (detail === 'TTS_FAILED') {
      return "We couldn't generate the voiceover for your video. Please try again."
    }
    const noAi = llmNotSetUpText(detail)
    if (noAi) {
      return noAi
    }
    return 'Video generation failed. Please try again.'
  }
  if (stage === 'completed') {
    return 'Finalizing your video output.'
  }
  return 'Your video is still processing.'
}

export function getUipProcessingOverrides(
  isUip: boolean | undefined,
  stage: LongTakeStatusStage | undefined,
): undefined | { headline: string; label: string } {
  if (!isUip || !isEarlyStage(stage)) {
    return undefined
  }
  return {
    headline: 'Generating your video...',
    label: 'Video',
  }
}

export function isEarlyStage(stage?: LongTakeStatusStage | null): boolean {
  return !stage || stage === 'started' || stage === 'script'
}

export function isFailedStage(stage?: LongTakeStatusStage | null): boolean {
  return stage === 'error' || stage === 'rejected'
}

export function isStageCompleted(stage?: LongTakeStatusStage | null): boolean {
  return stage === 'completed' || isFailedStage(stage)
}

function isTerminalStage(stage?: LongTakeStatusStage | null): boolean {
  return stage === 'completed' || isFailedStage(stage)
}

/** The status detail of a failed video whose writing step had no AI to run on: the code alone,
 *  or `LLM_NOT_SET_UP: <reason>` with the API's words (story-mode `classifyWorkflowErrorDetail`). */
const LLM_NOT_SET_UP_DETAIL = 'LLM_NOT_SET_UP'

/** What such a failure says: its reason when it carries one, else LLM_NOT_SET_UP_TEXT; null for
 *  any other detail. */
function llmNotSetUpText(detail: string | undefined): null | string {
  if (detail !== LLM_NOT_SET_UP_DETAIL && !detail?.startsWith(`${LLM_NOT_SET_UP_DETAIL}:`)) {
    return null
  }
  return detail.slice(LLM_NOT_SET_UP_DETAIL.length + 1).trim() || LLM_NOT_SET_UP_TEXT
}
