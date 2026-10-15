import type { SessionState, TimelineEvent } from '../api-types'

import { type OrderedPhase, PHASE_INDEX } from './constants'
import type { SessionBlocks } from './incremental-session-render-snapshot'

export type SessionBlockKind = keyof SessionBlocks

export const SESSION_BLOCK_ORDER: SessionBlockKind[] = [
  'brand_brief_card',
  'video_brief_card',
  'style_candidates',
  'script_transcript',
  'storyboards',
  'anchor_asset_list',
]

export function buildVisibleRenderDiffByKindAndEventId(params: {
  eventsForTimeline: TimelineEvent[]
  latestBlocks: SessionBlocks
  renderDiffByEventId: Map<number, Partial<SessionBlocks>>
  stateByEventId: Map<number, SessionState>
}): Map<SessionBlockKind, Map<number, SessionBlocks[SessionBlockKind]>> {
  const visible = collectVisibleRenderDiffSubset(params)
  replaceLastVisibleCellWithLatest({
    eventsForTimeline: params.eventsForTimeline,
    latestBlocks: params.latestBlocks,
    renderDiffByEventId: params.renderDiffByEventId,
    stateByEventId: params.stateByEventId,
    visible,
  })

  return visible
}

function collectVisibleRenderDiffSubset(params: {
  eventsForTimeline: TimelineEvent[]
  renderDiffByEventId: Map<number, Partial<SessionBlocks>>
  stateByEventId: Map<number, SessionState>
}): Map<SessionBlockKind, Map<number, SessionBlocks[SessionBlockKind]>> {
  const visible = createEmptyVisibleRenderDiffByKindAndEventId()

  for (const event of params.eventsForTimeline) {
    if (event.type !== 'session_changed') {
      continue
    }

    const renderDiff = params.renderDiffByEventId.get(event.id)
    if (!renderDiff) {
      continue
    }
    const state = params.stateByEventId.get(event.id)
    const phase = state?.phase ?? null
    const brandBankLocked = isBrandBankLocked(state)

    for (const kind of SESSION_BLOCK_ORDER) {
      const block = renderDiff[kind]
      if (block === undefined) {
        continue
      }
      if (!shouldDisplayBlockForPhase(kind, phase, brandBankLocked)) {
        continue
      }
      visible.get(kind)?.set(event.id, block)
    }
  }

  return visible
}

function createEmptyVisibleRenderDiffByKindAndEventId(): Map<
  SessionBlockKind,
  Map<number, SessionBlocks[SessionBlockKind]>
> {
  const result = new Map<SessionBlockKind, Map<number, SessionBlocks[SessionBlockKind]>>()
  for (const kind of SESSION_BLOCK_ORDER) {
    result.set(kind, new Map())
  }
  return result
}

function getLastEventId(map: Map<number, unknown>): null | number {
  let lastKey: null | number = null
  for (const key of map.keys()) {
    lastKey = key
  }
  return lastKey
}

function getLatestChangedEventPositionForKind(params: {
  eventsForTimeline: TimelineEvent[]
  kind: SessionBlockKind
  renderDiffByEventId: Map<number, Partial<SessionBlocks>>
}): null | { index: number } {
  const { eventsForTimeline, kind, renderDiffByEventId } = params
  for (let index = eventsForTimeline.length - 1; index >= 0; index -= 1) {
    const event = eventsForTimeline[index]
    if (event.type !== 'session_changed') {
      continue
    }
    const diff = renderDiffByEventId.get(event.id)
    if (diff?.[kind] !== undefined) {
      return { index }
    }
  }
  return null
}

function getPhaseIndex(phase: SessionState['phase']): number {
  if (!phase || !isKnownPhase(phase)) {
    return 0
  }
  return PHASE_INDEX[phase]
}

function getVisibleRangeForKind(params: {
  eventsForTimeline: TimelineEvent[]
  kind: SessionBlockKind
  stateByEventId: Map<number, SessionState>
}): null | {
  firstVisibleEventId: number
  firstVisibleIndex: number
  lastVisibleEventId: number
  lastVisibleIndex: number
} {
  const { eventsForTimeline, kind, stateByEventId } = params
  let firstVisibleEventId: null | number = null
  let firstVisibleIndex = -1
  let lastVisibleEventId: null | number = null
  let lastVisibleIndex = -1

  for (let index = 0; index < eventsForTimeline.length; index += 1) {
    const event = eventsForTimeline[index]
    if (event.type !== 'session_changed') {
      continue
    }
    const state = stateByEventId.get(event.id)
    const phase = state?.phase ?? null
    if (!shouldDisplayBlockForPhase(kind, phase, isBrandBankLocked(state))) {
      continue
    }
    if (firstVisibleEventId === null) {
      firstVisibleEventId = event.id
      firstVisibleIndex = index
    }
    lastVisibleEventId = event.id
    lastVisibleIndex = index
  }

  if (firstVisibleEventId === null || lastVisibleEventId === null) {
    return null
  }

  return {
    firstVisibleEventId,
    firstVisibleIndex,
    lastVisibleEventId,
    lastVisibleIndex,
  }
}

