/**
 * Playground visual script generation tool.
 *
 * Responsibilities:
 * - FULL scope: long-take legacy style full-script visual planning + shot segmentation
 * - PARTIAL scope: scoped visual updates for target shots
 * - Deterministic duration assignment based on global_constraints.pacing + shot word count
 */

import type { Content } from '@reelmakeeasy/common/llm'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { z } from 'zod'

import { VISUAL_SCRIPT_TOOL_MODELS } from '../model-config'
import { formatLogFields } from '../runtime/planner-log'
import { normalizeNarrationForCoverage } from '../tool-internals/beat-sheet-script-coverage'
import { parseConversationContext } from '../tool-internals/conversation-context'
import {
  normalizeFullCoverageVisualScriptByBeat,
  parseFullScopeBeatSheet,
  parseFullScopeBeatSheetMeta,
} from '../tool-internals/full-scope-visual-script-normalization'
import {
  extractAnchorSourceAssetIdsByAnchorId,
  extractKnownAnchorIds,
  extractKnownAssetIds,
  extractUserUploadBrandAssetIds,
} from '../tool-internals/visual-script-asset-ids'
import { normalizeVisualShotId } from '../tool-internals/visual-script-shot-id'
import { applyDeterministicDurations, DEFAULT_WPM } from '../tool-internals/visual-script-timing'
import { buildUipVisualScriptPromptForScope } from '../tool-internals/visual-script-uip-prompts'
import {
  GlobalConstraints,
  PlannerPhase,
  PlannerStructureEdit,
  PlannerToolParams,
  ScriptShotEdit,
  Shot,
  type UipPromptRoute,
} from '../types'

export { renderVisualScriptRouteGuidance } from '../tool-internals/visual-script-route-guidance'

const logger = createSubLogger('uip-planner-runtime:generate-visual-script')

const NonEmptyStringSchema = z.string().trim().min(1)

const ShotOutputSchema = z.object({
  shot_id: NonEmptyStringSchema.describe('Stable shot identifier (e.g. shot_1, shot_2, shot_3)'),
  order: z.number().int().positive().describe('Display order (1-based)'),
  time: z.object({
    start_s: z.number().describe('Shot start time in seconds'),
    end_s: z.number().describe('Shot end time in seconds'),
  }),
  audio_vo: z
    .string()
    .trim()
    .describe('Exact voice-over text for this shot; empty ONLY for instrumental music beats'),
  visual_primary: z.object({
    expression_type: z.enum(['Literal', 'Cultural Context', 'Symbolic']),
    aesthetic_mode: z.enum(['Live Action', 'Composited Graphic', 'UI-Infographic']),
    core_description: NonEmptyStringSchema.describe(
      'Concrete visual description of what is shown; must not be empty',
    ),
    entry_action: z.string().nullable().default(null),
    exit_action: z.string().nullable().default(null),
    notes: z.array(z.string()).default([]),
  }),
  pre_selected_assets: z.array(
    z.object({
      asset_id: NonEmptyStringSchema,
      source: z.string().trim().default('user_upload'),
      usage: z.string().trim().default('primary anchor'),
    }),
  ),
})

export const VisualScriptOutputSchema = z.object({
  shots: z.array(ShotOutputSchema),
})

/**
 * Story Mode 3.0 shot shape. core_description now carries the whole
 * clip in time order, so entry_action / exit_action are gone and
 * transition_to_next says how the shot reaches the next one.
 *
 * Kept as a second closed schema rather than making fields optional on the V2
 * one: a bare `.optional()` throws inside zodResponseFormat, and every model
 * tier falls back to OpenAI, which is exactly how a regression shipped twice. Two
 * complete schemas sidestep that instead of managing it.
 */
const ShotOutputSchemaV3 = ShotOutputSchema.extend({
  visual_primary: z.object({
    expression_type: z.enum(['Literal', 'Cultural Context', 'Symbolic']),
    aesthetic_mode: z.enum(['Live Action', 'Composited Graphic', 'UI-Infographic']),
    core_description: NonEmptyStringSchema.describe(
      'The whole clip written in time order, starting from its opening instant',
    ),
    transition_to_next: z
      .enum(['cut', 'continuous'])
      .nullable()
      .describe('How this shot hands off to the next one; null on the last shot'),
    notes: z.array(z.string()).default([]),
  }),
})

