import { defineLiteralsFromKeyMap } from '@reelmakeeasy/common/utils/type-utils'
import { ValueOf } from '@shared/types/api/common/type-util'

import type { BaseEvent, SessionChangedEvent, SessionChangedEventInput } from './uip-timeline-types'

const jsonEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

type AutoDiff = Omit<SessionChangedEvent, ContentFieldKey | ManualDiffKey>

type ContentFieldKey = keyof BaseEvent

type JsonDiffKey<T = AutoDiff> = Exclude<keyof T, ScalarDiffKey<T>>

type ManualDiffKey = 'script' | 'shots' | 'tool_call_states'

type ScalarDiffKey<T = AutoDiff> = ValueOf<{
  [P in keyof T]-?: NonNullable<T[P]> extends boolean | number | string ? P : never
}>

const SCALAR_KEYS = defineLiteralsFromKeyMap<ScalarDiffKey>({
  spec_version: true,
  is_processing: true,
  is_running_planner_loop: true,
  phase: true,
  audio_path: true,
  audio_source: true,
  auto_lock_deadline_at: true,
  gui_request_id: true,
  review_auto_continue_deadline_at: true,
  script_word_cap_exceeded: true,
  status: true,
  is_idle: true,
  locked_at: true,
})

const JSON_KEYS = defineLiteralsFromKeyMap<JsonDiffKey>({
  anchor_assets: true,
  global_constraints: true,
  mode_state: true,
  queued_items: true,
  review_gate: true,
  stale_artifacts: true,
  uploaded_assets: true,
})

/**
 * shots: full snapshot on spec_version upgrade, or to backfill shot timing onto a snapshot
 * serialized before the `time` field existed -- that path has no spec edit, so the
 * frontend would otherwise keep rendering the word-count estimate forever.
 */
function applyShotsDiff(
  event: Omit<SessionChangedEvent, 'id'>,
  prev: null | Partial<SessionChangedEventInput>,
  next: SessionChangedEventInput,
  ctx: { changed: boolean },
): void {
  if (next.shots === undefined) {
    return
  }
  const specVersionChanged =
    next.spec_version !== undefined && next.spec_version !== prev?.spec_version
  const backfillShotTiming =
    prev?.shots !== undefined &&
    prev.shots.some((shot) => shot.time === undefined) &&
    next.shots.some((shot) => shot.time !== undefined)
  if (!specVersionChanged && !backfillShotTiming) {
    return
  }
  event.shots = next.shots
  if (backfillShotTiming) {
    ctx.changed = true
  }
}

/** tool_call_states: delta only -- entries that are new or changed since prev, matched by id. */
function diffToolCallStates(
  event: Omit<SessionChangedEvent, 'id'>,
  prev: null | Partial<SessionChangedEventInput>,
  next: SessionChangedEventInput,
  ctx: { changed: boolean },
): void {
  if (next.tool_call_states === undefined) {
    return
  }
  const prevById = new Map((prev?.tool_call_states ?? []).map((e) => [e.id, e]))
  const delta = next.tool_call_states.filter((entry) => {
    const prevEntry = prevById.get(entry.id) ?? null
    // An entry WITHOUT a sub_tools key makes no statement about substeps --
    // only the persist-path builder produces that shape, because persisted
    // snapshots strip sub_tools (publish-only substep progress). The overlaid
    // prev keeps sub_tools from earlier live /status deltas, so comparing the
    // raw shapes would re-emit every entry on every persist tick forever.
    // Mirror the overlay's absent-key-preserves semantics: strip sub_tools
    // from prev before comparing. Live-path entries always carry the key when
    // substeps exist, so real sub_tools changes still emit deltas.
    const prevComparable =
      entry.sub_tools === undefined && prevEntry?.sub_tools !== undefined
        ? (({ sub_tools: _subTools, ...rest }) => rest)(prevEntry)
        : prevEntry
    return !jsonEqual(entry, prevComparable)
  })
  if (delta.length > 0) {
    event.tool_call_states = delta
    ctx.changed = true
  }
}

/**
 * Diff two session state snapshots and return a SessionChangedEvent with only changed fields.
 * Returns null when nothing changed.
 */
export function buildSessionChangedEventDiff(
  prev: null | Partial<SessionChangedEventInput>,
  next: SessionChangedEventInput,
  ts = new Date().toISOString(),
): null | Omit<SessionChangedEvent, 'id'> {
  const event: Omit<SessionChangedEvent, 'id'> = { type: 'session_changed', ts }
  const ctx = { changed: false }

  // scalar fields
  for (const key of SCALAR_KEYS.list) {
    const nextValue = next[key]
    if (nextValue !== undefined && nextValue !== prev?.[key]) {
      // audio_source is one-way (null -> 'user_audio', never reverts).
      // Some events (e.g. mode_confirmation) emit audio_source:null when
      // the API session snapshot does not carry spec.meta.audio_source yet
      // (spec not yet loaded into memory). Suppress those null values so
      // they do not overwrite the 'user_audio' set by seedWorkingScriptActivity.
      if (key === 'audio_source' && nextValue === null && prev?.[key]) {
        continue
      }
      ;(event as Record<string, unknown>)[key] = nextValue
      ctx.changed = true
    }
  }

  // json fields
  for (const key of JSON_KEYS.list) {
    const nextValue = next[key]
    if (nextValue !== undefined && !jsonEqual(nextValue, prev?.[key] ?? null)) {
      ;(event as Record<string, unknown>)[key] = nextValue
      ctx.changed = true
    }
  }

  applyShotsDiff(event, prev, next, ctx)

  // script: compare by content string and gui_request_id
  if (
    next.script !== undefined &&
    (next.script.content !== prev?.script?.content ||
      next.script.gui_request_id !== prev?.script?.gui_request_id)
  ) {
    event.script = next.script
    ctx.changed = true
  }

  // locked_at: one-way -- only written when first set
  if (next.locked_at && !prev?.locked_at) {
    event.locked_at = next.locked_at
    ctx.changed = true
  }

  diffToolCallStates(event, prev, next, ctx)

  return ctx.changed ? event : null
}
