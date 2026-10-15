/**
 * Shared helpers for UIP-to-story-mode workflows.
 *
 * Extracted from workflow.ts so both UipToStoryModeWorkflow and
 * UipToStoryModeFastWorkflow can reuse them without duplication.
 */

import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import type { LongVideoAttemptSource } from '@reelmakeeasy/common/story-mode/long-video-attribution'
import {
  estimateScriptDurationSeconds,
  isLongVideoDuration,
  isLongVideoScriptDuration,
} from '@reelmakeeasy/common/story-mode/long-video-attribution'

import { generateLongTakeBgmBed, persistLongTakeBgmBed } from '../long-take/activity-proxies'
import { getShotPlanFallbackStatusMeta } from '../long-take/shot-plan-fallback-status'
import type {
  GenerateLongTakeBgmBedActivityResult,
  GenerateLongTakeVoiceoverActivityResult,
} from '../long-take/types'
import {
  applyStyleResultToPipelineContext,
  buildFasterTtsStatusMeta,
} from '../long-take/workflow-helpers'
import type { LongTakeWorkflowLogFn } from '../long-take/workflow-runtime'

import type { UipToStoryModeWorkflowParams } from './types'

export function buildCompletionStatusMeta(params: {
  aspectRatio?: AspectRatio
  assetLibraryTransitionsCount?: number
  longVideoAttemptSource?: LongVideoAttemptSource
  promptRoute?: 'legacy' | NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRouteClassified?: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRouteEffective?: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptUseCase?: string
  shotPlanResult: Parameters<typeof getShotPlanFallbackStatusMeta>[0]
  transitionVideoModel?: string
  videoLength: number
  voiceoverResult?: GenerateLongTakeVoiceoverActivityResult
}): Record<string, boolean | number | string> {
  const {
    aspectRatio,
    assetLibraryTransitionsCount,
    longVideoAttemptSource,
    promptRouteClassified,
    promptRouteEffective,
    promptRoute,
    promptUseCase,
    shotPlanResult,
    transitionVideoModel,
    videoLength,
    voiceoverResult,
  } = params
  return {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(longVideoAttemptSource ? { longVideoAttemptSource } : {}),
    ...(promptRoute ? { promptRoute } : {}),
    ...(promptRouteClassified ? { promptRouteClassified } : {}),
    ...(promptRouteEffective ? { promptRouteEffective } : {}),
    ...(promptUseCase ? { promptUseCase } : {}),
    ...(voiceoverResult ? buildFasterTtsStatusMeta(voiceoverResult) : {}),
    ...(voiceoverResult?.voiceSubstituted ? { voiceSubstituted: true } : {}),
    ...getShotPlanFallbackStatusMeta(shotPlanResult),
    // Persist the actually-used transition model + asset-library usage so the story-mode
    // survey can segment Seedance 2.0 satisfaction. debugSettings only carries these when a
    // user explicitly overrides, which the server-side rollout does not.
    ...(typeof assetLibraryTransitionsCount === 'number' ? { assetLibraryTransitionsCount } : {}),
    ...(transitionVideoModel ? { transitionVideoModel } : {}),
    videoLength,
  }
}

export async function resolveUipPromptRoute(input: {
  handoffClassifiedPromptRoute?: UipToStoryModeWorkflowParams['promptRouteClassified']
  handoffPromptRoute?: UipToStoryModeWorkflowParams['promptRoute']
  uipMode?: UipToStoryModeWorkflowParams['uipMode']
}): Promise<{
  classifiedPromptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRouteReason: string
  promptRouteSource: 'legacy_general' | 'uip_handoff'
}> {
  if (input.handoffPromptRoute) {
    const runtimePromptRoute = resolveUipHandoffRuntimePromptRoute(input.handoffPromptRoute)
    const classifiedPromptRoute = resolveUipHandoffClassifiedPromptRoute(
      input.handoffClassifiedPromptRoute ?? input.handoffPromptRoute,
    )
    const handoffResult = {
      classifiedPromptRoute,
      promptRoute: runtimePromptRoute,
      promptRouteReason:
        runtimePromptRoute === input.handoffPromptRoute
          ? 'UIP handoff prompt route used.'
          : 'UIP handoff music intent used; Story Mode runtime will use the music route only after a music beat sheet lands.',
      promptRouteSource: 'uip_handoff',
    } as const
    return applyUipModeRouteBoundary({
      ...handoffResult,
      uipMode: input.uipMode,
    })
  }

  return {
    classifiedPromptRoute: 'general',
    promptRoute: 'general',
    promptRouteReason: 'No UIP handoff route; using general route.',
    promptRouteSource: 'legacy_general',
  }
}