export const VisualScriptOutputSchemaV3 = z.object({
  shots: z.array(ShotOutputSchemaV3),
})

type GeneratedVisualScriptShot =
  | z.infer<typeof ShotOutputSchema>
  | z.infer<typeof ShotOutputSchemaV3>

type VisualScriptGenerationOptions = {
  anchorAssetsJson?: string
  anchorImageContents?: Content[]
  assetDescriptionsJson?: string
  beatSheetJson?: string
  conversationContext?: string
  existingShotsJson?: string
  fixedSegments?: ScriptShotEdit[]
  /**
   * User-facing quality tier of the session, and the session id used as the
   * randomization unit. Together they key the primary model of the
   * chain in the `uip_script_model` dynamic config. Both absent
   * (any non-UIP-v2 caller, or a session with no tier) keeps the compiled-in
   * chain, so this stays additive.
   */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  musicContextJson?: string
  params: PlannerToolParams
  phase?: PlannerPhase
  promptRoute?: UipPromptRoute
  sessionId?: string
  /**
   * Pinned `enable_story_mode_v3` evaluation. Selects the Story Mode 3.0 shot
   * contract (one chronological core_description + transition_to_next) over the
   * V2 three-phase one, for both the prompt and the response schema.
   */
  storyModeV3Enabled?: boolean
  structureEdit?: null | PlannerStructureEdit
  /**
   * Word-level transcript from the ASR pre-voiceover pipeline (audio
   * mode only). When present, shot durations are derived from
   * transcript timestamps instead of DEFAULT_WPM.
   */
  transcriptWords?: import('@shared/types/agent/transcript').TranscriptWord[]
  transitionVideoModel?: string
  worldBibleJson?: string
}

/**
 * The last shot of a FULL sequence hands off to nothing, so its
 * `transition_to_next` must be null.
 *
 * Enforced on the finalized sequence rather than inside beat normalization: the
 * fixed-segments path skips that normalization entirely (`beatSheetJson` is
 * deliberately "{}" there), and the response schema allows "cut"/"continuous" at
 * any index, so structured decoding cannot enforce the prompt's rule either.
 * Only FULL sees the whole sequence -- PARTIAL and STRUCTURE return a subset
 * whose last element is not the last shot -- which is why this is not in the
 * shared shot mapper. No-op on V2 shots, which carry no hand-off.
 */
