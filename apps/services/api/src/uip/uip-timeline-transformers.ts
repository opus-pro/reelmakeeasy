import { defineLiteralsFromKeyMap } from '@reelmakeeasy/common/utils/type-utils'
import type {
  PersistedSessionState,
  PlannerPhase,
  SessionResponse,
  Spec,
} from '@reelmakeeasy/uip-planner-runtime'

import type {
  BaseEvent,
  SessionChangedEvent,
  SessionChangedEventInput,
  SessionChangedEventStaleEntry,
  StyleCandidate,
  StyleMode,
  StyleSelectionMethod,
  StyleSource,
  TimelineFile,
} from './uip-timeline-types'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

// Auto Style Selection: style_candidates/style_source/selection_method/
// style_mode are not yet part of the upstream `GlobalConstraints` spec schema
// (libs/uip-planner-runtime) -- that schema is owned by the task that lands the
// producer (the tool that actually picks candidates). This transformer only
// needs to forward the fields when present, so we widen the input type locally
// rather than reaching into the shared runtime package for a schema-only task.
export type SessionChangedOverlayFieldKey = Exclude<
  keyof SessionChangedEvent,
  'tool_call_states' | keyof BaseEvent
>

type SpecGlobalConstraintsWithStyleSelection = NonNullable<Spec['global_constraints']> & {
  selection_method?: StyleSelectionMethod
  style_candidates?: StyleCandidate[]
  style_mode?: StyleMode
  style_source?: StyleSource
}

const SESSION_CHANGED_OVERLAY_FIELDS = defineLiteralsFromKeyMap<SessionChangedOverlayFieldKey>({
  phase: true,
  shots: true,
  anchor_assets: true,
  global_constraints: true,
  gui_request_id: true,
  mode_state: true,
  audio_path: true,
  audio_source: true,
  auto_lock_deadline_at: true,
  review_auto_continue_deadline_at: true,
  script_word_cap_exceeded: true,
  status: true,
  queued_items: true,
  uploaded_assets: true,
  script: true,
  review_gate: true,
  locked_at: true,
  is_idle: true,
  is_processing: true,
  is_running_planner_loop: true,
  spec_version: true,
  // Without this the overlay drops stale_artifacts when replaying
  // prior session_changed events into prevState, so buildSessionChangedEventDiff
  // always sees an empty prev ledger and re-emits the field on every persist
  // tick even when it did not change.
  stale_artifacts: true,
})

export interface PrevSessionStateRaw {
  sessionState: null | PersistedSessionState
  spec: null | Spec
}

export function normalizeTimeline(raw: null | undefined | unknown): TimelineFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid uipSession.timeline: expected object')
  }
  const value = raw as Partial<TimelineFile>
  if (
    typeof value.version !== 'number' ||
    typeof value.next_event_id !== 'number' ||
    !Array.isArray(value.events)
  ) {
    throw new Error('Invalid uipSession.timeline: malformed timeline payload')
  }
  return {
    version: value.version,
    next_event_id: value.next_event_id,
    events: value.events as TimelineFile['events'],
  }
}