// Start best-effort BGM bed generation for the UIP route. Local copy
// of the classic orchestration helper (long-take/workflow.ts startLongTakeBgmBed)
// -- duplicated instead of imported because in-flight sibling PRs own
// workflows/long-take/workflow.ts; dedup is tracked as a follow-up.
// Skips (resolves null) when the toggle is off, the project took the music
// route (locked "no BGM over a song" decision), or no sized duration is
// available. The generate activity may resolve null (no bed) and PROPAGATES
// failures after activity retries, so the .catch here keeps an exhausted BGM
// failure from ever failing the project. Returns a promise that NEVER rejects.
export function startUipBgmBed(params: {
  bgmEnabled?: boolean | null
  durationSec?: number
  isMusicRoute: boolean
  logError: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  styleName?: string
  styleText?: string
  userEmail?: string
  userId: string
}): Promise<GenerateLongTakeBgmBedActivityResult | null> {
  const {
    bgmEnabled,
    durationSec,
    isMusicRoute,
    logError,
    orgId,
    projectId,
    styleName,
    styleText,
    userEmail,
    userId,
  } = params
  if (!bgmEnabled || isMusicRoute || !durationSec || durationSec <= 0) {
    return Promise.resolve(null)
  }
  return generateLongTakeBgmBed({
    durationSec,
    // durationSec on this path IS the voiceover duration, so a voiceover
    // always accompanies the bed; tell the director so it prompts for a
    // sparse, mid-scooped under-narration bed.
    hasVoiceover: true,
    orgId,
    projectId,
    styleName,
    styleText,
    userEmail,
    userId,
  }).catch((error) => {
    logError('uipToStoryMode: BGM bed generation failed (non-fatal)', {
      error: { message: error instanceof Error ? error.message : String(error) },
    })
    return null
  })
}