export async function generateExplainerVisualScript(
  script: string,
  constraints: GlobalConstraints,
  directives: null | string[],
  options: VisualScriptGenerationOptions,
): Promise<Shot[]> {
  const params = options.params
  const structureEdit = options.structureEdit ?? null
  const existingShots = parseExistingShots(options?.existingShotsJson)
  const existingShotIds = existingShots.map((shot) => shot.shot_id)
  const targetShotIds = resolveTargetShotIds(params, existingShotIds)
  const fullCoverage = isFullScopeOrCoverage(params, existingShotIds, targetShotIds)

  const parsedContext = parseConversationContext(options?.conversationContext?.trim() || '')
  const anchorAssetsJson = options?.anchorAssetsJson?.trim() || '{"candidates":[]}'
  const assetDescriptionsJson = options?.assetDescriptionsJson?.trim() || '{}'
  const promptRoute = options.promptRoute ?? 'general'

  const notes = buildUserIntentNotes(directives, parsedContext.latestUserMessage)

  const isStructureMode =
    structureEdit !== null &&
    (structureEdit.op === 'INSERT' || structureEdit.op === 'SPLIT' || structureEdit.op === 'MERGE')
  const fixedSegments =
    fullCoverage && !isStructureMode
      ? (options.fixedSegments ?? []).filter((segment) => segment.audio_vo.trim().length > 0)
      : []
  const beatSheet = fixedSegments.length > 0 ? [] : parseFullScopeBeatSheet(options.beatSheetJson)
  const beatSheetMeta = parseFullScopeBeatSheetMeta(options.beatSheetJson)
  assertRequiredFullScopeBeatSheet({ beatSheet, fixedSegments, isStructureMode, params })
  const prompt = buildVisualScriptPromptForGeneration({
    anchorAssetsJson,
    assetDescriptionsJson,
    constraints,
    existingShotIds,
    existingShots,
    fixedSegments,
    fullCoverage,
    isStructureMode,
    notes,
    options,
    params,
    parsedContext,
    promptRoute,
    script,
    structureEdit,
    targetShotIds,
  })

  // Estimated shot count drives the per-call timeout. Each shot produces
  // ~30-50 tokens of structured JSON (visual_primary + audio_vo + asset
  // bindings), and the LLM also reasons globally before emitting any shot.
  // For long-form scripts (10 min ~= 1500 words ~= 100 shots) the flat 90s
  // budget was hit by every retry across gemini-3.1-pro and gpt-5.4 on a
  // long script.
  const estimatedShotCount = estimateShotCountFromScript(script)
  const timeoutMs = computeVisualScriptTimeoutMs(estimatedShotCount)
  logger.info(
    `[uip-visual-script] start scope=${params.scope} editMode=${params.edit_mode} promptRoute=${promptRoute} promptChars=${prompt.length} estimatedShots=${estimatedShotCount} timeoutMs=${timeoutMs}`,
  )
  const startedAt = Date.now()

  const rawShots = await completeVisualScriptShots({
    anchorAssetsJson,
    assetDescriptionsJson,
    constraints,
    options,
    params,
    prompt,
    timeoutMs,
  })

  logger.info(
    `[uip-visual-script] done durationMs=${Date.now() - startedAt} shots=${rawShots.length}`,
  )

  const normalized = rawShots.map((shot, index) => ({
    shot_id: normalizeVisualShotId(shot.shot_id, index),
    order: shot.order || index + 1,
    time: {
      start_s: shot.time.start_s,
      end_s: shot.time.end_s,
    },
    audio_vo: shot.audio_vo.trim(),
    visual_primary: {
      expression_type: shot.visual_primary.expression_type,
      aesthetic_mode: shot.visual_primary.aesthetic_mode,
      core_description: shot.visual_primary.core_description.trim(),
      // V3 folds the whole take into core_description, so it emits neither
      // entry/exit action; V2 emits no transition_to_next. Each side leaves the
      // other's fields at their schema default rather than inventing a value.
      entry_action:
        ('entry_action' in shot.visual_primary && shot.visual_primary.entry_action?.trim()) || null,
      exit_action:
        ('exit_action' in shot.visual_primary && shot.visual_primary.exit_action?.trim()) || null,
      // Left absent (not null) on V2 shots so a gate-off spec is byte-identical
      // to what main persists. Writing null would add a field to every shot in
      // every session, growing the spec and showing up as a change in the
      // shot-level diffs the transcript card renders.
      transition_to_next:
        'transition_to_next' in shot.visual_primary
          ? shot.visual_primary.transition_to_next
          : undefined,
      // `availability` is no longer emitted by the VS output schema (no
      // downstream decision reads it); default it to keep the Shot type valid.
      availability: 'MED',
      notes: shot.visual_primary.notes,
    },
    pre_selected_assets: [],
  })) satisfies Shot[]
  const brandBank = constraints.brand_bank ?? null
  const userUploadBrandIds = extractUserUploadBrandAssetIds(brandBank)
  // Full-generation output must consume every selected upload, either directly
  // or through a bound anchor. The prompt separates those obligations, while
  // the assertion receives all IDs and accepts either binding form.
  const mandatoryUserUploadIds = fullCoverage ? userUploadBrandIds : []
  const describedAssetIds = extractKnownAssetIds(assetDescriptionsJson, brandBank)
  const allowedUserUploadIds = [...new Set([...describedAssetIds, ...userUploadBrandIds])]
  const knownAnchorIds = extractKnownAnchorIds(anchorAssetsJson)
  const normalizedWithAssets = normalized.map((shot, index) => ({
    ...shot,
    pre_selected_assets: normalizePreSelectedAssets(
      rawShots[index]?.pre_selected_assets ?? [],
      allowedUserUploadIds,
      knownAnchorIds,
      shot.shot_id,
    ),
  })) satisfies Shot[]

  // Timing source:
  //   - audio mode (transcriptWords available) -> word-timestamp alignment
  //   - else -> DEFAULT_WPM estimate
  // pacing is a visual-beat-sheet hint only; it does not drive duration here.
  const timingOptions = {
    wpm: DEFAULT_WPM,
    transcriptWords: options.transcriptWords,
  }

  if (isStructureMode) {
    // INSERT/SPLIT/MERGE returns only the generated replacement subset. The
    // runtime validates mandatory uploads after deterministically merging this
    // subset with preserved shots; checking here would reject uploads already
    // bound to an unaffected shot.
    return applyDeterministicDurations(normalizedWithAssets, timingOptions, 0)
  }

  if (fullCoverage) {
    // Beat-locked sheet: cut timing comes from the musical beat grid, so the beat time
    // ranges are authoritative and the transcript/wpm re-timing below must not run -- it would
    // re-time instrumental (empty-text) beats by word counts and break beat alignment.
    const beatLocked =
      beatSheetMeta.timeRangeAudited &&
      !beatSheetMeta.textAudited &&
      beatSheet.length > 0 &&
      beatSheet.every((beat) => beat.time_range)
    const fullShots =
      beatSheet.length > 0
        ? normalizeFullCoverageVisualScriptByBeat({
            beatSheet,
            generatedShots: normalizedWithAssets,
            preferBeatAudioVo: beatSheetMeta.textAudited,
            preferBeatTimeRanges: beatLocked,
          })
        : normalizedWithAssets.map((shot, index) => ({
            ...shot,
            shot_id: normalizeVisualShotId(shot.shot_id, index),
            order: index + 1,
          }))
    nullLastShotHandOff(fullShots)
    if (beatSheet.length > 0 && fullShots.length !== normalizedWithAssets.length) {
      logger.warn(
        `[uip-visual-script] normalized full-scope output by beat sheet generatedShots=${normalizedWithAssets.length} beatCount=${beatSheet.length}`,
      )
    }
    if (params.scope === 'FULL' && fixedSegments.length === 0 && !beatLocked) {
      reportFullVisualScriptCoverage(fullShots, script, beatSheetMeta.textAudited === true)
    }
    // Run the mandatory-bindings check on the finalized shot list. The beat-sheet
    // reconciliation above can drop or remap shots, so checking the pre-reconciled
    // `normalizedWithAssets` would miss mandatory ids that only lived on dropped shots.
    assertMandatoryUserUploadsPresent(fullShots, mandatoryUserUploadIds, anchorAssetsJson)
    if (beatLocked) {
      return fullShots
    }
    return applyDeterministicDurations(fullShots, timingOptions, 0)
  }

  if (targetShotIds.length === 0) {
    return []
  }

  if (normalizedWithAssets.length < targetShotIds.length) {
    throw new Error(
      `Partial visual update returned ${normalizedWithAssets.length} shot(s), expected ${targetShotIds.length}.`,
    )
  }

  const scopedShots = targetShotIds.map((shotId, index) => ({
    ...normalizedWithAssets[index],
    shot_id: shotId,
    order: index + 1,
  }))

  return applyDeterministicDurations(scopedShots, timingOptions, 0)
}

