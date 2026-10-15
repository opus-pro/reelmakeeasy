import { createHash } from 'node:crypto'

import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import {
  type ShotPlanCoverageInput,
  validateShotPlanTranscriptCoverage,
} from '@reelmakeeasy/common/long-take/shot-plan-coverage'
import { normalizeStyleInstruction } from '@reelmakeeasy/common/uip/normalization'
import { runSubstep, type SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS } from '../model-config'
import {
  loadPlannerJsonArtifact,
  loadProjectJsonArtifact,
  persistPlannerJsonArtifact,
} from '../persistence'
import {
  SharedArtifactBatchContext,
  withSharedArtifactResult,
} from '../runtime/shared-artifact-batch-context'
import {
  type GlobalConstraints,
  type ScriptShotEdit,
  type SessionState,
  type UipPromptRoute,
} from '../types'
import { countWords } from '../word-budget'

import {
  resolveBeatSheetMaxDurationSeconds,
  resolveFixedSegmentWordEnvelope,
} from './beat-sheet-model-limits'
import { generatePlainTextBeatSheet } from './beat-sheet-plain-text'
import { shotsCoverCanonicalScript } from './beat-sheet-script-coverage'
import { generateTimestampedBeatSheet } from './beat-sheet-timestamped'
import {
  LongTakeBeatSheetModelOutputSchema,
  type LongTakeBeatSheetOutput,
} from './visual-script-beat-sheet-schema'
import { buildWorldBibleExpertPrompt } from './world-bible-expert-prompt'

export { ensureTranscriptWords } from './beat-sheet-timestamped'

const logger = createSubLogger('uip-planner-runtime:world-bible')
const UIP_INTERNAL_FILES_DIR = 'internal_files'
const LONG_TAKE_WORLD_BIBLE_PATH = `${UIP_INTERNAL_FILES_DIR}/world_bible.json`
const UIP_WORLD_BIBLE_META_PATH = `${UIP_INTERNAL_FILES_DIR}/world_bible.meta.json`
const LONG_TAKE_MUSIC_BEAT_SHEET_PATH = 'long_take/experts/beat_sheet.json'
const LONG_TAKE_MUSIC_CONTEXT_PATH = 'long_take/experts/music_context.json'

// World-bible cache contract:
//   1. Same-batch dedupe: `withSharedArtifactResult` ensures a single
//      in-flight LLM call is awaited by all concurrent same-batch callers
//      (anchor + VS tools both call `ensureWorldBible`). UIP world-bible
//      generation intentionally uses the classic general prompt for every
//      route, so the shared key is route-agnostic but still input-sensitive.
//   2. Cross-batch dedupe: `ensureWorldBibleInternal` reads the persisted
//      JSON artifact first and reuses it whenever it exists and the prompt
//      route matches, UNLESS the planner forced a refresh
//      (`refresh_world_bible`). Script/style hashes are NOT compared: the canon
//      is robust to local script wording edits, and UIP style is immutable.
//
// Beat-sheet has NO cache. `ensureBeatSheet` is now explicit-only:
//   - bootstrap_visual (shots empty) OR `refreshBeatSheet === true`: invoke
//     beat-sheet expert (LLM)
//   - refinement with shots present and `refreshBeatSheet !== true`:
//     synthesize a 1:1 beat-sheet from existing shots (no LLM)
// The planner explicitly emits `refresh_beat_sheet=true` when the user asks
// for re-segmentation; otherwise existing shots ARE the beat-sheet, so a
// persistent cache layer would be redundant.

type WorldBibleArtifactMeta = {
  prompt_route?: UipPromptRoute
  script_hash: string
  /**
   * `true` on a canon built with the scoped ID LOCK clause in the
   * world-bible prompt. Such a canon is never reused: the prompt now always
   * uses the legacy clause. Absent (or `false`) on every other artifact.
   */
  setting_intent_enabled?: boolean
  style_hash: string
}

const UIP_WORLD_BIBLE_PROMPT_ROUTE: UipPromptRoute = 'general'