// Shared spec -> session_changed mappers, used by BOTH the /persist builder
// (specToChangedEventFields) and the live /status builder
// (sessionResponseToChangedEventInput). These are the spec-derived fields that
// drive versioned FE blocks (the brand-brief card + the storyboard). If the two
// builders computed them differently, the field would flap across publishes and
// the FE would stack duplicate cards (the brand-brief-dupe class). Sharing
// one mapper makes drift impossible.
function specGlobalConstraintsToEventField(
  gc: SpecGlobalConstraintsWithStyleSelection | undefined,
): NonNullable<SessionChangedEventInput['global_constraints']> {
  return {
    video_type: gc?.video_type ?? '',
    topic: gc?.topic ?? '',
    target_audience: gc?.target_audience ?? '',
    tone: gc?.tone ?? '',
    style: { ...gc?.style },
    // Auto Style Selection: forwarded as-is, same shared-mapper guarantee
    // as `style` above -- both publish paths must agree or the FE style-picker
    // card flaps/duplicates.
    style_candidates: gc?.style_candidates,
    style_source: gc?.style_source,
    selection_method: gc?.selection_method,
    style_mode: gc?.style_mode,
    pacing: gc?.pacing ?? null,
    directives: gc?.directives ?? [],
    must_not_violate: gc?.must_not_violate ?? [],
    brand_bank: gc?.brand_bank ?? null,
    brand_bank_locked_at: gc?.brand_bank_locked_at ?? null,
    brand_bank_source: gc?.brand_bank_source ?? null,
    brand_extraction_failure_reason: gc?.brand_extraction_failure_reason ?? null,
    brand_extraction_input: gc?.brand_extraction_input ?? null,
    brand_extraction_run_id: gc?.brand_extraction_run_id ?? null,
    brand_extraction_started_at: gc?.brand_extraction_started_at ?? null,
    brand_extraction_status: gc?.brand_extraction_status ?? null,
    brand_style_directive: gc?.brand_style_directive ?? null,
    brand_style_preview_url: gc?.brand_style_preview_url ?? null,
    brand_video_type: gc?.brand_video_type ?? null,
  }
}

// Shared by BOTH publish paths (persist + /status), same reason as
// specGlobalConstraintsToEventField above: a field the two paths compute
// differently flaps across publishes and the FE fold stacks duplicates.
//
// Returns undefined (not []) when `meta` -- or its ledger -- is absent, mirroring
// specShotsToEventField below. The /status path can call this with no spec at all
// (see sessionResponseToChangedEventInput), and buildSessionChangedEventDiff treats
// an explicit [] as "the ledger just emptied" but undefined as "unchanged".
// Returning [] here for an absent spec would publish a false clear over whatever
// ledger the /persist path already published.
function specStaleArtifactsToEventField(
  meta: Spec['meta'] | undefined,
): SessionChangedEventStaleEntry[] | undefined {
  return meta?.stale_artifacts?.map((entry) => ({
    artifact: entry.artifact,
    dismissed: entry.dismissed_at != null,
    since: entry.since,
    source_path: entry.source_path,
    tier: entry.tier,
    urgency: entry.urgency,
  }))
}

// The workflow-owned brand fields, mirroring the set generate-intent-context
// initializes to null in its pending projection. Keep the two lists in sync.
function pickBrandConstraintFields(
  gc: SpecGlobalConstraintsWithStyleSelection,
): Partial<SpecGlobalConstraintsWithStyleSelection> {
  return {
    brand_bank: gc.brand_bank,
    brand_bank_locked_at: gc.brand_bank_locked_at,
    brand_bank_source: gc.brand_bank_source,
    brand_extraction_failure_reason: gc.brand_extraction_failure_reason,
    brand_extraction_input: gc.brand_extraction_input,
    brand_extraction_run_id: gc.brand_extraction_run_id,
    brand_extraction_started_at: gc.brand_extraction_started_at,
    brand_extraction_status: gc.brand_extraction_status,
    brand_style_directive: gc.brand_style_directive,
    brand_style_preview_url: gc.brand_style_preview_url,
    brand_video_type: gc.brand_video_type,
  }
}

function specShotsToEventField(
  shots: Spec['visual_script']['shots'] | undefined,
): SessionChangedEventInput['shots'] {
  return shots?.map((shot) => ({
    shot_id: shot.shot_id,
    order: shot.order,
    audio_vo: shot.audio_vo,
    visual_primary: { core_description: shot.visual_primary.core_description },
    ...(shot.time ? { time: { end_s: shot.time.end_s, start_s: shot.time.start_s } } : {}),
    ...(shot.pre_selected_assets?.length
      ? {
          pre_selected_assets: shot.pre_selected_assets.map((a) => ({
            asset_id: a.asset_id,
            source: a.source,
          })),
        }
      : {}),
  }))
}