function assertMandatoryUserUploadsPresent(
  shots: Shot[],
  mandatoryIds: string[],
  anchorAssetsJson: string,
): void {
  if (mandatoryIds.length === 0) {
    return
  }
  const directlyBound = new Set<string>()
  const boundAnchorIds = new Set<string>()
  for (const shot of shots) {
    for (const asset of shot.pre_selected_assets) {
      if (asset.source === 'user_upload') {
        directlyBound.add(asset.asset_id)
      } else {
        boundAnchorIds.add(asset.asset_id)
      }
    }
  }
  const sourcesByAnchorId = extractAnchorSourceAssetIdsByAnchorId(anchorAssetsJson)
  const consumedByBoundAnchor = new Set(
    [...boundAnchorIds].flatMap((anchorId) => [...(sourcesByAnchorId.get(anchorId) ?? [])]),
  )
  const missing = mandatoryIds.filter(
    (id) => !directlyBound.has(id) && !consumedByBoundAnchor.has(id),
  )
  if (missing.length > 0) {
    throw new Error(`mandatory user-upload bindings missing: ${missing.join(', ')}`)
  }
}

function assertRequiredFullScopeBeatSheet(input: {
  beatSheet: ReturnType<typeof parseFullScopeBeatSheet>
  fixedSegments: ScriptShotEdit[]
  isStructureMode: boolean
  params: PlannerToolParams
}): void {
  if (
    input.params.scope === 'FULL' &&
    !input.isStructureMode &&
    input.fixedSegments.length === 0 &&
    input.beatSheet.length === 0
  ) {
    throw new Error('FULL visual-script generation requires a non-empty beat sheet')
  }
}