// Await the best-effort bed, persist its metadata onto the project,
// and RETURN the bed so the caller can thread its store address into the render
// stage (the export bake). Local copy of the classic settleLongTakeBgmBed (see
// startUipBgmBed for why). Fully fail-soft: the promise resolves null on
// skip/failure (no persist then, null returned), and a persist failure is
// logged but never fails the project -- the bed object already exists in storage,
// so the bake still proceeds even when only the metadata patch failed.
export async function settleUipBgmBed(params: {
  bgmBedPromise: Promise<GenerateLongTakeBgmBedActivityResult | null>
  logError: LongTakeWorkflowLogFn
  projectId: string
  userEmail?: string
  userId: string
}): Promise<GenerateLongTakeBgmBedActivityResult | null> {
  const { bgmBedPromise, logError, projectId, userEmail, userId } = params
  const bed = await bgmBedPromise
  if (!bed) {
    return null
  }
  try {
    await persistLongTakeBgmBed({ bed, projectId, userEmail, userId })
  } catch (error) {
    logError('uipToStoryMode: BGM persist failed (non-fatal)', {
      error: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  return bed
}

/**
 * Build a minimal pipelineContext array from the UIP-to-storymode workflow
 * params. The prod LongTakeWorkflow accumulates a richer context across
 * stages (intent analysis, prompt classification, asset analysis, etc.);
 * UIP does its own equivalent work upstream but the results aren't yet
 * threaded into this workflow's params. For now we surface what's
 * available so structured logs / metrics on shot-plan and transitions
 * activities carry the same shape as prod (and are not empty).
 */
export function applyUipStyleContext(input: {
  genreAnalysis?: UipToStoryModeWorkflowParams['genreAnalysis']
  intentAnalysis?: UipToStoryModeWorkflowParams['intentAnalysis']
  pipelineContext: PipelineContextEntry[]
  styleAnalysis?: UipToStoryModeWorkflowParams['styleAnalysis']
}): void {
  applyStyleResultToPipelineContext(input.pipelineContext, input.styleAnalysis)
  if (input.intentAnalysis?.trim()) {
    input.pipelineContext.push({ name: 'Intent Analysis', value: input.intentAnalysis.trim() })
  }
  if (input.genreAnalysis) {
    input.pipelineContext.push({
      name: 'Genre Analysis',
      value: JSON.stringify({
        primary_genre: input.genreAnalysis.primaryGenre,
        secondary_genre: input.genreAnalysis.secondaryGenre,
        scriptwriter_guidance: input.genreAnalysis.scriptwriterGuidance,
        style_application: input.genreAnalysis.styleApplication,
      }),
    })
  }
}

export function buildPipelineContextFromUipParams(input: {
  aspectRatio: string
  keyframeImageModel?: string
  originalUserInput?: string
  script: string
  styleName: string
  styleText: string
  transitionVideoModel?: string
  voiceId?: string
}): PipelineContextEntry[] {
  const entries: PipelineContextEntry[] = []
  const originalUserInput = input.originalUserInput?.trim()
  if (originalUserInput) {
    entries.push({ name: 'User initial prompt(Their intent)', value: originalUserInput })
  }
  if (input.script?.trim()) {
    entries.push({ name: 'user_script', value: input.script.trim() })
  }
  if (input.styleName?.trim()) {
    entries.push({ name: 'style_name', value: input.styleName.trim() })
  }
  if (input.styleText?.trim() && input.styleText.trim() !== input.styleName?.trim()) {
    entries.push({ name: 'style_text', value: input.styleText.trim() })
  }
  if (input.aspectRatio?.trim()) {
    entries.push({ name: 'aspect_ratio', value: input.aspectRatio.trim() })
  }
  if (input.transitionVideoModel?.trim()) {
    entries.push({ name: 'transition_video_model', value: input.transitionVideoModel.trim() })
  }
  if (input.voiceId?.trim()) {
    entries.push({ name: 'voice_id', value: input.voiceId.trim() })
  }
  if (input.keyframeImageModel?.trim()) {
    entries.push({ name: 'keyframe_image_model', value: input.keyframeImageModel.trim() })
  }
  return entries
}

export function resolveUipStoryModeUserPrompt(input: {
  originalUserInput?: string
  script: string
}): string {
  const script = input.script.trim()
  const originalUserInput = input.originalUserInput?.trim()
  if (!originalUserInput) {
    return script
  }
  if (
    !script ||
    normalizePromptForCompare(originalUserInput) === normalizePromptForCompare(script)
  ) {
    return originalUserInput
  }
  return [
    `Original user request: ${originalUserInput}`,
    `Confirmed transcript/script: ${script}`,
  ].join('\n\n')
}

export function resolveUipTrackingPromptRouteClassified(input: {
  classifiedPromptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  isMusic?: boolean
}): NonNullable<UipToStoryModeWorkflowParams['promptRoute']> {
  return input.isMusic === true ? 'music' : input.classifiedPromptRoute
}

export function resolveUipWorkflowLongVideoAttemptSource(input: {
  handoffLongVideoAttemptSource?: LongVideoAttemptSource
  preVoiceoverAudioDurationSeconds?: number
  script: string
}): LongVideoAttemptSource | undefined {
  if (input.handoffLongVideoAttemptSource) {
    return input.handoffLongVideoAttemptSource
  }
  if (isLongVideoDuration(input.preVoiceoverAudioDurationSeconds)) {
    return 'audio_upload'
  }
  return isLongVideoScriptDuration(estimateScriptDurationSeconds(input.script))
    ? 'script_length'
    : undefined
}

function applyUipModeRouteBoundary(input: {
  classifiedPromptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRouteReason: string
  promptRouteSource: 'legacy_general' | 'uip_handoff'
  uipMode?: UipToStoryModeWorkflowParams['uipMode']
}): {
  classifiedPromptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRouteReason: string
  promptRouteSource: 'legacy_general' | 'uip_handoff'
} {
  if (!input.uipMode) {
    return input
  }
  const uipMode = input.uipMode

  if (uipMode === 'narrative_story') {
    return coerceDisallowedRoutesToGeneral(
      { ...input, uipMode },
      (route) => route === 'general' || route === 'music',
    )
  }

  if (uipMode === 'explainer') {
    return coerceDisallowedRoutesToGeneral(
      { ...input, uipMode },
      (route) => route === 'abstract' || route === 'general' || route === 'music',
    )
  }

  if (uipMode === 'ads') {
    return coerceDisallowedRoutesToGeneral(
      { ...input, uipMode },
      (route) => route !== 'abstract' && route !== 'music',
    )
  }

  return input
}

function coerceDisallowedRoutesToGeneral(
  input: {
    classifiedPromptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
    promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
    promptRouteReason: string
    promptRouteSource: 'legacy_general' | 'uip_handoff'
    uipMode: NonNullable<UipToStoryModeWorkflowParams['uipMode']>
  },
  isAllowed: (route: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>) => boolean,
): {
  classifiedPromptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>
  promptRouteReason: string
  promptRouteSource: 'legacy_general' | 'uip_handoff'
} {
  const promptRoute = isAllowed(input.promptRoute) ? input.promptRoute : 'general'
  const classifiedPromptRoute = isAllowed(input.classifiedPromptRoute)
    ? input.classifiedPromptRoute
    : 'general'
  if (promptRoute === input.promptRoute && classifiedPromptRoute === input.classifiedPromptRoute) {
    return input
  }

  return {
    classifiedPromptRoute,
    promptRoute,
    promptRouteReason: `${input.promptRouteReason} Overridden to general because UIP mode is ${input.uipMode} and the route is outside the allowed route set for that confirmed mode.`,
    promptRouteSource: input.promptRouteSource,
  }
}

function normalizePromptForCompare(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function resolveUipHandoffClassifiedPromptRoute(
  promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>,
): NonNullable<UipToStoryModeWorkflowParams['promptRoute']> {
  // 'music' is a music/audio intent from UIP handoff, not a route-classifier output.
  // The actual music route is tracked separately via promptRouteEffective once the
  // music beat sheet lands.
  return promptRoute === 'music' ? 'general' : promptRoute
}

function resolveUipHandoffRuntimePromptRoute(
  promptRoute: NonNullable<UipToStoryModeWorkflowParams['promptRoute']>,
): NonNullable<UipToStoryModeWorkflowParams['promptRoute']> {
  // UIP can classify an audio upload as music before Story Mode has built a music beat sheet. Treat
  // that as intent only: the runtime route becomes music only via resolveMusicVideoRoute, after
  // long_take/beat_sheet.json is actually written.
  return promptRoute === 'music' ? 'general' : promptRoute
}
