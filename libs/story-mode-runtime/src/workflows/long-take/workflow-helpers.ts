import type { LongVideoAttemptSource } from '@reelmakeeasy/common/story-mode/long-video-attribution'
import type { FailureClass } from '@reelmakeeasy/common/utils/failure-class'

import { ideateVisualTreatment } from './activity-proxies'
import type {
  GenerateLongTakeVoiceoverActivityResult,
  LongTakeKeyframeItem,
  LongTakeShotPlanItem,
  LongTakeUserAssetCatalogItem,
} from './types'
import type { LongTakeWorkflowLogFn } from './workflow-runtime'

type FasterTtsTrackingProperties = {
  fasterTtsApplied: boolean
  fasterTtsCohort: 'faster_tts' | 'legacy' | 'not_evaluated'
  fasterTtsEvaluated: boolean
  fasterTtsPostWpm?: number
  fasterTtsPreWpm?: number
  fasterTtsRatio?: number
  fasterTtsSkipReason?: GenerateLongTakeVoiceoverActivityResult['fasterTtsSkipReason']
  fasterTtsStatus: 'applied' | 'not_evaluated' | 'skipped'
  fasterTtsTargetWpm?: number
  fasterTtsWasCapped?: boolean
}

/** Upserts the Style entry in pipelineContext with the richer image-derived analysis. */
export function applyStyleResultToPipelineContext(
  pipelineContext: Array<{ name: string; value: string }>,
  styleResult:
    | null
    | undefined
    | {
        colorPalette: Record<string, { hex: string; percentage: string }>
        keyStyleTags: string[]
        reproductionGuidance?: null | string
        reusableStylePrompt: string
        styleDescription: string
      },
): void {
  if (!styleResult) {
    return
  }
  // Older payloads may carry colorPalette as a plain string (written before
  // the schema change). Guard at runtime to
  // avoid Object.entries iterating over characters and corrupting the context.
  const paletteText =
    typeof styleResult.colorPalette === 'string'
      ? (styleResult.colorPalette as unknown as string)
      : Object.entries(styleResult.colorPalette)
          .map(([name, { hex, percentage }]) => `${name} (${hex}, ${percentage})`)
          .join(', ')
  const richStyleValue = [
    styleResult.styleDescription,
    `Tags: ${styleResult.keyStyleTags.join(', ')}`,
    `Palette: ${paletteText}`,
    `Style prompt: ${styleResult.reusableStylePrompt}`,
    styleResult.reproductionGuidance
      ? `Style constraints: ${styleResult.reproductionGuidance}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
  const styleIndex = pipelineContext.findIndex((e) => e.name === 'Style Analysis')
  if (styleIndex === -1) {
    pipelineContext.push({ name: 'Style Analysis', value: richStyleValue })
  } else {
    pipelineContext[styleIndex] = { name: 'Style Analysis', value: richStyleValue }
  }
}

/** Runs visual treatment. */
export function buildAssetLibraryTrackingProperties(
  transitionVideos: ReadonlyArray<{ usedAssetLibrary?: boolean }>,
): { assetLibraryEnabled: boolean; assetLibraryTransitionsCount: number } {
  let count = 0
  for (const v of transitionVideos) {
    if (v.usedAssetLibrary === true) {
      count++
    }
  }
  return { assetLibraryEnabled: count > 0, assetLibraryTransitionsCount: count }
}

export function buildFasterTtsStatusMeta(
  voiceoverResult: GenerateLongTakeVoiceoverActivityResult,
): Record<string, number | string> {
  const tracking = buildFasterTtsTrackingProperties(voiceoverResult)
  const meta: Record<string, number | string> = {
    fasterTtsApplied: String(tracking.fasterTtsApplied),
    fasterTtsCohort: tracking.fasterTtsCohort,
    fasterTtsEvaluated: String(tracking.fasterTtsEvaluated),
    fasterTtsStatus: tracking.fasterTtsStatus,
  }
  assignMetaNumber(meta, 'fasterTtsPostWpm', tracking.fasterTtsPostWpm)
  assignMetaNumber(meta, 'fasterTtsPreWpm', tracking.fasterTtsPreWpm)
  assignMetaNumber(meta, 'fasterTtsRatio', tracking.fasterTtsRatio)
  assignMetaNumber(meta, 'fasterTtsTargetWpm', tracking.fasterTtsTargetWpm)
  if (tracking.fasterTtsSkipReason) {
    meta.fasterTtsSkipReason = tracking.fasterTtsSkipReason
  }
  if (tracking.fasterTtsWasCapped !== undefined) {
    meta.fasterTtsWasCapped = String(tracking.fasterTtsWasCapped)
  }
  return meta
}

export function buildFasterTtsTrackingProperties(
  voiceoverResult: GenerateLongTakeVoiceoverActivityResult,
): FasterTtsTrackingProperties {
  const fasterTtsApplied = voiceoverResult.fasterTtsApplied === true
  const fasterTtsEvaluated = voiceoverResult.fasterTtsEvaluated === true
  const fasterTtsStatus = fasterTtsApplied
    ? 'applied'
    : fasterTtsEvaluated
      ? 'skipped'
      : 'not_evaluated'
  const fasterTtsCohort = resolveFasterTtsCohort(voiceoverResult)

  const tracking: FasterTtsTrackingProperties = {
    fasterTtsApplied,
    fasterTtsCohort,
    fasterTtsEvaluated,
    fasterTtsStatus,
  }
  assignNumber(tracking, 'fasterTtsPostWpm', voiceoverResult.fasterTtsPostWpm)
  assignNumber(tracking, 'fasterTtsPreWpm', voiceoverResult.fasterTtsPreWpm)
  assignNumber(tracking, 'fasterTtsRatio', voiceoverResult.fasterTtsRatio)
  assignNumber(tracking, 'fasterTtsTargetWpm', voiceoverResult.fasterTtsTargetWpm)
  if (voiceoverResult.fasterTtsSkipReason) {
    tracking.fasterTtsSkipReason = voiceoverResult.fasterTtsSkipReason
  }
  if (voiceoverResult.fasterTtsWasCapped !== undefined) {
    tracking.fasterTtsWasCapped = voiceoverResult.fasterTtsWasCapped
  }
  return tracking
}

// Pure (no config reads): derives the image-model OUTCOME props for the
// completed event from the keyframes the workflow actually produced. Collects
// deduped non-empty `keyframe.imageModel` values and ALWAYS surfaces them as
// `imageModelUsed`, even when the project ran on the resolved default (no
// explicit selection) -- otherwise the model the project actually rendered with
// is dropped to "(not set)" for the majority of projects. The
// fallback comparison still needs a resolved selection to diff against, so
// `fallbackModelUsed` / `imageModelFallbackOccurred` are only emitted when one
// is present. `imageModelUsed` and `fallbackModelUsed` are INTERNAL analytics
// only (E26) -- never surfaced to a client.
export function buildImageModelOutcomeTrackingProperties(params: {
  keyframes: LongTakeKeyframeItem[]
  resolvedImageModel?: string
}): { fallbackModelUsed?: string; imageModelFallbackOccurred?: boolean; imageModelUsed?: string } {
  const resolvedImageModel = params.resolvedImageModel?.trim()
  const usedModels = [
    ...new Set(
      params.keyframes
        .map((keyframe) => keyframe.imageModel?.trim())
        .filter((model): model is string => Boolean(model)),
    ),
  ]
  if (!usedModels.length) {
    return {}
  }
  if (!resolvedImageModel) {
    return { imageModelUsed: usedModels.join(', ') }
  }
  const fallbackModels = usedModels.filter((model) => model !== resolvedImageModel)
  return {
    ...(fallbackModels.length ? { fallbackModelUsed: fallbackModels.join(', ') } : {}),
    imageModelFallbackOccurred: fallbackModels.length > 0,
    imageModelUsed: usedModels.join(', '),
  }
}

export function buildKeyframeImageModelTrackingProperties(params: {
  keyframes: LongTakeKeyframeItem[]
  requestedModel?: string
}): { keyframeImageModel?: string } {
  const imageModels = [
    ...new Set(
      params.keyframes
        .map((keyframe) => keyframe.imageModel?.trim())
        .filter((model): model is string => Boolean(model)),
    ),
  ]
  const keyframeImageModel = imageModels.length
    ? imageModels.join(', ')
    : params.requestedModel?.trim()

  return keyframeImageModel ? { keyframeImageModel } : {}
}

/**
 * Resolve the transition video model to report on completion.
 *
 * Under the server-side rollout the workflow-level `transitionVideoModel` param is empty
 * (only set on an explicit API/debug override), so the real model is the one resolved per
 * transition at generation time and carried on each transition video item. All transitions
 * in a project resolve the same model, so the first defined value is representative. Falls
 * back to the request-level override when no transition recorded a model (e.g. all black
 * screens).
 */
export function resolveEffectiveTransitionVideoModel(
  transitionVideos: ReadonlyArray<{ transitionVideoModel?: string }>,
  overrideModel?: string,
): string | undefined {
  for (const v of transitionVideos) {
    if (v.transitionVideoModel) {
      return v.transitionVideoModel
    }
  }
  return overrideModel
}

export async function runContextEnrichmentStages(params: {
  logError: LongTakeWorkflowLogFn
  logInfo: LongTakeWorkflowLogFn
  pipelineContext: Array<{ name: string; value: string }>
  projectId: string
  userId: string
}): Promise<void> {
  const { logError, logInfo, pipelineContext, projectId, userId } = params

  try {
    const visualTreatmentResult = await ideateVisualTreatment({
      pipelineContext,
      projectId,
      userId,
    })
    if (visualTreatmentResult) {
      pipelineContext.push({
        name: 'Visual Treatment',
        value: visualTreatmentResult.expertRecommendations,
      })
      logInfo('longTakeWorkflow visual treatment ready', {
        outputPath: visualTreatmentResult.outputPath,
      })
    }
  } catch (error) {
    logError('longTakeWorkflow visual treatment failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

function resolveFasterTtsCohort(
  voiceoverResult: GenerateLongTakeVoiceoverActivityResult,
): FasterTtsTrackingProperties['fasterTtsCohort'] {
  if (voiceoverResult.fasterTtsCohort) {
    return voiceoverResult.fasterTtsCohort
  }
  if (voiceoverResult.fasterTtsEvaluated !== true) {
    return 'not_evaluated'
  }
  return voiceoverResult.fasterTtsSkipReason === 'flag-off' ? 'legacy' : 'faster_tts'
}

// ---------------------------------------------------------------------------
// Pure utility functions shared by workflow.ts
// ---------------------------------------------------------------------------

export function buildLongVideoMeta(
  videoLength: number,
  longVideoAttemptSource?: LongVideoAttemptSource,
  promptUseCase?: string,
): Record<string, number | string> {
  return {
    ...(longVideoAttemptSource ? { longVideoAttemptSource } : {}),
    ...(promptUseCase ? { promptUseCase } : {}),
    videoLength,
  }
}

export function buildShotDurationStats(shots: LongTakeShotPlanItem[]): {
  maxShotLength?: number
  minShotLength?: number
  shotVariance?: number
} {
  const shotDurations = shots.map((shot) => shot.time_range.end - shot.time_range.start)
  if (shotDurations.length === 0) {
    return {}
  }
  const maxShotLength = Math.max(...shotDurations)
  const minShotLength = Math.min(...shotDurations)
  const mean =
    shotDurations.reduce((accumulator, duration) => accumulator + duration, 0) /
    shotDurations.length
  const shotVariance =
    shotDurations.reduce((accumulator, duration) => accumulator + (duration - mean) ** 2, 0) /
    shotDurations.length
  return { maxShotLength, minShotLength, shotVariance }
}

export function buildVoiceExecutionTrackingProperties(params: {
  audioPath?: string
  selectedVoiceId?: string
  voiceoverResult: GenerateLongTakeVoiceoverActivityResult
}): Record<string, string> {
  const { audioPath, selectedVoiceId, voiceoverResult } = params
  const voiceSource = resolveVoiceSource(audioPath, voiceoverResult.ttsProvider)
  const actualVoiceProvider = voiceoverResult.ttsProvider
  const selectedVoiceType = audioPath ? 'upload_audio' : selectedVoiceId ? 'presets' : undefined
  const actualVoiceType = audioPath ? 'upload_audio' : actualVoiceProvider ? 'presets' : undefined

  return {
    ...(audioPath
      ? { voiceId: 'customVoice' }
      : selectedVoiceId
        ? { voiceId: selectedVoiceId }
        : {}),
    ...(voiceSource ? { voiceSource } : {}),
    ...(selectedVoiceId ? { selectedVoiceId } : {}),
    ...(selectedVoiceType ? { selectedVoiceType } : {}),
    ...(actualVoiceType ? { actualVoiceType } : {}),
    ...(actualVoiceProvider ? { actualVoiceProvider } : {}),
    ...(voiceSource ? { actualVoiceSource: voiceSource } : {}),
  }
}

export function countAssetMentionsInPrompt(prompt: string): number {
  const matches = prompt.match(/@img\[/g)
  return matches ? matches.length : 0
}

export function countUserAssetsByCategory(catalog: LongTakeUserAssetCatalogItem[]): {
  actor: number
  logo: number
  object: number
  other: number
  total: number
} {
  let actor = 0
  let logo = 0
  let object = 0
  let other = 0
  for (const item of catalog) {
    const name = item.shortname.toLowerCase()
    if (name.startsWith('actor image')) {
      actor++
    } else if (name.startsWith('logo image')) {
      logo++
    } else if (name.startsWith('object image')) {
      object++
    } else {
      // Uploads without the anchor-slot prefix (e.g. UIP chat drag-drop).
      other++
    }
  }
  return { actor, logo, object, other, total: actor + logo + object + other }
}

// Non-retryable ApplicationFailures carry no HTTP status and are not timeouts, so without this
// map every one of them lands on 'internal' and the failure_class tag cannot tell them apart.
// Read before the status checks: a declared failure type beats a number parsed out of prose.
const FAILURE_CLASS_BY_FAILURE_TYPE: Record<string, FailureClass> = {
  TRANSITION_PLAN_EMPTY: 'invalid_plan',
  TRANSITION_PLAN_MISSING_KEYFRAMES: 'invalid_plan',
  TRANSITION_PLAN_SEGMENT_TOO_LONG: 'invalid_plan',
  TRANSITION_PLAN_SLOT_TOO_LONG: 'invalid_plan',
}

export function getWorkflowFailureClass(error: unknown): FailureClass {
  const declared = readFailureType(error)
  // Own-property check: a bare index would resolve inherited keys, so a failure type of
  // "toString" would hand back Object.prototype.toString as the class.
  if (declared && Object.hasOwn(FAILURE_CLASS_BY_FAILURE_TYPE, declared)) {
    return FAILURE_CLASS_BY_FAILURE_TYPE[declared]
  }
  const status = normalizeHttpStatus(extractHttpStatusFromFields(error))
  if (status) {
    return `${status}` as `${number}`
  }
  if (isTimeoutError(error)) {
    return 'timeout'
  }
  const statusFromMessage = extractStatusFromMessage(getErrorMessage(error))
  if (statusFromMessage) {
    return `${statusFromMessage}` as `${number}`
  }
  return 'internal'
}

// Duck-typed rather than `instanceof ApplicationFailure`: the error reaching the workflow's catch
// is often a deserialized ActivityFailure cause, which carries the field but not the prototype.
export function isTimeoutError(error: unknown): boolean {
  const content = getErrorMessage(error).toLowerCase()
  return /(timeout|timed out|etimedout|deadline exceeded|request aborted|aborted)/i.test(content)
}

export function resolveGlobalScript(
  voiceoverScriptText: string | undefined,
  script: string,
): string | undefined {
  return voiceoverScriptText?.trim() || script.trim() || undefined
}

export function resolveVoiceSource(
  audioPath: string | undefined,
  ttsProvider:
    | 'byteplus'
    | 'elevenlabs'
    | 'fal'
    | 'gemini'
    | 'kokoro'
    | 'minimax'
    | 'qwen3'
    | undefined,
):
  | 'byteplus_tts'
  | 'elevenlabs_tts'
  | 'fal_tts'
  | 'gemini_tts'
  | 'kokoro_tts'
  | 'minimax_tts'
  | 'qwen3_tts'
  | 'uploaded_audio'
  | undefined {
  if (audioPath) {
    return 'uploaded_audio'
  }
  if (ttsProvider === 'byteplus') {
    return 'byteplus_tts'
  }
  if (ttsProvider === 'gemini') {
    return 'gemini_tts'
  }
  if (ttsProvider === 'minimax') {
    return 'minimax_tts'
  }
  // Distinct from 'minimax_tts' on purpose -- the A/B compares the two
  // vendor routes, so collapsing them would make the comparison unreadable.
  if (ttsProvider === 'fal') {
    return 'fal_tts'
  }
  if (ttsProvider === 'elevenlabs') {
    return 'elevenlabs_tts'
  }
  if (ttsProvider === 'kokoro') {
    return 'kokoro_tts'
  }
  if (ttsProvider === 'qwen3') {
    return 'qwen3_tts'
  }
  return undefined
}

function assignMetaNumber(
  target: Record<string, number | string>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) {
    target[key] = value
  }
}

function assignNumber<T extends keyof FasterTtsTrackingProperties>(
  target: FasterTtsTrackingProperties,
  key: T,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) {
    const typedTarget = target as Record<string, unknown>
    typedTarget[String(key)] = value
  }
}

function extractHttpStatusFromFields(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const statusError = error as {
    httpStatus?: number
    response?: { status?: number }
    status?: number
    statusCode?: number
  }
  return normalizeHttpStatus(
    statusError.httpStatus ||
      statusError.status ||
      statusError.statusCode ||
      statusError.response?.status,
  )
}

function extractStatusFromMessage(message: string): number | undefined {
  if (!message) {
    return undefined
  }
  const match = message.match(/\b([45]\d{2})\b/)
  if (!match) {
    return undefined
  }
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function normalizeHttpStatus(status?: number): number | undefined {
  if (!Number.isFinite(status)) {
    return undefined
  }
  const normalized = Number(status)
  if (normalized < 100 || normalized > 599) {
    return undefined
  }
  return normalized
}

function readFailureType(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const failureType = (error as { type?: unknown }).type
  return typeof failureType === 'string' ? failureType : undefined
}