function buildUserIntentNotes(directives: null | string[], latestUserMessage: string): string[] {
  const notes: string[] = []

  // `directives` are the user's positive hard requirements
  // (global_constraints.directives). They are also present in the
  // global_constraints JSON blob this prompt dumps, but we surface them
  // here as explicit notes so the VS LLM weights them as must-honor
  // intent rather than background context.
  for (const directive of directives ?? []) {
    const trimmed = directive.trim()
    if (trimmed) {
      notes.push(`Directive: ${trimmed}`)
    }
  }

  if (latestUserMessage.trim()) {
    notes.push(`LatestUserMessage: ${latestUserMessage.trim()}`)
  }

  return notes
}

function buildVisualScriptPromptForGeneration(params: {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  constraints: GlobalConstraints
  existingShotIds: string[]
  existingShots: Shot[]
  fixedSegments: ScriptShotEdit[]
  fullCoverage: boolean
  isStructureMode: boolean
  notes: string[]
  options: VisualScriptGenerationOptions
  params: PlannerToolParams
  parsedContext: ReturnType<typeof parseConversationContext>
  promptRoute: UipPromptRoute
  script: string
  structureEdit: null | PlannerStructureEdit
  targetShotIds: string[]
}): string {
  return buildUipVisualScriptPromptForScope({
    anchorAssetsJson: params.anchorAssetsJson,
    assetDescriptionsJson: params.assetDescriptionsJson,
    // The FULL scope section hard-asserts one shot per beat, shot_id ==
    // "shot_" + beat_id, and audio_vo verbatim from segment_text -- all
    // unsatisfiable against an empty sheet, so the model self-segments
    // coarsely, word-count timing stretches every shot, and center-to-center
    // transition slots overrun the model's recoverable cap.
    // Withheld when fixed segments are present: that contract IS the mandatory
    // segmentation and overrides only the audio-source rule, so a real sheet
    // would put "one shot per beat" against "one shot per fixed segment".
    beatSheetJson:
      params.fixedSegments.length === 0 ? params.options?.beatSheetJson?.trim() || '{}' : '{}',
    constraints: params.constraints,
    currentShotsJson: JSON.stringify(params.existingShots, null, 2),
    existingShots: params.existingShots,
    fixedSegmentsJson: JSON.stringify(params.fixedSegments, null, 2),
    fullCoverage: params.fullCoverage,
    hasFixedSegments: params.fixedSegments.length > 0,
    isStructureMode: params.isStructureMode,
    latestUserMessage: params.parsedContext.latestUserMessage,
    musicContextJson: params.options?.musicContextJson?.trim() || undefined,
    notes: params.notes,
    params: params.params,
    pinnedRawUserPrompt: params.parsedContext.pinnedRawUserPrompt,
    promptRoute: params.promptRoute,
    storyModeV3Enabled: params.options?.storyModeV3Enabled === true,
    rawUserPromptContext: params.parsedContext.recentConversationContext,
    script: params.script,
    structureEdit: params.structureEdit,
    targetShotIds: params.targetShotIds,
    totalShots: params.existingShotIds.length,
    transitionVideoModel: params.options?.transitionVideoModel,
    worldBibleJson: params.options?.worldBibleJson?.trim() || '{}',
  })
}