// The LLM emits ONLY `creative_guardrails` inside global_context (plus the
// world/visual fields below). The 8 duplicated global_context fields
// (brand_scope / geo_scope / key_entities / script_category / time_scope /
// tone / topic / video_type) are NOT re-derived by the model -- they are the
// single-source-of-truth `global_constraints` (from generate_intent_context)
// and are populated in code by `normalizeLongTakeWorldBibleOutput`. This
// shrinks the world-bible output and removes the source-of-truth divergence.
const LongTakeWorldBibleModelOutputSchema = z.object({
  global_context: z
    .object({
      creative_guardrails: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  thematic_core: z.string(),
  visual_strategy: z.object({
    asset_harmonization: z.string().default(''),
    cinematic_sandbox: z.string().default(''),
    evolution_arc: z.string().default(''),
    resource_scope: z
      .object({
        essential_b_roll: z.array(z.string()).default([]),
        primary_stages: z.array(z.string()).default([]),
      })
      .default({}),
  }),
  world_physics: z
    .object({
      global_motion_paradigm: z
        .object({
          base_momentum: z.string().default(''),
          dominant_movement_axis: z.string().default(''),
        })
        .default({}),
    })
    .default({}),
})

type LongTakeWorldBibleModelOutput = z.infer<typeof LongTakeWorldBibleModelOutputSchema>

type LongTakeWorldBibleOutput = {
  global_context?: {
    brand_scope?: string
    creative_guardrails: string[]
    geo_scope?: string
    key_entities?: string[]
    script_category: 'brand_lifestyle' | 'concept_centric' | 'object_centric'
    time_scope?: string
    tone?: string
    topic?: string
    video_type?: string
  }
  thematic_core: string
  visual_strategy: {
    asset_harmonization: string
    cinematic_sandbox: string
    evolution_arc: string
    resource_scope: {
      essential_b_roll: string[]
      primary_stages: string[]
    }
  }
  world_physics: {
    global_motion_paradigm: {
      base_momentum: string
      dominant_movement_axis: string
    }
  }
}

type MusicBeatSheetPreviewLoadResult =
  | { beatSheet: LongTakeBeatSheetOutput; status: 'ready' }
  | { reason: string; status: 'not_ready' }

// Beat-sheet has no cache layer. The planner-driven `refreshBeatSheet`
// flag (plus the existence of shots) determines whether to invoke the
// expert LLM or to synthesize a 1:1 beat-sheet from existing shots. Single
// caller in the codebase, so `withSharedArtifactResult` would be dead
// concurrency infra; we don't wrap.
export async function ensureBeatSheet(
  session: SessionState,
  script: string,
  refreshBeatSheet: boolean,
  promptRoute: UipPromptRoute = 'general',
  // Pre-resolved user fixed segments (the VS tool resolves once and threads them
  // so the 1:1 beat sheet and the fixed-segment lock stay identical). When
  // undefined (direct callers / tests), this resolves them itself.
  fixedSegmentEdits?: ScriptShotEdit[],
): Promise<LongTakeBeatSheetOutput> {
  return ensureBeatSheetInternal(session, script, refreshBeatSheet, promptRoute, fixedSegmentEdits)
}

export async function ensureFullScopeStoryArtifacts(params: {
  assetDescriptionsJson: string
  // Pre-resolved user fixed segments, threaded from the VS tool so the beat
  // sheet and the fixed-segment lock derive from one resolution.
  fixedSegmentEdits?: ScriptShotEdit[]
  // Planner-driven world-bible force-refresh (from `refresh_world_bible`).
  // Forwarded as `forceRefresh` to `ensureWorldBible`; false / undefined =>
  // reuse the persisted world-bible artifact when present.
  forceWorldBibleRefresh?: boolean
  promptRoute: UipPromptRoute
  refreshBeatSheet: boolean
  // Optional UIP-v2 substep progress reporter. When present, the beat-sheet and
  // world-bible arms report running/completed for the subTools display; absent
  // (direct callers / tests) = no reporting, no behavioral change.
  reportSubstep?: SubstepReporter
  script: string
  session: SessionState
  // For the world-bible dedupe only (genuinely shared across the anchor + VS tools).
  sharedBatchContext?: null | SharedArtifactBatchContext
}): Promise<{
  beatSheet: LongTakeBeatSheetOutput
  musicContextJson?: string
  worldBible: LongTakeWorldBibleOutput
}> {
  const [beatSheet, worldBible] = await Promise.all([
    runSubstep(params.reportSubstep, 'beat_sheet', () =>
      ensureBeatSheet(
        params.session,
        params.script,
        params.refreshBeatSheet,
        params.promptRoute,
        params.fixedSegmentEdits,
      ),
    ),
    runSubstep(params.reportSubstep, 'world_bible', () =>
      ensureWorldBible({
        session: params.session,
        script: params.script,
        assetDescriptionsJson: params.assetDescriptionsJson,
        forceRefresh: params.forceWorldBibleRefresh,
        promptRoute: params.promptRoute,
        sharedBatchContext: params.sharedBatchContext,
      }),
    ),
  ])
  const musicContextJson = await loadMusicContextJsonForPreview(params.session, params.promptRoute)

  return { beatSheet, musicContextJson, worldBible }
}

export async function ensureWorldBible(params: {
  assetDescriptionsJson: string
  // Planner-explicit force-refresh. The VS tool passes
  // `refresh_world_bible === true`; the anchor tool never sets it. When
  // (either directly or via the batch context) true, regenerate the canon
  // instead of reusing the persisted artifact.
  forceRefresh?: boolean
  // Accepted for call-site compatibility. UIP world bible always uses the
  // shared classic general prompt; downstream route-specific behavior starts
  // at beat sheet / visual script / anchors instead.
  promptRoute?: UipPromptRoute
  script: string
  session: SessionState
  sharedBatchContext?: null | SharedArtifactBatchContext
}): Promise<LongTakeWorldBibleOutput> {
  const scriptHash = hashText(params.script)
  const styleHash = hashText(getEffectiveStyleText(params.session))
  // The VS arm owns the flag; the batch seeds `forceWorldBibleRefresh` so
  // whichever arm reaches world-bible first honors it (the other reuses the
  // shared result). Anchor-only calls pass neither, so they stay reuse-or-build.
  const forceRefresh =
    params.forceRefresh === true || params.sharedBatchContext?.forceWorldBibleRefresh === true

  return withSharedArtifactResult(
    params.sharedBatchContext ?? null,
    worldBibleBatchKey(scriptHash, styleHash),
    () =>
      ensureWorldBibleInternal({
        ...params,
        forceRefresh,
        promptRoute: UIP_WORLD_BIBLE_PROMPT_ROUTE,
      }),
  )
}

export function getEffectiveStyleText(session: SessionState): string {
  const fromSpec = normalizeStyleInstruction(session.spec.global_constraints.style)
  if (fromSpec) {
    return fromSpec
  }
  return normalizeStyleInstruction(session.bootstrap.seed_style_instruction)
}

function buildWorldBibleAssetContext(assetDescriptionsJson: string): {
  characters: unknown[]
  files: unknown[]
  objects: unknown[]
} {
  const parsed = safeJsonParse<{ items?: Array<{ asset_id?: string; summary?: string }> }>(
    assetDescriptionsJson,
  )
  const files =
    parsed?.items?.map((item) => ({
      asset_id: item.asset_id ?? '',
      summary: item.summary ?? '',
    })) ?? []

  return {
    characters: [],
    objects: files,
    files,
  }
}

async function ensureBeatSheetInternal(
  session: SessionState,
  script: string,
  refreshBeatSheet: boolean,
  promptRoute: UipPromptRoute,
  fixedSegmentEdits?: ScriptShotEdit[],
): Promise<LongTakeBeatSheetOutput> {
  const edits = fixedSegmentEdits ?? (await resolveFixedSegmentEditsFromWorkingScript(session))
  if (edits.length > 0) {
    return {
      beat_sheet: edits.map((edit, index) => ({
        beat_id: index + 1,
        segment_text: edit.audio_vo,
      })),
      text_audited: true,
    }
  }

  // Refinement reuse path: existing shots already represent a valid
  // segmentation. Skip the LLM and synthesize a 1:1 beat-sheet from them.
  // This branch fires when the planner did NOT request a re-segment AND
  // we already have shots in spec (refinement after bootstrap_visual).
  const existingShots = session.spec.visual_script.shots
  if (!refreshBeatSheet && existingShots.length > 0) {
    // Gated music refinements must stay beat-locked. Bootstrap cuts these shots on the musical
    // beat grid; a text_audited synthesized sheet drops the beat-lock, so downstream normalization
    // re-times the beats by word count and (for instrumental beats) never re-stamps
    // is_instrumental -- silently breaking beat-grid sync and the silent-shot validator exemption
    // on every visual edit after the first generation. Gate on the same condition
    // bootstrap uses to load the beat-locked music sheet (loadMusicBeatSheetForPreview) so
    // lyric-only music videos stay locked too.
    const preserveBeatLock =
      promptRoute === 'music' && session.spec.meta.music_video_improvement_enabled === true
    // Reuse is only valid while the existing shots still span the script. Once they fall short,
    // the synthesized sheet inherits that shortfall, the next pass is capped back to it beat for
    // beat, and the uncovered tail collapses into one transition slot no video model can generate
    // -- so the project fails before generation and every retry reproduces it.
    // Beat-locked music sheets carry instrumental beats with no narration, so narration coverage
    // is not their invariant.
    if (preserveBeatLock || shotsCoverCanonicalScript(existingShots, script)) {
      return synthesizeBeatSheetFromShots(existingShots, { preserveBeatLock })
    }
    logger.warn(
      `[uip-beat-sheet] existing shots no longer cover the script; re-segmenting projectId=${session.sessionId} shotCount=${existingShots.length}`,
    )
  }

  // Real beat-sheet expert call. Either bootstrap_visual (shots still
  // empty) or planner explicitly requested re-segmentation
  // (`refresh_beat_sheet=true`).
  //
  // pacing drives the "Shot Length Distribution Guideline" block inside
  // both expert prompts. The selected transition video model controls
  // whether the hard upper bound is 10s or 30s. `null` pacing falls back
  // to the active default inside the prompt renderer.
  const pacing = session.spec.global_constraints.pacing
  const latestUserMessage = extractLatestUserMessageForBeatSheet(session)

  if (session.spec.meta.audio_source === 'user_audio') {
    // Music sessions: prefer the beat-grid-derived music beat sheet that the pre-voiceover
    // workflow lands at the shared long_take path. Its cut points sit on musical
    // beats and cover the full track (instrumental intro/interlude beats carry an empty
    // segment_text), so the spec preview timing matches the music. For the music route, wait for
    // that sheet instead of falling back to ASR-word timing; otherwise instrumental intros can be
    // dropped and the storyboard can start at the first lyric timestamp.
    const musicBeatSheet = await loadMusicBeatSheetForPreview(session, promptRoute)
    if (musicBeatSheet) {
      return musicBeatSheet
    }
    return generateTimestampedBeatSheet(session, { latestUserMessage, pacing, promptRoute })
  }
  return generatePlainTextBeatSheet({
    latestUserMessage,
    modelSelectorTier: session.modelSelectorTier,
    pacing,
    promptRoute,
    projectId: session.sessionId,
    sessionId: session.sessionId,
    script: script.trim(),
    transitionVideoModel: session.transitionVideoModel,
  })
}

// Load the music beat sheet written by the pre-voiceover music pre-analysis. For non-music
// routes this returns null so the caller can use the normal ASR-word timing path.
//
// Readiness is event-driven, not polled. MusicPreAnalysisWorkflow signals the UIP v2
// parent on completion; the parent folds the outcome onto spec.meta.music_beat_sheet_status and a
// system-owned phase gate holds bootstrap_visual until it resolves -- so by the time this tool
// runs the status is settled and the sheet (if ready) is already in storage. We therefore read once
// instead of sleep-polling a tool activity open for up to 120s:
//   - `unavailable` (analysis OOM / not music): confirmed failure -> fall back to ASR-word timing
//     (non-fatal). Honors the spirit -- degrade only on a CONFIRMED failure, never
//     preemptively while pending (the gate guarantees we are never called while pending).
//   - `ready`, or status absent (a pre-patch in-flight session whose workflow predates the gate
//     and never signalled): read the persisted sheet directly. Pre-voiceover lands it well before
//     bootstrap_visual, so it is normally present; if it is missing we fall back to ASR-word
//     timing rather than hanging or throwing.
//
// Gating on the effective prompt route (not mode_state.input_type) keeps the preview aligned
// with the downstream music pipeline. The route covers both music signals: input_type ===
// 'audio_music' (filename/brief anchor) and the transcript-based classifier hearing lyrics in an
// 'audio_script' upload. It also excludes ineligible ads sessions that the route downgrades to
// 'general', which input_type alone would wrongly beat-lock.
async function loadMusicBeatSheetForPreview(
  session: SessionState,
  promptRoute: UipPromptRoute,
): Promise<LongTakeBeatSheetOutput | null> {
  const meta = session.spec.meta
  if (promptRoute !== 'music' || meta.music_video_improvement_enabled !== true) {
    return null
  }
  if (meta.music_beat_sheet_status === 'unavailable') {
    return null
  }
  const result = await readMusicBeatSheetForPreview(session)
  if (result.status === 'ready') {
    return result.beatSheet
  }
  logger.warn(
    `[music-beat-sheet] music sheet not loadable for preview, falling back to ASR-word timing ${JSON.stringify(
      { reason: result.reason, status: meta.music_beat_sheet_status ?? 'absent' },
    )}`,
  )
  return null
}

async function loadMusicContextJsonForPreview(
  session: SessionState,
  promptRoute: UipPromptRoute,
): Promise<string | undefined> {
  const meta = session.spec.meta
  if (promptRoute !== 'music' || meta.music_video_improvement_enabled !== true) {
    return undefined
  }
  const payload = await loadProjectJsonArtifact<unknown>(
    session.sessionId,
    LONG_TAKE_MUSIC_CONTEXT_PATH,
  )
  if (!payload || typeof payload !== 'object') {
    return undefined
  }
  return JSON.stringify(payload, null, 2)
}

async function readMusicBeatSheetForPreview(
  session: SessionState,
): Promise<MusicBeatSheetPreviewLoadResult> {
  const payload = await loadProjectJsonArtifact<unknown>(
    session.sessionId,
    LONG_TAKE_MUSIC_BEAT_SHEET_PATH,
  )
  if (!payload || typeof payload !== 'object') {
    return { reason: 'artifact missing', status: 'not_ready' }
  }
  const flags = payload as { text_audited?: unknown; time_range_audited?: unknown }
  if (flags.time_range_audited !== true || flags.text_audited === true) {
    return { reason: 'artifact is not a music time-range-audited sheet', status: 'not_ready' }
  }
  const parsed = LongTakeBeatSheetModelOutputSchema.safeParse(payload)
  if (!parsed.success) {
    return { reason: 'artifact failed beat-sheet schema validation', status: 'not_ready' }
  }
  const beats = parsed.data.beat_sheet
  const timedBeats = beats.flatMap((beat) =>
    beat.time_range ? [{ ...beat, time_range: beat.time_range }] : [],
  )
  if (beats.length === 0 || timedBeats.length !== beats.length) {
    return { reason: 'artifact has missing beat time ranges', status: 'not_ready' }
  }
  return {
    beatSheet: {
      beat_sheet: timedBeats.map((beat, index) => ({
        beat_id: index + 1,
        duration: beat.duration ?? beat.time_range.end - beat.time_range.start,
        segment_text: beat.segment_text,
        time_range: beat.time_range,
        visual_mode_hint: beat.visual_mode_hint ?? null,
      })),
      text_audited: false,
      time_range_audited: true,
    },
    status: 'ready',
  }
}

/**
 * Synthesize a 1:1 beat-sheet from existing shots. Used when the planner
 * does not request a re-segmentation: the existing shots' boundaries ARE
 * the beat-sheet, so we materialize them into the schema beat-sheet
 * consumers expect (VS tool prompt, downstream renderers, etc.).
 *
 * Pure function. The output is treated as both text- and time-audited
 * because it comes from the canonical spec, not an LLM.
 */
export function synthesizeBeatSheetFromShots(
  shots: SessionState['spec']['visual_script']['shots'],
  options?: { preserveBeatLock?: boolean },
): LongTakeBeatSheetOutput {
  const sortedShots = [...shots].sort((a, b) => a.order - b.order)
  return {
    beat_sheet: sortedShots.map((shot) => ({
      beat_id: shot.order,
      segment_text: shot.audio_vo,
      time_range: { start: shot.time.start_s, end: shot.time.end_s },
      duration: shot.time.end_s - shot.time.start_s,
    })),
    // Music (beat-locked) refinements keep text_audited=false so downstream normalization stays
    // on the beat grid (no word-count re-timing) and re-stamps is_instrumental on empty
    // instrumental beats. Non-music refinements keep canonical-text semantics (text_audited=true).
    text_audited: options?.preserveBeatLock ? false : true,
    time_range_audited: true,
  }
}

/**
 * Pull the most recent user-typed message off the transcript so the
 * beat-sheet expert can see segmentation feedback ("more shots", "tighter
 * cuts") in refinement. Returns undefined in non-refinement phases (the
 * brief is already absorbed by the script tool, beat-sheet doesn't need
 * to re-read it) or when the only user-role entry is a synthetic marker
 * (`__cta_continue_uip_draft__` etc., prefix-filtered).
 */
async function ensureWorldBibleInternal(params: {
  assetDescriptionsJson: string
  forceRefresh: boolean
  promptRoute: UipPromptRoute
  script: string
  session: SessionState
}): Promise<LongTakeWorldBibleOutput> {
  const promptRoute = params.promptRoute
  const effectiveStyleText = getEffectiveStyleText(params.session)
  const scriptHash = hashText(params.script)
  const styleHash = hashText(effectiveStyleText)
  const globalConstraints = params.session.spec.global_constraints
  const meta = await loadPlannerJsonArtifact<WorldBibleArtifactMeta>(
    params.session.sessionId,
    UIP_WORLD_BIBLE_META_PATH,
  )
  const existing = await loadPlannerJsonArtifact<LongTakeWorldBibleOutput>(
    params.session.sessionId,
    LONG_TAKE_WORLD_BIBLE_PATH,
  )

  // Reuse the persisted canon whenever it exists and the route matches, unless
  // the planner forced a refresh. We intentionally DROP the script_hash + the
  // style_hash comparisons: the canon is robust to local script wording tweaks
  // (a material topic/canon change flows through `refresh_world_bible`), and
  // UIP style is immutable so the style hash never diverges.
  if (
    existing &&
    meta &&
    (meta.prompt_route ?? 'general') === promptRoute &&
    meta.setting_intent_enabled !== true &&
    !params.forceRefresh
  ) {
    return existing
  }

  const prompt = buildWorldBibleExpertPrompt({
    globalConstraints,
    promptRoute,
    script: params.script,
    transitionVideoModel: params.session.transitionVideoModel,
    userSimulationParameters: effectiveStyleText || undefined,
    userAssetContext: buildWorldBibleAssetContext(params.assetDescriptionsJson),
  })
  logger.info(
    `[uip-world-bible] start sessionId=${params.session.sessionId} promptChars=${prompt.length}`,
  )
  const startedAt = Date.now()
  const modelOutput = await completion({
    models: PLANNER_TOOL_MODELS,
    prompt,
    responseFormat: LongTakeWorldBibleModelOutputSchema,
    reasoningEffort: 'low',
    task: 'user-intent-planner-world-bible',
    temperature: 0.1,
    timeout: 60_000,
  })
  logger.info(
    `[uip-world-bible] done durationMs=${Date.now() - startedAt} sessionId=${params.session.sessionId}`,
  )
  const normalized = normalizeLongTakeWorldBibleOutput({ globalConstraints, modelOutput })

  await persistPlannerJsonArtifact(params.session.sessionId, LONG_TAKE_WORLD_BIBLE_PATH, normalized)
  await persistPlannerJsonArtifact(params.session.sessionId, UIP_WORLD_BIBLE_META_PATH, {
    prompt_route: promptRoute,
    script_hash: scriptHash,
    style_hash: styleHash,
  } satisfies WorldBibleArtifactMeta)

  return normalized
}

function extractLatestUserMessageForBeatSheet(session: SessionState): string | undefined {
  if (session.todo_state.phase !== 'refinement') {
    return undefined
  }
  const transcript = session.transcript ?? []
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i]
    if (entry.role !== 'user') {
      continue
    }
    const content = entry.content?.trim()
    if (!content || content.startsWith('__')) {
      continue
    }
    return content
  }
  return undefined
}

