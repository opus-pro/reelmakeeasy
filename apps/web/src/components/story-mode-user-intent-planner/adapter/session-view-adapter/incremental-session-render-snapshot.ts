import { isEqual } from 'lodash-es'

import type { AssetRef, SessionStatus } from '../../state-types'
import type { SessionChangedEvent, SessionState } from '../api-types'

import {
  buildAnchorAssetListBlockFromState,
  buildAnchorAssetsPool,
  type BuildAssetPreviewOptions,
  buildBrandBriefCardBlockFromState,
  buildScriptTranscriptBlockFromState,
  buildStoryboardsBlockFromState,
  buildStyleCandidatesBlockFromState,
  buildUploadedAssetsPool,
  buildVideoBriefCardBlockFromState,
} from './build-blocks'

export interface SessionAssetsSnapshot {
  all_assets: AssetRef[]
  anchor_assets_pool: AssetRef[]
  // Whether an anchor asset list has arrived at all, independent of how many entries it held.
  // Distinguishes a session that planned zero anchors from one still waiting.
  anchor_assets_received: boolean
  uploaded_assets: AssetRef[]
}

export interface SessionBlocks {
  anchor_asset_list: null | ReturnType<typeof buildAnchorAssetListBlockFromState>
  // Brand Brief card -- visible in bootstrap_brand + brand_review phases.
  // A placeholder builder + component pair that dumps the bank as JSON;
  // a polished card can replace the component without touching this slot.
  brand_brief_card: null | ReturnType<typeof buildBrandBriefCardBlockFromState>
  script_transcript: ReturnType<typeof buildScriptTranscriptBlockFromState>
  storyboards: ReturnType<typeof buildStoryboardsBlockFromState>
  // Auto Style Selection candidates rail -- visible only while style_mode==='auto'
  // See build-blocks.ts for the full gating rules.
  style_candidates: ReturnType<typeof buildStyleCandidatesBlockFromState>
  video_brief_card: ReturnType<typeof buildVideoBriefCardBlockFromState>
}

export interface SessionMetaSnapshot {
  isLocked: boolean
  status: SessionStatus
}

export interface SessionRenderSnapshot
  extends SessionAssetsSnapshot,
    SessionBlocks,
    SessionMetaSnapshot {}

type SessionBlockKind = keyof SessionBlocks

function createBlockDiffByKindAndEventId(): Map<
  SessionBlockKind,
  Map<number, SessionRenderSnapshot[SessionBlockKind]>
> {
  const byKind = new Map<SessionBlockKind, Map<number, SessionRenderSnapshot[SessionBlockKind]>>()
  for (const kind of getBlockKinds()) {
    byKind.set(kind, new Map())
  }
  return byKind
}
const BLOCK_KIND_SET = new Set<SessionBlockKind>(getBlockKinds())

function createEmptyRenderSnapshot(): SessionRenderSnapshot {
  return {
    ...createEmptyAssetsSnapshot(),
    ...createEmptyMetaSnapshot(),
    ...createEmptySessionBlocks(),
  }
}

export class IncrementalSessionRenderSnapshot {
  readonly blockDiffByKindAndEventId: Map<
    SessionBlockKind,
    Map<number, SessionRenderSnapshot[SessionBlockKind]>
  > = createBlockDiffByKindAndEventId()

  currentState: SessionState

  // Immutable-by-replacement: each push creates and assigns a new snapshot object.
  // Consumers may safely keep snapshot references as event-boundary anchors.
  latestRenderSnapshot: SessionRenderSnapshot = createEmptyRenderSnapshot()

  readonly renderDiffByEventId = new Map<number, Partial<SessionRenderSnapshot>>()
  readonly renderSnapshotByEventId = new Map<number, SessionRenderSnapshot>()

  readonly stateByEventId = new Map<number, SessionState>()
  private readonly buildOptions: BuildAssetPreviewOptions