async function completeVisualScriptShots(params: {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  constraints: GlobalConstraints
  options: VisualScriptGenerationOptions
  params: PlannerToolParams
  prompt: string
  timeoutMs: number
}): Promise<GeneratedVisualScriptShot[]> {
  const completionBase = {
    ...(params.options.anchorImageContents?.length && {
      contents: params.options.anchorImageContents,
    }),
    models: VISUAL_SCRIPT_TOOL_MODELS,
    prompt: params.prompt,
    reasoningEffort: 'low' as const,
    task: 'user-intent-planner-generate_visual_script',
    temperature: params.params.edit_mode === 'EXACT' ? 0.1 : 0.3,
    timeout: params.timeoutMs,
  }

  return (
    await completion({
      ...completionBase,
      responseFormat: params.options.storyModeV3Enabled
        ? VisualScriptOutputSchemaV3
        : VisualScriptOutputSchema,
    })
  ).shots
}

function isFullScopeOrCoverage(
  params: PlannerToolParams,
  existingShotIds: string[],
  targetShotIds: string[],
): boolean {
  if (params.scope === 'FULL') {
    return true
  }
  if (existingShotIds.length === 0) {
    return false
  }

  const existing = new Set(existingShotIds)
  const target = new Set(targetShotIds)
  return target.size === existing.size && [...existing].every((shotId) => target.has(shotId))
}

function normalizePreSelectedAssets(
  assets: Array<{ asset_id: string; source: string; usage: string }>,
  allowedUserUploadAssetIds: string[],
  allowedAnchorAssetIds: string[],
  shotId: string,
): Shot['pre_selected_assets'] {
  const allowedUserUploads = new Set(allowedUserUploadAssetIds)
  const allowedAnchors = new Set(allowedAnchorAssetIds)
  const dropped: string[] = []
  const kept = assets
    .map((asset) => ({
      asset_id: asset.asset_id?.trim() ?? '',
      source:
        asset.source?.trim() === 'anchor_asset'
          ? ('anchor_asset' as const)
          : ('user_upload' as const),
      usage: asset.usage?.trim() || 'primary anchor',
    }))
    .filter((asset) => {
      if (!asset.asset_id) {
        return false
      }
      const allowed =
        asset.source === 'anchor_asset'
          ? allowedAnchors.has(asset.asset_id)
          : allowedUserUploads.has(asset.asset_id)
      if (!allowed) {
        dropped.push(`${asset.source}:${asset.asset_id}`)
      }
      return allowed
    })
    .map((asset) => ({
      asset_id: asset.asset_id,
      source: asset.source,
      usage: asset.usage,
    }))
  if (dropped.length > 0) {
    logger.warn(
      `[uip-visual-script] dropped unresolvable pre_selected_assets shot=${shotId} count=${dropped.length} ids=${dropped.join(',')}`,
    )
  }
  return kept
}

function nullLastShotHandOff(shots: Shot[]): void {
  const last = shots.at(-1)
  if (last && last.visual_primary.transition_to_next != null) {
    last.visual_primary = { ...last.visual_primary, transition_to_next: null }
  }
}