function hashText(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex')
}

function normalizeLongTakeWorldBibleOutput(params: {
  globalConstraints: GlobalConstraints
  modelOutput: LongTakeWorldBibleModelOutput
}): LongTakeWorldBibleOutput {
  const output = params.modelOutput
  const gc = params.globalConstraints
  return {
    // The 8 duplicated fields come from `global_constraints` (single source of
    // truth), NOT the world-bible LLM. Only `creative_guardrails` is
    // bible-authored. Downstream (story-mode BGM / keyframe) reads
    // `global_context`, so it must stay fully populated.
    global_context: {
      brand_scope: normalizeRequiredText(gc.brand_scope),
      creative_guardrails: uniqueStrings(output.global_context?.creative_guardrails ?? []),
      geo_scope: normalizeRequiredText(gc.geo_scope),
      key_entities: uniqueStrings(gc.key_entities ?? []),
      script_category: gc.script_category ?? 'concept_centric',
      time_scope: normalizeRequiredText(gc.time_scope),
      tone: normalizeRequiredText(gc.tone),
      topic: normalizeRequiredText(gc.topic),
      video_type: normalizeRequiredText(gc.video_type),
    },
    thematic_core: normalizeRequiredText(output.thematic_core),
    visual_strategy: {
      asset_harmonization: normalizeRequiredText(output.visual_strategy.asset_harmonization),
      cinematic_sandbox: normalizeRequiredText(output.visual_strategy.cinematic_sandbox),
      evolution_arc: normalizeRequiredText(output.visual_strategy.evolution_arc),
      resource_scope: {
        essential_b_roll: uniqueStrings(
          output.visual_strategy.resource_scope?.essential_b_roll ?? [],
        ),
        primary_stages: uniqueStrings(output.visual_strategy.resource_scope?.primary_stages ?? []),
      },
    },
    world_physics: {
      global_motion_paradigm: {
        base_momentum: normalizeRequiredText(
          output.world_physics?.global_motion_paradigm?.base_momentum ?? '',
        ),
        dominant_movement_axis: normalizeRequiredText(
          output.world_physics?.global_motion_paradigm?.dominant_movement_axis ?? '',
        ),
      },
    },
  }
}

function normalizeRequiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function worldBibleBatchKey(scriptHash: string, styleHash: string): string {
  return `world_bible::${UIP_WORLD_BIBLE_PROMPT_ROUTE}::${scriptHash}::${styleHash}`
}

/**
 * Word-count envelope for user-provided fixed segments. Mirrors the
 * model-agnostic beat-sheet duration limit: the classic 5-25 words
 * (~2-10s at 150 WPM).
 * Fixed-segment repair keeps compliant user cuts verbatim and locally re-cuts only the
 * violating ones, instead of discarding the entire user segmentation (the
 * legacy behavior, still reachable via the UIP_FIXED_SEGMENT_REPAIR=off
 * kill-switch).
 */
// Estimate script speech duration from word count using a typical TTS rate
// of ~2.5 words/second (150 wpm). The validator at @reelmakeeasy/common/long-take/
// shot-plan-coverage applies its own short-video bypass at 120s, so any
// script <300 words estimates to <120s and passes through automatically.
const WORDS_PER_SECOND_ESTIMATE = 2.5

// Instruction injected into the beat-sheet expert's advisory slot when
// re-cutting a single violating span, so it preserves the surrounding (frozen)
// user boundaries and changes as little as possible.
type FixedSegmentClass = 'ok' | 'over' | 'under'