/**
 * Narration text shown in the Transcript card. After script_review the
 * authoritative narration lives in `shots[].audio_vo` -- refinement edits land
 * there, not on `working_script.script` / `script_review_context.script`, which
 * freeze at script-review. So in refinement, once shots exist, we join their
 * audio_vo; before that the working/review script stands. Read-only derivation
 * (never written back to working_script). Applied identically on both publish
 * paths (persist diff + live /status) so the script diff cannot flap.
 *
 * Audio-upload mode (`audioMode`, i.e. `audio_source === 'user_audio'`,
 * including music) is exempt and always keeps the fallback: the transcript is
 * the immutable ASR of the user's own audio and is never re-derived from shots.
 * Re-joining `shots[].audio_vo` there produces a string that differs from the
 * stored ASR by more than whitespace (segmentation / punctuation / dropped
 * empty shots), which the FE's whitespace-only transcript dedup cannot absorb --
 * so the card would flip to "Updated" on entering refinement even though an
 * audio-mode transcript cannot change.
 */
export function deriveTranscriptScriptContent(params: {
  audioMode: boolean
  fallback: null | string | undefined
  phase: null | PlannerPhase | undefined
  shots: undefined | { audio_vo?: string; order?: number }[]
}): null | string {
  const { audioMode, fallback, phase, shots } = params
  if (!audioMode && phase === 'refinement' && shots && shots.length > 0) {
    // Sort by shot.order before joining -- the runtime source of truth
    // (getScriptSource) orders by order, and a persisted spec's array may not
    // already be in order, which would otherwise voice the narration out of
    // sequence. Stable sort keeps the array order for shots without `order`.
    const joined = [...shots]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((shot) => (shot.audio_vo ?? '').trim())
      .filter(Boolean)
      .join(' ')
    if (joined) {
      return joined
    }
  }
  return fallback ?? null
}

/** Map a persisted spec snapshot to the subset of fields tracked in SessionChangedEventInput. */
function specToChangedEventFields(
  spec: Spec,
): Pick<
  SessionChangedEventInput,
  | 'audio_source'
  | 'auto_lock_deadline_at'
  | 'global_constraints'
  | 'locked_at'
  | 'mode_state'
  | 'script_word_cap_exceeded'
  | 'shots'
  | 'spec_version'
  | 'stale_artifacts'
> {
  return {
    spec_version: spec.meta.spec_version,
    locked_at: spec.meta.locked_at ?? undefined,
    auto_lock_deadline_at: spec.meta.auto_lock_deadline_at ?? null,
    audio_source: spec.meta.audio_source ?? null,
    // Mirror spec.meta.script_word_cap.exceeded into the timeline event so
    // frontend doesn't need a storage read to surface the trim banner. Falls
    // back to null when the cap hasn't been audited yet (audio mode never
    // audits; first turn of every text-mode session is also pre-audit).
    script_word_cap_exceeded: spec.meta.script_word_cap?.exceeded ?? null,
    mode_state: {
      mode: spec.meta.mode_state.mode ?? null,
      confirmed: Boolean(spec.meta.mode_state.confirmed),
      duration_seconds: spec.meta.mode_state.duration_seconds ?? null,
      input_type: spec.meta.mode_state.input_type ?? null,
    },
    global_constraints: specGlobalConstraintsToEventField(spec.global_constraints),
    shots: specShotsToEventField(spec.visual_script.shots),
    stale_artifacts: specStaleArtifactsToEventField(spec.meta),
  }
}

/** Map a persisted session state to the subset of fields tracked in SessionChangedEventInput. */
function sessionStateToChangedEventFields(
  state: PersistedSessionState,
): Pick<
  SessionChangedEventInput,
  | 'anchor_assets'
  | 'audio_path'
  | 'gui_request_id'
  | 'queued_items'
  | 'review_auto_continue_deadline_at'
  | 'review_gate'
  | 'script'
  | 'tool_call_states'
  | 'uploaded_assets'