  constructor(initialState?: Partial<SessionState>, buildOptions?: BuildAssetPreviewOptions) {
    this.currentState = {
      ...createInitialState(),
      ...initialState,
    }
    this.buildOptions = buildOptions ?? {}
  }

  push(event: SessionChangedEvent): SessionRenderSnapshot {
    this.applyChangedEvent(event)

    const eventPatch = buildEventRenderPatch({
      buildOptions: this.buildOptions,
      event,
      state: this.currentState,
    })
    const diffPatch = buildDiffRenderPatch({
      eventPatch,
      latest: this.latestRenderSnapshot,
    })

    this.latestRenderSnapshot = {
      ...this.latestRenderSnapshot,
      ...diffPatch,
    }

    this.stateByEventId.set(event.id, { ...this.currentState })
    this.renderDiffByEventId.set(event.id, diffPatch)
    this.recordDiffByKindAndEventId(event.id, diffPatch)
    this.renderSnapshotByEventId.set(event.id, this.latestRenderSnapshot)

    return this.latestRenderSnapshot
  }

  private applyChangedEvent(event: SessionChangedEvent): void {
    for (const key of Object.keys(this.currentState) as Array<keyof SessionState>) {
      if (key === 'tool_call_states') {
        continue
      }
      const value = event[key]
      if (value !== undefined) {
        ;(this.currentState[key] as unknown) = value
      }
    }
    // tool_call_states: merge by id (event carries only new/updated entries)
    if (event.tool_call_states !== undefined) {
      const byId = new Map(this.currentState.tool_call_states.map((e) => [e.id, e]))
      for (const entry of event.tool_call_states) {
        byId.set(entry.id, { ...byId.get(entry.id), ...entry })
      }
      this.currentState.tool_call_states = [...byId.values()]
    }
  }

  private recordDiffByKindAndEventId(
    eventId: number,
    diffPatch: Partial<SessionRenderSnapshot>,
  ): void {
    for (const key of Object.keys(BLOCK_KIND_SET) as SessionBlockKind[]) {
      if (!BLOCK_KIND_SET.has(key)) {
        continue
      }
      const value = diffPatch[key]
      if (value === undefined) {
        continue
      }
      this.blockDiffByKindAndEventId.get(key)?.set(eventId, value)
    }
  }
}

function buildDiffRenderPatch(params: {
  eventPatch: Partial<SessionRenderSnapshot>
  latest: SessionRenderSnapshot
}): Partial<SessionRenderSnapshot> {
  const { eventPatch, latest } = params
  const diff: Partial<SessionRenderSnapshot> = {}

  for (const key of Object.keys(eventPatch) as Array<keyof SessionRenderSnapshot>) {
    const nextValue = eventPatch[key]
    const prevValue = latest[key]

    if (!isEqual(stripDiffExcludedFields(prevValue), stripDiffExcludedFields(nextValue))) {
      diff[key as 'anchor_assets_pool'] = nextValue as SessionRenderSnapshot['anchor_assets_pool']
    }
  }

  return diff
}