function buildScopedRecutNote(): string {
  const maxDurationSeconds = resolveBeatSheetMaxDurationSeconds()
  const { maxWords, minWords } = resolveFixedSegmentWordEnvelope()
  return (
    'You are re-cutting ONLY this excerpt of a longer script; the shots before and ' +
    'after it are already locked and must not change. Re-cut this excerpt into the ' +
    `fewest valid shots (${minWords}-${maxWords} words / 2-${maxDurationSeconds}s each). Make the MINIMAL change: if a part ` +
    'is too short, prefer merging it into ONE adjacent side rather than disturbing ' +
    'both; if too long, split at the cleanest clause boundary. Reproduce the words ' +
    'verbatim and in order -- do not paraphrase.'
  )
}

// Fixed-segment repair kill-switch. Default ENABLED (local repair); set
// UIP_FIXED_SEGMENT_REPAIR=off to revert to the legacy all-or-nothing discard.
// Feature gates can't be read inside this runtime lib (gates are pinned onto the
// spec at session creation), so a per-user %-ramp would need API-side pinning.
function classifyFixedSegment(segment: string): FixedSegmentClass {
  const words = countWords(segment)
  const { minWords, maxWords } = resolveFixedSegmentWordEnvelope()
  if (words < minWords) {
    return 'under'
  }
  if (words > maxWords) {
    return 'over'
  }
  return 'ok'
}