> {
  const anchors =
    state.anchor_assets_summary?.anchors ?? state.cached_artifacts?.anchor_assets_summary?.anchors
  const workingScript = state.working_script ?? state.cached_artifacts?.working_script
  const script = workingScript?.script
  const rg = state.review_gate ?? null
  const queuedItems = state.queued_items ?? []
  const uploadedAssets = state.uploaded_assets ?? state.cached_artifacts?.uploaded_assets ?? []

  return {
    audio_path: state.audio_path,
    // Event-only marker for a brand-brief GUI draft-edit flush. Diffed as a
    // scalar, so it is emitted only on the flush turn (when it changes), not on
    // the agent's subsequent rewrite.
    gui_request_id: state.cached_artifacts?.brand_draft_gui_request_id,
    anchor_assets: anchors?.map((anchor) => ({
      anchor_id: anchor.anchor_id,
      label: anchor.label,
      type: anchor.type,
      status: anchor.status,
      source_asset_ids: anchor.source_asset_ids,
      preview_asset_id: anchor.preview_asset_id ?? null,
      preview_relative_path: anchor.preview_relative_path ?? null,
    })),
    script:
      script == null
        ? undefined
        : { content: script, gui_request_id: workingScript?.gui_request_id },
    review_gate: rg
      ? { status: 'opened' as const, token: rg.token }
      : { status: 'closed' as const },
    review_auto_continue_deadline_at: state.review_auto_continue_deadline_at ?? null,
    queued_items: queuedItems.map((item) => ({
      id: item.id,
      message: item.message,
      created_at: item.created_at,
      uploaded_assets: (item.uploaded_assets ?? []).map((asset) => ({
        asset_id: asset.asset_id,
        content_type: asset.content_type,
        file_name: asset.file_name,
        file_path: asset.file_path,
      })),
    })),
    tool_call_states: (state.tool_call_states ?? []).map((item) => ({
      id: item.id,
      tools: [...item.tools],
      status: item.status,
      started_at: item.started_at,
      ended_at: item.ended_at ?? null,
      ...(item.error_code ? { error_code: item.error_code } : {}),
      // Defensive symmetry only: persisted snapshots never carry sub_tools
      // (transient, publish-only). The live path that actually emits them is
      // sessionResponseToChangedEventInput.
      ...(item.sub_tools ? { sub_tools: item.sub_tools } : {}),
    })),
    uploaded_assets: uploadedAssets.map((asset) => ({
      asset_id: asset.asset_id,
      content_type: asset.content_type,
      file_name: asset.file_name,
      file_path: asset.file_path,
    })),
  }
}

/** Read previous persisted raw files from storage. */
export async function readPrevSessionStateRaw(projectId: string): Promise<PrevSessionStateRaw> {
  const prefix = `projects/${projectId}/user-intent-planner`

  const [sessionStateResult, specResult] = await Promise.allSettled([
    fileStore.file(`${prefix}/session-state.json`).read(),
    fileStore.file(`${prefix}/spec/current/spec.json`).read(),
  ])

  const sessionState =
    sessionStateResult.status === 'fulfilled'
      ? (JSON.parse(sessionStateResult.value.toString()) as PersistedSessionState)
      : null

  const spec =
    specResult.status === 'fulfilled' ? (JSON.parse(specResult.value.toString()) as Spec) : null

  return { sessionState, spec }
}

/**
 * Map previously persisted raw files into SessionChangedEventInput fields used by diff.
 */
export function mapPrevSessionStateRawToChangedEventInput(
  raw: PrevSessionStateRaw,
  phase: null | PlannerPhase,
): Partial<SessionChangedEventInput> {
  const fields: Partial<SessionChangedEventInput> = {
    ...(phase == null ? {} : { phase }),
    ...(raw.spec ? specToChangedEventFields(raw.spec) : {}),
    ...(raw.sessionState ? sessionStateToChangedEventFields(raw.sessionState) : {}),
  }
  // In refinement the transcript follows the live shots[].audio_vo.
  // Audio-upload mode keeps the immutable ASR transcript (fallback).
  const derivedScript = deriveTranscriptScriptContent({
    audioMode: raw.spec?.meta?.audio_source === 'user_audio',
    fallback: fields.script?.content,
    phase,
    shots: raw.spec?.visual_script?.shots,
  })
  if (derivedScript != null) {
    fields.script = { ...fields.script, content: derivedScript }
  }
  return fields
}