// guiRequestId is a routing annotation, not content -- exclude it from diff
// comparisons so a GUI-echo with the same text does not register as a change.
function buildEventRenderPatch(params: {
  buildOptions: BuildAssetPreviewOptions
  event: SessionChangedEvent
  state: SessionState
}): Partial<SessionRenderSnapshot> {
  const { buildOptions, event, state } = params
  const patch: Partial<SessionRenderSnapshot> = {}

  if (event.global_constraints !== undefined || event.mode_state !== undefined) {
    patch.video_brief_card = buildVideoBriefCardBlockFromState(state)
  }

  // Brand Brief card -- re-render on phase changes (entering / leaving
  // bootstrap_brand / brand_review) and on any brand_extraction_status
  // or brand_bank update (those land via global_constraints diffs).
  if (event.global_constraints !== undefined || event.phase !== undefined) {
    patch.brand_brief_card = buildBrandBriefCardBlockFromState(state, event.gui_request_id)
  }

  if (
    event.script !== undefined ||
    event.audio_source !== undefined ||
    event.audio_path !== undefined
  ) {
    patch.script_transcript = buildScriptTranscriptBlockFromState(state, buildOptions)
  }

  if (event.anchor_assets !== undefined || event.uploaded_assets !== undefined) {
    patch.anchor_assets_pool = buildAnchorAssetsPool(state.anchor_assets, buildOptions)
    patch.anchor_assets_received = state.anchor_assets !== null
    patch.uploaded_assets = buildUploadedAssetsPool(state.uploaded_assets, buildOptions)
    patch.all_assets = mergeAssets(patch.anchor_assets_pool, patch.uploaded_assets)
    patch.anchor_asset_list = buildAnchorAssetListBlockFromState(state, buildOptions)
  }

  if (
    event.shots !== undefined ||
    event.anchor_assets !== undefined ||
    event.uploaded_assets !== undefined
  ) {
    patch.storyboards = buildStoryboardsBlockFromState(state, buildOptions)
  }

  if (event.locked_at !== undefined) {
    // Unlocked is '' (default sentinel) or, per the event's declared type,
    // possibly null; only a real timestamp locks. Optional chaining keeps a
    // null from throwing even though the backend currently maps unlocked to
    // undefined (filtered by the guard above).
    patch.isLocked = Boolean(state.locked_at?.trim())
  }
  if (event.status !== undefined) {
    patch.status = state.status
  }

  // Style candidates depend on global_constraints (style_candidates, style_mode,
  // style) same as video_brief_card, plus phase/locked_at for the `locked` gate.
  if (
    event.global_constraints !== undefined ||
    event.phase !== undefined ||
    event.locked_at !== undefined
  ) {
    patch.style_candidates = buildStyleCandidatesBlockFromState(state)
  }

  return patch
}

function createEmptyAssetsSnapshot(): SessionAssetsSnapshot {
  return {
    all_assets: [],
    anchor_assets_pool: [],
    anchor_assets_received: false,
    uploaded_assets: [],
  }
}

function createEmptyMetaSnapshot(): SessionMetaSnapshot {
  return {
    isLocked: false,
    status: 'active',
  }
}

function createEmptySessionBlocks(): SessionBlocks {
  return {
    anchor_asset_list: null,
    brand_brief_card: null,
    script_transcript: null,
    storyboards: null,
    style_candidates: null,
    video_brief_card: null,
  }
}

function createInitialState(): SessionState {
  return {
    anchor_assets: null,
    audio_path: null,
    audio_source: null,
    audio_url: null,
    // Load-bearing: `applyChangedEvent` copies only keys ALREADY
    // present on `currentState`, so omitting this drops the `audio_url`
    // companion from every event.
    auto_lock_deadline_at: null,
    global_constraints: {},
    is_idle: false,
    is_processing: false,
    locked_at: '',
    mode_state: null,
    phase: null,
    queued_items: [],
    review_auto_continue_deadline_at: null,
    review_gate: null,
    script: null,
    script_word_cap_exceeded: null,
    status: 'active',
    tool_call_states: [],
    shots: [],
    spec_version: 0,
    uploaded_assets: [],
  }
}

function getBlockKinds(): SessionBlockKind[] {
  return Object.keys(createEmptySessionBlocks()) as SessionBlockKind[]
}

function mergeAssets(anchorAssets: AssetRef[], uploadedAssets: AssetRef[]): AssetRef[] {
  const result: AssetRef[] = []
  const seen = new Set<string>()

  for (const asset of [...uploadedAssets, ...anchorAssets]) {
    if (!asset.id || seen.has(asset.id)) {
      continue
    }
    seen.add(asset.id)
    result.push(asset)
  }

  return result
}

function stripDiffExcludedFields(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    const block = value as { guiRequestId?: string; kind: string }
    if (
      (block.kind === 'script_transcript' || block.kind === 'brand_brief_card') &&
      'guiRequestId' in block
    ) {
      const { guiRequestId: _ignored, ...rest } = block
      return rest
    }
  }
  return value
}