function parseExistingShots(existingShotsJson?: string): Shot[] {
  if (!existingShotsJson?.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(existingShotsJson) as Shot[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Report -- do not enforce -- the FULL-coverage contract.
 *
 * An earlier change made this a hard throw so a video could not silently ship missing
 * narration. The throw is classified retryable by the batch's rejected branch,
 * so a deterministic mismatch burned three full anchor-image generations and
 * then destroyed the project, and this was a common way for fast-path workflows
 * to fail. Few of those failures came from corrupt input this repo controls
 * (the chunker, since fixed); the rest are genuine beat-sheet drift, whose real
 * fix is replacing scanBeatTokens' positional lockstep with LCS alignment.
 *
 * Weighed against a rare cut-off transcript, killing projects every day is
 * the worse trade -- but shipping a video that drops
 * narration silently is exactly what the hard throw set out to stop, and nobody has
 * measured how large these mismatches actually are. So: log the delta instead
 * of throwing. The logs show whether these are 2-token
 * punctuation artefacts (in which case this guard wants a tolerance, not a
 * throw) or whole missing sentences (in which case the throw comes back once
 * the drift is fixed). Do not delete this log without that measurement.
 */
function reportFullVisualScriptCoverage(
  shots: Shot[],
  canonicalScript: string,
  textAudited: boolean,
): void {
  const narrationTokens = normalizeNarrationForCoverage(
    shots.map((shot) => shot.audio_vo).join(' '),
  ).split(' ')
  const scriptTokens = normalizeNarrationForCoverage(canonicalScript).split(' ')
  if (narrationTokens.join(' ') === scriptTokens.join(' ')) {
    return
  }

  let firstDivergenceAt = 0
  while (
    firstDivergenceAt < narrationTokens.length &&
    firstDivergenceAt < scriptTokens.length &&
    narrationTokens[firstDivergenceAt] === scriptTokens[firstDivergenceAt]
  ) {
    firstDivergenceAt += 1
  }

  // Multiset difference, so a pure reordering reads as 0 missing / 0 extra
  // while a dropped sentence reads as its own length. This is the number that
  // decides whether the guard should come back as a throw or as a tolerance.
  const remaining = new Map<string, number>()
  for (const token of scriptTokens) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1)
  }
  let extra = 0
  for (const token of narrationTokens) {
    const left = remaining.get(token) ?? 0
    if (left > 0) {
      remaining.set(token, left - 1)
    } else {
      extra += 1
    }
  }
  let missing = 0
  for (const left of remaining.values()) {
    missing += left
  }

  logger.warn(
    `[uip-visual-script] FULL coverage mismatch (non-fatal) ${formatLogFields({
      shots: shots.length,
      scriptTokens: scriptTokens.length,
      narrationTokens: narrationTokens.length,
      missing,
      extra,
      firstDivergenceAt,
      textAudited,
    })}`,
  )
}

function resolveTargetShotIds(params: PlannerToolParams, existingShotIds: string[]): string[] {
  if (params.scope === 'FULL') {
    return [...existingShotIds]
  }

  if (params.scope === 'SHOT_IDS') {
    return (params.shot_ids ?? []).filter((id) => existingShotIds.includes(id))
  }

  if (!params.from_shot_id || !params.to_shot_id) {
    return []
  }

  const fromIndex = existingShotIds.indexOf(params.from_shot_id)
  const toIndex = existingShotIds.indexOf(params.to_shot_id)
  if (fromIndex === -1 || toIndex === -1) {
    return []
  }

  const start = Math.min(fromIndex, toIndex)
  const end = Math.max(fromIndex, toIndex)
  return existingShotIds.slice(start, end + 1)
}

/**
 * Rough shot-count estimate from script word count. Used only to scale
 * the per-call LLM timeout; the actual shot count comes from the LLM
 * output. Assumes ~15 words per shot (active pacing, 6s at 150 WPM).
 *
 * Exported for unit tests.
 */
export function estimateShotCountFromScript(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) {
    return 0
  }
  const WORDS_PER_SHOT_ESTIMATE = 15
  return Math.max(1, Math.ceil(words / WORDS_PER_SHOT_ESTIMATE))
}

/**
 * Per-call LLM timeout (ms) for the visual-script tool. Scales with the
 * estimated shot count -- each shot emits ~30-50 tokens of structured
 * JSON, and the LLM also pays a global reasoning cost before emitting
 * any shot. Clamped to [90s, 480s] so a tiny video still gets the old
 * baseline and a malformed/extreme overshoot can't run forever.
 *
 * Empirical observations on the slow tail across gemini-3.1-pro and
 * gpt-5.4:
 *  -  15 shots (~1 min video) ->  90s (baseline)
 *  -  50 shots (~5 min video) -> 210s
 *  - 100 shots (~10 min video) -> 360s
 *  - 150 shots                 -> 480s (ceiling)
 *
 * Exported for unit tests.
 */
export function computeVisualScriptTimeoutMs(estimatedShotCount: number): number {
  const BASE_SECONDS = 60
  const SECONDS_PER_SHOT = 3
  const MIN_SECONDS = 90
  const MAX_SECONDS = 480
  const positive = Math.max(0, estimatedShotCount || 0)
  const raw = BASE_SECONDS + positive * SECONDS_PER_SHOT
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, raw))
  return Math.round(seconds) * 1000
}