/**
 * Backward-compatible wrapper: read + map in one call.
 */
export async function readPrevSessionState(
  projectId: string,
  phase: null | PlannerPhase,
): Promise<Partial<SessionChangedEventInput>> {
  const raw = await readPrevSessionStateRaw(projectId)
  return mapPrevSessionStateRawToChangedEventInput(raw, phase)
}

/**
 * Reconstruct the effective previous state by replaying session_changed events
 * on top of a persisted storage base snapshot.
 */
export function overlaySessionChangedEvents(
  base: Partial<SessionChangedEventInput>,
  events: TimelineFile['events'],
): Partial<SessionChangedEventInput> {
  const overlaid: Partial<SessionChangedEventInput> = { ...base }

  for (const event of events) {
    if (event.type !== 'session_changed') {
      continue
    }

    applySessionChangedOverlay(overlaid, event)
  }

  return overlaid
}

function applySessionChangedOverlay(
  overlaid: Partial<SessionChangedEventInput>,
  event: SessionChangedEvent,
): void {
  for (const field of SESSION_CHANGED_OVERLAY_FIELDS.list) {
    const value = event[field]
    if (value !== undefined) {
      ;(overlaid as Record<string, unknown>)[field] = value
    }
  }
  // tool_call_states: merge by id (event carries only new/updated entries)
  if (event.tool_call_states?.length) {
    const byId = new Map((overlaid.tool_call_states ?? []).map((e) => [e.id, e]))
    for (const entry of event.tool_call_states) {
      byId.set(entry.id, { ...byId.get(entry.id), ...entry })
    }
    overlaid.tool_call_states = [...byId.values()]
  }
}

/** First argument that is a non-empty object, else null. */
function firstNonEmpty<T extends object>(...candidates: (null | T | undefined)[]): null | T {
  for (const candidate of candidates) {
    if (candidate && Object.keys(candidate).length > 0) {
      return candidate
    }
  }
  return null
}

/**
 * Map a full SessionResponse into a SessionChangedEventInput.
 * Strips CDN URLs and preview fields -- only timeline-relevant fields are kept.
 */