function isFixedSegmentRepairEnabled(): boolean {
  return process.env['UIP_FIXED_SEGMENT_REPAIR']?.toLowerCase() !== 'off'
}

function isInWordEnvelope(segment: string): boolean {
  const words = countWords(segment)
  const { minWords, maxWords } = resolveFixedSegmentWordEnvelope()
  return words >= minWords && words <= maxWords
}

/**
 * Minimal editable spans (inclusive index ranges) over the user segments: an
 * over-cap segment is re-cut in place (`{i}`); an under-cap segment needs
 * neighbor material to merge into (`{i-1, i, i+1}`). Overlapping/adjacent spans
 * are coalesced so a shared boundary is only re-cut once. OK segments outside
 * every span are frozen verbatim.
 */
function computeEditableSpans(classes: FixedSegmentClass[]): Array<{ hi: number; lo: number }> {
  const n = classes.length
  const raw: Array<{ hi: number; lo: number }> = []
  classes.forEach((cls, i) => {
    if (cls === 'over') {
      raw.push({ hi: i, lo: i })
    } else if (cls === 'under') {
      raw.push({ hi: Math.min(n - 1, i + 1), lo: Math.max(0, i - 1) })
    }
  })
  raw.sort((a, b) => a.lo - b.lo)
  const merged: Array<{ hi: number; lo: number }> = []
  for (const span of raw) {
    const last = merged[merged.length - 1]
    if (last && span.lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, span.hi)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/**
 * Re-cut one violating span with the beat-sheet expert (LLM, not a mechanical
 * word splitter), reusing the plain-text pipeline (audit loop + deterministic
 * splitter fallback). Returns the re-cut pieces, or the original span text as a
 * single piece if the LLM fails -- best-effort, never drop the user's words.
 */
async function recutFixedSegmentSpan(session: SessionState, spanText: string): Promise<string[]> {
  try {
    const output = await generatePlainTextBeatSheet({
      latestUserMessage: buildScopedRecutNote(),
      modelSelectorTier: session.modelSelectorTier,
      pacing: session.spec.global_constraints.pacing ?? null,
      projectId: session.sessionId,
      sessionId: session.sessionId,
      promptRoute: 'general',
      script: spanText,
      transitionVideoModel: session.transitionVideoModel,
    })
    const pieces = output.beat_sheet.map((beat) => beat.segment_text.trim()).filter(Boolean)
    // Verbatim guard: only accept the re-cut if it reproduces the span's words
    // exactly (whitespace-normalized, matching the downstream byte-equality
    // check). The audit usually enforces this, but on the severe-drift fallback
    // path the LLM text can paraphrase/drop words -- in that case keep the user's
    // original span verbatim rather than shipping altered narration.
    const normalize = (text: string) => text.trim().replace(/\s+/g, ' ')
    if (pieces.length > 0 && normalize(pieces.join(' ')) === normalize(spanText)) {
      return pieces
    }
    return [spanText]
  } catch (error) {
    // Log only the error name -- a raw provider/pipeline message can carry
    // prompt/request fragments (CWE-532).
    logger.warn(
      `[uip] Fixed-segment span re-cut failed, keeping span as-is (best-effort) sessionId=${session.sessionId} errorName=${error instanceof Error ? error.name : 'UnknownError'}`,
    )
    return [spanText]
  }
}

/**
 * Shot-plan coverage guard. Returns true when coverage FAILS (caller discards +
 * falls back) and emits the discard metric. Duration is estimated from the FULL
 * script word count (no ASR needed); the validator bypasses <120s scripts.
 */
// Resolve (and locally repair) the user's pre-segmentation into the final shot
// edits. The LLM re-cut here is non-deterministic, so the VS tool resolves this
// ONCE and threads the result to both consumers (the 1:1 beat sheet + the
// fixed-segment lock) -- see runGenerateVisualScriptTool -- rather than calling
// it twice.
export async function resolveFixedSegmentEditsFromWorkingScript(
  session: SessionState,
): Promise<ScriptShotEdit[]> {
  const artifact = session.cached_artifacts.working_script
  if (
    !artifact ||
    artifact.scope.scope !== 'FULL' ||
    artifact.pending_vs_apply !== true ||
    !artifact.shot_edits?.length
  ) {
    return []
  }
  const segmentEdits = artifact.shot_edits.map((edit) => ({
    audio_vo: edit.audio_vo.trim(),
    shot_id: edit.shot_id,
  }))
  return resolveFixedSegmentEditsInner(session, segmentEdits, artifact.script ?? '')
}

function fixedSegmentsFailCoverage(
  session: SessionState,
  segments: string[],
  scriptText: string,
): boolean {
  const estimatedTotalDurationSec = countWords(scriptText) / WORDS_PER_SECOND_ESTIMATE
  const syntheticShotPlan = synthesizeShotPlanFromSegments(segments, estimatedTotalDurationSec)
  const validation = validateShotPlanTranscriptCoverage(
    syntheticShotPlan,
    estimatedTotalDurationSec,
  )
  if (validation.ok) {
    return false
  }
  logger.warn(
    `[uip] Discarding user-provided fixed segments (shot-plan coverage violation) sessionId=${session.sessionId} reasons=${JSON.stringify(validation.reasons)} metrics=${JSON.stringify(validation.metrics)}`,
  )
  return true
}

async function resolveFixedSegmentEditsInner(
  session: SessionState,
  segmentEdits: ScriptShotEdit[],
  scriptText: string,
): Promise<ScriptShotEdit[]> {
  const segments = segmentEdits.map((edit) => edit.audio_vo)
  const classes = segments.map((segment) => classifyFixedSegment(segment))

  if (!isFixedSegmentRepairEnabled()) {
    return legacyResolveFixedSegments(session, segmentEdits, segments, scriptText)
  }

  // Fast path: every user segment already valid -- honor 1:1 (coverage guard
  // still applies, mirroring legacy).
  if (classes.every((cls) => cls === 'ok')) {
    if (fixedSegmentsFailCoverage(session, segments, scriptText)) {
      return []
    }
    return segmentEdits
  }

  // Local repair: freeze OK segments verbatim, re-cut only the marked spans.
  const spans = computeEditableSpans(classes)
  const repaired: ScriptShotEdit[] = []
  let cursor = 0
  for (const span of spans) {
    for (; cursor < span.lo; cursor += 1) {
      repaired.push(segmentEdits[cursor])
    }
    const spanEdits = segmentEdits.slice(span.lo, span.hi + 1)
    const spanText = spanEdits.map((edit) => edit.audio_vo).join(' ')
    const baseShotId = spanEdits[0].shot_id
    const pieces = await recutFixedSegmentSpan(session, spanText)
    pieces.forEach((piece, idx) => {
      repaired.push({ audio_vo: piece, shot_id: `${baseShotId}__r${idx + 1}` })
    })
    // An over-cap segment anywhere in the span means we split; otherwise the
    // span was an under-cap merge.
    cursor = span.hi + 1
  }
  for (; cursor < segmentEdits.length; cursor += 1) {
    repaired.push(segmentEdits[cursor])
  }

  // Coverage guard on the repaired list (splits only add shots, so coverage can
  // only improve vs the original); the rare residual falls back to legacy.
  const repairedSegments = repaired.map((edit) => edit.audio_vo)
  if (fixedSegmentsFailCoverage(session, repairedSegments, scriptText)) {
    return []
  }

  const unrepairable = repairedSegments.some((segment) => !isInWordEnvelope(segment))
  logger.info(
    `[uip] Repaired user-provided fixed segments sessionId=${session.sessionId} original=${segmentEdits.length} repaired=${repaired.length} spans=${spans.length} unrepairable=${unrepairable}`,
  )
  return repaired
}

/** String (audio_vo) view of the resolved fixed segments. */
export async function resolveFixedSegmentsFromWorkingScript(
  session: SessionState,
): Promise<string[]> {
  return (await resolveFixedSegmentEditsFromWorkingScript(session)).map((edit) => edit.audio_vo)
}

function legacyResolveFixedSegments(
  session: SessionState,
  segmentEdits: ScriptShotEdit[],
  segments: string[],
  scriptText: string,
): ScriptShotEdit[] {
  const { minWords, maxWords } = resolveFixedSegmentWordEnvelope()
  const violators = segments
    .map((segment, index) => ({ index, segment, words: countWords(segment) }))
    .filter(({ words }) => words < minWords || words > maxWords)
  if (violators.length > 0) {
    logger.warn(
      `[uip] Discarding user-provided fixed segments (envelope violation) sessionId=${session.sessionId} totalSegments=${segments.length} violators=${JSON.stringify(
        violators.map((v) => ({
          index: v.index,
          words: v.words,
          preview: v.segment.length > 80 ? `${v.segment.slice(0, 80)}...` : v.segment,
        })),
      )}`,
    )
    return []
  }
  if (fixedSegmentsFailCoverage(session, segments, scriptText)) {
    return []
  }
  return segmentEdits
}

function safeJsonParse<T>(value: string): null | T {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

// Build a minimal-fidelity shot plan from the segments + estimated total
// duration. The validator only reads `time_range.end`; we distribute the
// estimated duration proportionally by segment word count and pin the last
// segment's end at the total. This produces an optimistic plan -- the
// actual shot plan can only have lower end-coverage than this synth, so a
// synth that fails the validator guarantees the real plan will too.
function synthesizeShotPlanFromSegments(
  segments: string[],
  totalDurationSec: number,
): ShotPlanCoverageInput[] {
  if (segments.length === 0 || totalDurationSec <= 0) {
    return segments.map(() => ({ time_range: { end: 0 } }))
  }
  const totalWords = segments.reduce((sum, s) => sum + countWords(s), 0)
  if (totalWords === 0) {
    return segments.map(() => ({ time_range: { end: 0 } }))
  }
  let cumulativeEnd = 0
  const plan: ShotPlanCoverageInput[] = []
  for (let i = 0; i < segments.length; i += 1) {
    if (i === segments.length - 1) {
      // Pin the last shot's end at the total (optimistic).
      plan.push({ time_range: { end: totalDurationSec } })
      continue
    }
    const segmentWords = countWords(segments[i])
    const segmentDuration = (segmentWords / totalWords) * totalDurationSec
    cumulativeEnd += segmentDuration
    plan.push({ time_range: { end: cumulativeEnd } })
  }
  return plan
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0),
    ),
  )
}