function isBrandBankLocked(state: SessionState | undefined): boolean {
  return Boolean(state?.global_constraints?.brand_bank_locked_at)
}

function isKnownPhase(phase: SessionState['phase']): phase is OrderedPhase {
  return typeof phase === 'string' && phase in PHASE_INDEX
}

function replaceLastVisibleCellWithLatest(params: {
  eventsForTimeline: TimelineEvent[]
  latestBlocks: SessionBlocks
  renderDiffByEventId: Map<number, Partial<SessionBlocks>>
  stateByEventId: Map<number, SessionState>
  visible: Map<SessionBlockKind, Map<number, SessionBlocks[SessionBlockKind]>>
}): void {
  const { eventsForTimeline, latestBlocks, renderDiffByEventId, stateByEventId, visible } = params
  for (const kind of SESSION_BLOCK_ORDER) {
    const slot = visible.get(kind)
    if (!slot) {
      continue
    }

    const latestValue = latestBlocks[kind]
    if (latestValue === null) {
      continue
    }

    if (slot.size === 0) {
      const boundaryEventId = resolveBoundaryEventIdForEmptySlot({
        eventsForTimeline,
        kind,
        renderDiffByEventId,
        stateByEventId,
      })
      if (boundaryEventId === null) {
        continue
      }
      slot.set(boundaryEventId, latestValue)
      continue
    }

    const lastEventId = getLastEventId(slot)
    if (lastEventId === null) {
      continue
    }
    const isUpdated = slot.size > 1
    const nextValue = isUpdated ? { ...latestValue, blockStatus: 'updated' as const } : latestValue
    slot.set(lastEventId, nextValue)
  }
}

function resolveBoundaryEventIdForEmptySlot(params: {
  eventsForTimeline: TimelineEvent[]
  kind: SessionBlockKind
  renderDiffByEventId: Map<number, Partial<SessionBlocks>>
  stateByEventId: Map<number, SessionState>
}): null | number {
  const { eventsForTimeline, kind, renderDiffByEventId, stateByEventId } = params
  const visibleRange = getVisibleRangeForKind({ eventsForTimeline, kind, stateByEventId })
  if (!visibleRange) {
    return null
  }

  const latestChanged = getLatestChangedEventPositionForKind({
    eventsForTimeline,
    kind,
    renderDiffByEventId,
  })
  const boundaryIndex = resolveBoundaryIndex(visibleRange, latestChanged?.index)
  const boundaryEvent = eventsForTimeline[boundaryIndex]
  if (boundaryEvent.type !== 'session_changed') {
    return null
  }
  return boundaryEvent.id
}

function resolveBoundaryIndex(
  visibleRange: {
    firstVisibleIndex: number
    lastVisibleIndex: number
  },
  latestChangedIndex?: number,
): number {
  if (latestChangedIndex == null) {
    return visibleRange.lastVisibleIndex
  }
  if (latestChangedIndex < visibleRange.firstVisibleIndex) {
    return visibleRange.firstVisibleIndex
  }
  if (latestChangedIndex > visibleRange.lastVisibleIndex) {
    return visibleRange.lastVisibleIndex
  }
  return latestChangedIndex
}

function shouldDisplayBlockForPhase(
  kind: SessionBlockKind,
  phase: SessionState['phase'],
  brandBankLocked: boolean,
): boolean {
  const phaseIndex = getPhaseIndex(phase)

  if (kind === 'brand_brief_card') {
    // The live extract/review phases own the card. A saved brief injected at
    // session init arrives pre-locked and skips both phases, sitting at
    // mode_confirmation; surface its read-only card there so the user sees the
    // brand was applied and confirmed. Gated on the locked bank so non-injected
    // mode_confirmation turns stay cardless.
    const inBrandPhases =
      phaseIndex >= PHASE_INDEX.bootstrap_brand && phaseIndex <= PHASE_INDEX.brand_review
    const injectedLockedPreReview = brandBankLocked && phaseIndex < PHASE_INDEX.bootstrap_brand
    return inBrandPhases || injectedLockedPreReview
  }

  if (kind === 'video_brief_card') {
    return phaseIndex >= PHASE_INDEX.bootstrap_script && phaseIndex <= PHASE_INDEX.script_review
  }

  if (kind === 'script_transcript') {
    // script_review owns the card; it is also surfaced in refinement, where the
    // narration can still change. Excluding bootstrap_visual stops a new transcript cell
    // entering at those events; a block already anchored to the last displaying event
    // stays, refreshed in place by replaceLastVisibleCellWithLatest, so a card the user
    // already has does not vanish mid-storyboard. Voiceover regeneration is signature
    // driven in SessionVoiceoverTtsOwner (autoRegenerateOnChange), independent of this.
    // SESSION_BLOCK_ORDER keeps the card above the storyboard either way.
    return phaseIndex === PHASE_INDEX.script_review || phaseIndex === PHASE_INDEX.refinement
  }

  if (kind === 'storyboards' || kind === 'anchor_asset_list') {
    return phaseIndex >= PHASE_INDEX.bootstrap_visual
  }

  return true
}