export function sessionResponseToChangedEventInput(s: SessionResponse): SessionChangedEventInput {
  const audioMode = s.spec?.meta?.audio_source === 'user_audio'
  // In refinement the transcript follows the live shots[].audio_vo.
  // Audio-upload mode's transcript is the immutable ASR. Unlike the
  // persist path (which has `working_script` and passes the ASR as the fallback),
  // the /status response has no ASR source -- `script_review_context.script` is
  // `getScriptSource()`, which prefers the re-joined `shots[].audio_vo` in
  // refinement (differs from the ASR beyond whitespace). Emitting that here would
  // republish shot-derived text and flip the card to a spurious "Updated". The
  // persist path already publishes the stable ASR, so in audio-mode refinement
  // the /status path leaves the transcript to it and emits no `script`.
  const transcriptScript =
    audioMode && s.phase === 'refinement'
      ? null
      : deriveTranscriptScriptContent({
          audioMode,
          fallback: s.script_review_context?.script,
          phase: s.phase,
          shots: s.spec?.visual_script?.shots,
        })
  return {
    gui_request_id: s.gui_request_id,
    is_idle: s.is_idle ?? false,
    is_processing: s.is_processing,
    is_running_planner_loop: s.is_running_planner_loop,
    spec_version: s.spec?.meta?.spec_version ?? 0,
    status: s.status,
    phase: s.phase,
    // Shared mapper -> identical to the /persist event's global_constraints, so
    // the brand-brief card can't flap/duplicate across the two publish paths.
    // Source PENDING-AWARE constraints: tool-written values sit in the
    // worker's cached_artifacts.pending_global_constraints until the
    // auto-apply pass folds them into the spec, and
    // script_review_context.global_constraints is the `pending ?? spec`
    // projection the response already carries. Reading the raw spec copy here
    // emits stale values on every status tick, CLOBBERING the /persist event's
    // real value in the client's session_changed fold.
    // Only claim the field when the response actually carries constraints:
    // some status snapshots embed an empty spec copy.
    ...(() => {
      const liveConstraints =
        firstNonEmpty(s.script_review_context?.global_constraints, s.spec?.global_constraints) ??
        undefined
      if (!liveConstraints) {
        return {}
      }
      // Brand fields are the exception to pending-aware sourcing: they are
      // workflow-owned and never written by planner tools, and the pending
      // projection hard-nulls every one of them (generate-intent-context).
      // The v2 fold keeps pending staged after apply, so sourcing brand_*
      // from the projection emits null on every status tick, clobbering the
      // /persist event's real values in the timeline fold (and flipping
      // deriveBrandTelemetry's isBrandVideo to false). Claim them from the
      // spec copy whenever the response carries one.
      const specConstraints = firstNonEmpty(s.spec?.global_constraints)
      const constraints =
        specConstraints && specConstraints !== liveConstraints
          ? { ...liveConstraints, ...pickBrandConstraintFields(specConstraints) }
          : liveConstraints
      return { global_constraints: specGlobalConstraintsToEventField(constraints) }
    })(),
    mode_state: {
      mode: s.mode_state?.mode ?? null,
      confirmed: Boolean(s.mode_state?.confirmed),
      duration_seconds: s.mode_state?.duration_seconds ?? null,
      input_type: s.mode_state?.input_type ?? null,
    },
    audio_source: s.spec?.meta?.audio_source ?? null,
    audio_path: s.audio_path,
    auto_lock_deadline_at: s.auto_lock_deadline_at ?? null,
    review_auto_continue_deadline_at: s.review_auto_continue_deadline_at ?? null,
    // Mirror spec.meta.script_word_cap.exceeded so frontend can render the
    // trim banner from the timeline alone (no storage read). SessionResponse
    // top-level `script_word_cap_exceeded` is the canonical source.
    script_word_cap_exceeded: s.script_word_cap_exceeded ?? null,
    queued_items: (s.queued_items ?? []).map((item) => ({
      id: item.id,
      message: item.message,
      created_at: item.created_at,
      uploaded_assets: (item.uploaded_assets ?? []).map((asset) => ({
        asset_id: asset.asset_id,
        content_type: asset.content_type,
        file_name: asset.file_name,
        file_path: asset.file_path,
      })),
    })),
    tool_call_states: (s.tool_call_states ?? []).map((item) => ({
      id: item.id,
      tools: [...item.tools],
      status: item.status,
      started_at: item.started_at,
      ended_at: item.ended_at ?? null,
      ...(item.error_code ? { error_code: item.error_code } : {}),
      ...(item.sub_tools ? { sub_tools: item.sub_tools } : {}),
    })),
    uploaded_assets: (s.uploaded_assets ?? []).map((asset) => ({
      asset_id: asset.asset_id,
      content_type: asset.content_type,
      file_name: asset.file_name,
      file_path: asset.file_path,
    })),
    // Shared mapper -> identical to the /persist event's shots, so the
    // storyboard can't flap/duplicate across the two publish paths.
    shots: specShotsToEventField(s.spec?.visual_script?.shots),
    anchor_assets: s.anchor_assets?.anchors?.map((anchor) => ({
      anchor_id: anchor.anchor_id,
      label: anchor.label,
      type: anchor.type,
      status: anchor.status,
      source_asset_ids: anchor.source_asset_ids,
      preview_asset_id: anchor.preview_asset_id ?? null,
      preview_relative_path: anchor.preview_relative_path ?? null,
    })),
    script: transcriptScript == null ? undefined : { content: transcriptScript },
    review_gate: s.review_gate
      ? { status: 'opened' as const, token: s.review_gate.token }
      : { status: 'closed' as const },
    locked_at: s.locked_at ?? undefined,
    // Shared mapper -> identical to the /persist event's stale_artifacts, so
    // the consistency-ledger cards can't flap/duplicate across the two
    // publish paths.
    stale_artifacts: specStaleArtifactsToEventField(s.spec?.meta),
  }
}
