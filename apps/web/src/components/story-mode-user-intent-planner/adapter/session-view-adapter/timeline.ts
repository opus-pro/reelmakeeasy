import { stripMarkdownFormatting } from '@/components/markdown-editor/plugins/paste-and-copy/onPasteMarkdown'

import type {
  MessageBlock,
  QaRecapBlock,
  RenderAutoLockGate,
  RenderBrandReviewGate,
  RenderQuickOption,
  RenderScriptReviewGate,
  RenderScriptVersion,
  RenderState,
  RenderSummaryVersion,
  TimelineRenderBlock,
  VersionedTimelineRenderBlock,
} from '../../state-types'
import type {
  ActionEvent,
  AssistantMessageEvent,
  GuiEditEvent,
  MessageEventEvent,
  SessionChangedEvent,
  SessionState,
  TimelineEvent,
} from '../api-types'

import { buildVideoBriefCardBlockFromState, normalizeScriptText } from './build-blocks'
import { buildTimelineBlocks } from './build-timeline-blocks'
import {
  IncrementalSessionRenderSnapshot,
  type SessionAssetsSnapshot,
} from './incremental-session-render-snapshot'
import { buildLatestScriptState } from './latest-script-state'
import { buildMessageBlockId } from './timeline-message-blocks'
import {
  buildVisibleRenderDiffByKindAndEventId,
  type SessionBlockKind,
} from './visible-render-diff'

export interface TimelineRenderBuildResult {
  gateToken: null | string
  isProcessingFromTimeline: boolean
  lastMessage: MessageEventEvent | null
  renderState: RenderState
}

export function buildTimelineRenderFromEvents(
  sessionId: string,
  timeline: TimelineEvent[],
  cdnOrigin: string,
  sessionStatus: SessionState['status'] = 'active',
  transitionVideoModel?: string,
  answeredQuestionMessageIds: ReadonlySet<string> = new Set(),
  suppressQuickQuestion = false,
): TimelineRenderBuildResult {
  const incrementalSnapshot = new IncrementalSessionRenderSnapshot(undefined, {
    cdnOrigin,
    sessionId,
  })

  const eventsForTimeline = timeline
  const messageAssetAnchorByEventId = hydrateSnapshotWithSessionChangedEvents(
    eventsForTimeline,
    incrementalSnapshot,
  )
  const visibleRenderDiffByKindAndEventId = buildVisibleRenderDiffByKindAndEventId({
    eventsForTimeline,
    latestBlocks: incrementalSnapshot.latestRenderSnapshot,
    renderDiffByEventId: incrementalSnapshot.renderDiffByEventId,
    stateByEventId: incrementalSnapshot.stateByEventId,
  })

  const guiEditRequestIds = new Set(
    eventsForTimeline
      .filter((e): e is GuiEditEvent => e.type === 'gui_edit')
      .map((e) => e.request_id),
  )

  const buildBlocksResult = buildTimelineBlocks({
    cdnOrigin,
    eventsForTimeline,
    messageAssetAnchorByEventId,
    sessionId,
    state: incrementalSnapshot.currentState,
    visibleRenderDiffByKindAndEventId,
  })
  const latest = incrementalSnapshot.latestRenderSnapshot
  const state = incrementalSnapshot.currentState

  const pendingAction =
    eventsForTimeline.findLast(
      (e): e is ActionEvent => e.type === 'action' && e.status === 'pending',
    )?.action ?? null

  const lastContinueOrCancelAction =
    eventsForTimeline.findLast(
      (e): e is ActionEvent =>
        e.type === 'action' &&
        e.status !== 'rejected' &&
        (e.action === 'continue' || e.action === 'confirm_fast' || e.action === 'cancel'),
    )?.action ?? null

  const lastConfirmOrCancelAction =
    eventsForTimeline.findLast(
      (e): e is ActionEvent =>
        e.type === 'action' &&
        e.status !== 'rejected' &&
        (e.action === 'confirm' || e.action === 'cancel'),
    )?.action ?? null

  const isProcessing =
    !state.is_idle &&
    Boolean(
      state.is_processing ||
        (buildBlocksResult.lastMessage !== null &&
          buildBlocksResult.lastMessage.type !== 'assistant_message'),
    )

  const { assistantPrompt, expectAssets, quickOptions, quickQuestionMessageId } =
    buildAssistantPromptAndQuickOptions(
      buildBlocksResult.lastMessage,
      timeline,
      answeredQuestionMessageIds,
      suppressQuickQuestion,
    )

  let { blocks } = buildBlocksResult
  blocks = mergeGuiScriptBlocksIntoPrevious(blocks, guiEditRequestIds)
  blocks = mergeGuiBrandBlocksIntoPrevious(blocks)
  blocks = collapseIntraTurnCardsOfKind(blocks, 'brand_brief_card')
  // video_brief_card churns the same way within a turn (pacing oscillates old<->new),
  // so collapse it identically -- otherwise every change leaves ~6 versions in the Summary history.
  blocks = collapseIntraTurnCardsOfKind(blocks, 'video_brief_card')
  blocks = collapseStyleCandidatesToSingleRail(blocks)
  blocks = positionStyleRailAfterTranscript(blocks)
  blocks = markOldVersionedBlocksAsOutdated(blocks)
  // Drop transient outdated brand-brief states (in_progress = loading shell,
  // failed = brief intermediate before seed_manual_brand_entry promotes it to
  // review_ready). Only review_ready outdated cards represent a user-confirmed
  // version worth keeping as folded history.
  blocks = blocks.filter(
    (b) =>
      !(
        b.kind === 'brand_brief_card' &&
        b.blockStatus === 'outdated' &&
        (b.status === 'in_progress' || b.status === 'failed')
      ),
  )
  blocks = blocks.map((b) =>
    b.kind === 'brand_brief_card' && b.status === 'in_progress'
      ? { id: b.id, kind: 'assistant_thinking' as const }
      : b,
  )
  if (sessionStatus === 'cancelled' || sessionStatus === 'timed_out') {
    const cancelFallbackTexts = new Set([
      "It looks like you stepped away, so we've closed this session. Whenever you're ready, just start a new project and we can get back to it!",
      'Your project has been cancelled.',
    ])
    let lastFallbackIndex = -1
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const b = blocks[i]
      if (b.kind === 'message' && b.role === 'assistant' && cancelFallbackTexts.has(b.text)) {
        lastFallbackIndex = i
        break
      }
    }
    if (lastFallbackIndex >= 0) {
      blocks = blocks.filter((_, index) => index !== lastFallbackIndex)
    }
  }
  // When a clarify question is live in the footer QuickQuestionCard, collapse
  // the matching assistant bubble to its mirror so the question is not rendered
  // twice (bubble tail + card header). Answered/historical clarifies keep full
  // content because the card is gone.
  if (quickOptions.length > 0) {
    blocks = applyClarifyMirrorToActiveCardBubble(blocks, buildBlocksResult.lastMessage)
  }
  blocks = collapseResolvedQuestionsIntoRecap(blocks, eventsForTimeline)

  const renderState: RenderState = {
    anchorAssetsPool: latest.anchor_assets_pool,
    anchorAssetsReceived: latest.anchor_assets_received,
    assetsPool: latest.all_assets,
    assistantPrompt,
    expectAssets,
    autoLockGate:
      latest.isLocked ||
      lastConfirmOrCancelAction !== null ||
      pendingAction ||
      sessionStatus !== 'active'
        ? undefined
        : buildAutoLockGate(
            state.phase ?? 'mode_confirmation',
            state.auto_lock_deadline_at,
            state.script_word_cap_exceeded,
          ),
    blocks,
    brandExtractionStatus: state.global_constraints?.brand_extraction_status ?? null,
    scriptLanguage: state.global_constraints?.script_language ?? null,
    isIdle: state.is_idle,
    isProcessing,
    isLocked: latest.isLocked,
    latest: {
      script: buildLatestScriptState({
        cdnOrigin,
        sessionId,
        state,
      }),
    },
    pendingAction,
    phase: state.phase ?? 'mode_confirmation',
    queuedMessages: [],
    quickQuestionMessageId,
    quickOptions,
    brandReviewGate:
      state.phase === 'brand_review' && sessionStatus === 'active'
        ? buildBrandReviewGate(
            state.review_gate,
            state.global_constraints?.brand_bank_source?.kind === 'brand_library',
            state.global_constraints?.brand_bank_source?.attached_via ?? null,
          )
        : undefined,
    scriptReviewGate:
      lastContinueOrCancelAction !== null || pendingAction || sessionStatus !== 'active'
        ? undefined
        : buildScriptReviewGate({
            deadlineAt: state.review_auto_continue_deadline_at,
            phase: state.phase ?? 'mode_confirmation',
            reviewGate: state.review_gate,
          }),
    scriptVersions: buildScriptVersionsFromEvents(eventsForTimeline),
    staleArtifacts: buildStaleArtifactsFromEvents(eventsForTimeline),
    status: latest.status,
    summaryVersions: buildSummaryVersionsFromEvents(eventsForTimeline),
    toolCallStates: (state.tool_call_states ?? []).map((item) => ({
      endedAt: item.ended_at,
      errorCode: item.error_code,
      id: item.id,
      startedAt: item.started_at,
      status: item.status,
      subTools: item.sub_tools?.map((subTool) => ({
        id: subTool.id,
        subStepStates: subTool.sub_step_states,
      })),
      tools: item.tools,
    })),
    transitionVideoModel,
    uploadedAssetsPool: latest.uploaded_assets,
  }

  return {
    gateToken: state.review_gate?.status === 'opened' ? (state.review_gate.token ?? null) : null,
    isProcessingFromTimeline: buildBlocksResult.hasSessionChangedEvent
      ? state.is_processing
      : sessionStatus === 'active',
    lastMessage: buildBlocksResult.lastMessage,
    renderState,
  }
}

/**
 * Committed transcript history, read straight from the raw event stream rather
 * than the timeline blocks: every `session_changed` snapshot whose `script.content` differs
 * from the previous one is a version. This deliberately does NOT apply the
 * mergeGuiScriptBlocksIntoPrevious folding the timeline uses -- so a user's save (which the
 * timeline hides inside the current card) shows up here as its own version, alongside agent
 * rewrites. Consecutive identical contents are de-duped; the last entry is the current text.
 */
function applyClarifyMirrorToActiveCardBubble(
  blocks: TimelineRenderBlock[],
  lastMessage: MessageEventEvent | null,
): TimelineRenderBlock[] {
  // The runtime splits a clarify reply into a mirror (`content[0..question_index]`)
  // and a question (`content[question_index..]`); the footer card already renders
  // the question slice. Only the single active card message is touched here (the
  // caller gates on a live card), so answered/historical bubbles keep full content.
  if (lastMessage?.type !== 'assistant_message' || lastMessage.question_index === undefined) {
    return blocks
  }
  const mirror = lastMessage.content.slice(0, lastMessage.question_index).trim()
  const blockId = buildMessageBlockId(lastMessage.id)
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index === -1) {
    return blocks
  }
  const block = blocks[index]
  if (block.kind !== 'message') {
    return blocks
  }
  // Empty mirror (intentional after a yes/no answer) with no attached assets:
  // the footer card alone carries the question, so drop the empty bubble.
  if (mirror === '' && block.anchorAssets.length === 0 && block.uploadedAssets.length === 0) {
    return blocks.filter((_, i) => i !== index)
  }
  return blocks.map((b, i) => (i === index ? { ...block, text: mirror } : b))
}

const MESSAGE_BLOCK_EVENT_ID_RE = /^block-message-event-(\d+)$/

/**
 * Once a clarify question has been answered (`user_message.answer_to_message_id` matches the
 * question's `message_id` -- both persisted server-side, so this survives reload), collapse the
 * question bubble and its answer bubble into a single neutral-tone recap, instead of
 * rendering them as two separate message bubbles.
 */
// Maps a question's message_id to its answer event's id. Only the id is needed -- the
// collapse pass looks up the answer's already-built MessageBlock (for its text + assets)
// rather than re-deriving them from the raw event.
function buildAnswerEventIdByQuestionMessageId(
  eventsForTimeline: TimelineEvent[],
): Map<string, number> {
  const answerEventIdByQuestionMessageId = new Map<string, number>()
  for (const event of eventsForTimeline) {
    if (
      event.type === 'user_message' &&
      event.status !== 'unqueued' &&
      event.answer_to_message_id !== undefined
    ) {
      answerEventIdByQuestionMessageId.set(event.answer_to_message_id, event.id)
    }
  }
  return answerEventIdByQuestionMessageId
}

function buildAssistantPromptAndQuickOptions(
  lastMessage: MessageEventEvent | null,
  originalTimeline: TimelineEvent[],
  answeredQuestionMessageIds: ReadonlySet<string>,
  suppressQuickQuestion: boolean,
): {
  assistantPrompt: string
  expectAssets: boolean
  optionsSourceMessageId?: number
  quickOptions: RenderQuickOption[]
  quickQuestionMessageId?: string
} {
  if (
    suppressQuickQuestion ||
    lastMessage?.type !== 'assistant_message' ||
    !lastMessage.options?.length
  ) {
    return { assistantPrompt: '', expectAssets: false, quickOptions: [] }
  }

  const questionMessageId = lastMessage.message_id
  const alreadyAnswered =
    questionMessageId &&
    (answeredQuestionMessageIds.has(questionMessageId) ||
      originalTimeline.some(
        (event) =>
          event.type === 'user_message' &&
          event.status !== 'unqueued' &&
          event.answer_to_message_id === questionMessageId,
      ))
  if (alreadyAnswered) {
    return { assistantPrompt: '', expectAssets: false, quickOptions: [] }
  }

  const questionIndex = lastMessage.question_index
  const assistantPrompt =
    questionIndex === undefined
      ? lastMessage.content
      : lastMessage.content.slice(questionIndex).trim()

  return {
    assistantPrompt,
    expectAssets:
      lastMessage.expect_assets === true ||
      lastMessage.options.some((option) => option.expect_assets === true),
    optionsSourceMessageId: lastMessage.id,
    quickQuestionMessageId: questionMessageId,
    quickOptions: lastMessage.options.map((option) => ({
      expectAssets: option.expect_assets === true,
      id: option.id,
      text: stripMarkdownFormatting(option.label),
    })),
  }
}

function buildAutoLockGate(
  phase: string,
  deadlineAt: null | string,
  scriptWordCapExceeded: boolean | null | undefined,
): RenderAutoLockGate | undefined {
  // Show the refinement confirm affordance ("Looks good, create")
  // whenever the session is in refinement, not only when an auto-lock deadline
  // exists. With auto-continue off there is no deadline, but the user still
  // needs the confirm button; the deadline only drives the countdown display
  // (a null deadline simply renders no countdown). Mirrors buildScriptReviewGate,
  // which keys visibility on phase/gate status rather than the deadline.
  if (phase !== 'refinement' || scriptWordCapExceeded === true) {
    return undefined
  }
  return {
    deadlineAt: normalizeText(deadlineAt) || null,
    hideCountdown: false,
  }
}

function buildBrandReviewGate(
  reviewGate: SessionChangedEvent['review_gate'],
  fromSavedBrief: boolean,
  attachedVia: 'auto_detect' | 'explicit' | null,
): RenderBrandReviewGate | undefined {
  if (reviewGate?.status !== 'opened') {
    return undefined
  }
  return {
    // Distinguish an auto-detected brief (matched from the prompt, never
    // chosen) from one the user explicitly picked, so the gate card copy is honest.
    // Legacy snapshots omit attached_via -- fall back to 'explicit' (the older
    // silent path) to match the planner's own fallback.
    attachedVia: attachedVia ?? 'explicit',
    fromSavedBrief,
    gateToken: reviewGate.token ?? null,
    visible: true,
  }
}

function buildQaRecapBlock(
  eventId: number,
  questionEvent: AssistantMessageEvent,
  answerBlock: MessageBlock,
): QaRecapBlock {
  const question =
    questionEvent.question_index === undefined
      ? questionEvent.content
      : questionEvent.content.slice(questionEvent.question_index).trim()
  return {
    answer: answerBlock.text,
    answerAnchorAssets: answerBlock.anchorAssets,
    answerUploadedAssets: answerBlock.uploadedAssets,
    id: `block-qa-recap-event-${eventId}`,
    kind: 'qa_recap',
    question,
  }
}

function buildQuestionEventById(
  eventsForTimeline: TimelineEvent[],
): Map<number, AssistantMessageEvent> {
  const questionEventById = new Map<number, AssistantMessageEvent>()
  for (const event of eventsForTimeline) {
    if (event.type === 'assistant_message' && event.message_id !== undefined) {
      questionEventById.set(event.id, event)
    }
  }
  return questionEventById
}

function buildScriptReviewGate(params: {
  deadlineAt: null | string
  phase: string
  reviewGate: SessionChangedEvent['review_gate']
}): RenderScriptReviewGate | undefined {
  if (params.reviewGate?.status !== 'opened' || params.phase === 'brand_review') {
    return undefined
  }
  // When the backend explicitly sends options=[] (e.g. word cap exceeded),
  // hide the gate so users aren't shown a confirm button they cannot use.
  const options = params.reviewGate.options
  if (options !== undefined && !options.some((o) => o.id === 'continue_uip_draft')) {
    return undefined
  }
  return {
    deadlineAt: normalizeText(params.deadlineAt) || null,
    hideCountdown: false,
    visible: true,
  }
}

function buildScriptVersionsFromEvents(events: TimelineEvent[]): RenderScriptVersion[] {
  const versions: RenderScriptVersion[] = []
  let lastNormalized: null | string = null
  for (const event of events) {
    if (event.type !== 'session_changed') {
      continue
    }
    const content = event.script?.content
    if (content == null) {
      continue
    }
    // Dedup on the same key the timeline blocks use (normalizeScriptText collapses the \n
    // oscillation visual-script generation injects) so a re-emitted snapshot that differs
    // only in line-break formatting is not a spurious new version. Skip empties -- an empty
    // script is a not-yet-written state, not a committed version. The stored `text` keeps the
    // raw content so the preview/restore matches what was committed.
    const normalized = normalizeScriptText(content)
    if (normalized === '' || normalized === lastNormalized) {
      continue
    }
    versions.push({
      committedAt: event.ts,
      source: event.script?.gui_request_id ? 'user' : 'agent',
      text: content,
    })
    lastNormalized = normalized
  }
  return versions
}

// Staleness ledger: last-writer-wins snapshot of session_changed's
// stale_artifacts, mirroring how every other partial-update field on this event is
// folded (globalConstraints/modeState above). Absent means unchanged -- an explicit
// `[]` is a real clear and must still overwrite the running snapshot, so the check
// below is a truthy check (an empty array is truthy), not `!== undefined`.
function buildStaleArtifactsFromEvents(events: TimelineEvent[]): RenderState['staleArtifacts'] {
  const latest = events.findLast(
    (e): e is SessionChangedEvent => e.type === 'session_changed' && Boolean(e.stale_artifacts),
  )
  return (latest?.stale_artifacts ?? []).map((entry) => ({
    artifact: entry.artifact,
    dismissed: entry.dismissed,
    since: entry.since,
    sourcePath: entry.source_path,
    tier: entry.tier,
    urgency: entry.urgency,
  }))
}

/**
 * Committed Summary history, mirroring buildScriptVersionsFromEvents: each distinct
 * video_brief_card built from a settled session_changed event's global_constraints is a version,
 * so a passive GUI save (POST /summary, which re-projects the same block in place in `blocks`)
 * shows up here as its own version, alongside agent revisions. global_constraints and mode_state
 * are carried forward across events the same way IncrementalSessionRenderSnapshot accumulates
 * SessionState, since events only carry the fields that changed. Mid-generation snapshots
 * oscillate field values, so events where the session is still processing are skipped
 * entirely -- they neither commit a version nor reset the dedup key.
 */
function buildSummaryVersionsFromEvents(events: TimelineEvent[]): RenderSummaryVersion[] {
  const versions: RenderSummaryVersion[] = []
  let globalConstraints: SessionState['global_constraints'] | undefined
  let modeState: SessionState['mode_state'] = null
  let isProcessing = false
  let lastKey: null | string = null
  for (const event of events) {
    if (event.type !== 'session_changed') {
      continue
    }
    if (event.is_processing !== undefined) {
      isProcessing = event.is_processing
    }
    if (event.mode_state !== undefined) {
      modeState = event.mode_state
    }
    if (event.global_constraints !== undefined) {
      globalConstraints = event.global_constraints
    }
    // Commit on ANY settled event from the carried state (dedup absorbs repeats): the brief
    // often streams in via processing events only, with the turn-end settle event carrying no
    // global_constraints of its own -- gating the commit on the field being present would drop
    // that final state entirely.
    if (isProcessing || globalConstraints === undefined) {
      continue
    }
    const block = buildVideoBriefCardBlockFromState({
      global_constraints: globalConstraints,
      mode_state: modeState,
    })
    if (block === null) {
      continue
    }
    const key = JSON.stringify({
      description: block.description,
      directives: block.directives,
      metaItems: block.metaItems,
      mustNotViolate: block.mustNotViolate,
      videoType: block.videoType,
    })
    if (key === lastKey) {
      continue
    }
    versions.push({
      block,
      committedAt: event.ts,
      source: event.gui_request_id ? 'user' : 'agent',
    })
    lastKey = key
  }
  return versions
}

function collapseResolvedQuestionsIntoRecap(
  blocks: TimelineRenderBlock[],
  eventsForTimeline: TimelineEvent[],
): TimelineRenderBlock[] {
  const questionEventById = buildQuestionEventById(eventsForTimeline)
  if (questionEventById.size === 0) {
    return blocks
  }
  const answerEventIdByQuestionMessageId = buildAnswerEventIdByQuestionMessageId(eventsForTimeline)

  const result: TimelineRenderBlock[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const eventId = block.kind === 'message' ? matchMessageBlockEventId(block.id) : null
    const questionEvent =
      block.kind === 'message' && block.role === 'assistant' && eventId !== null
        ? questionEventById.get(eventId)
        : undefined
    const answerEventId =
      questionEvent?.message_id === undefined
        ? undefined
        : answerEventIdByQuestionMessageId.get(questionEvent.message_id)

    if (questionEvent === undefined || answerEventId === undefined || eventId === null) {
      result.push(block)
      continue
    }

    // Matched by event id (not text) so two answers that happen to share the same wording
    // never collide. Requiring the actual MessageBlock (not just its text) also lets the recap
    // carry over anchor/uploaded assets, so an @img[...] answer keeps its inline preview.
    const answerBlock = blocks[i + 1]
    if (answerBlock?.kind !== 'message' || answerBlock.id !== buildMessageBlockId(answerEventId)) {
      result.push(block)
      continue
    }

    result.push(buildQaRecapBlock(eventId, questionEvent, answerBlock))
    // Drop the paired answer bubble -- its content now lives inside the recap above.
    i += 1
  }
  return result
}

function hydrateSnapshotWithSessionChangedEvents(
  events: TimelineEvent[],
  snapshot: IncrementalSessionRenderSnapshot,
): Map<number, SessionAssetsSnapshot> {
  const messageAssetAnchorByEventId = new Map<number, SessionAssetsSnapshot>()

  for (const event of events) {
    if (event.type === 'session_changed') {
      snapshot.push(event)
      continue
    }

    if (event.type === 'assistant_message' || event.type === 'user_message') {
      // Message anchor references the latest immutable snapshot at this boundary.
      messageAssetAnchorByEventId.set(event.id, snapshot.latestRenderSnapshot)
    }
  }

  return messageAssetAnchorByEventId
}

function isSessionBlock(block: TimelineRenderBlock): block is VersionedTimelineRenderBlock {
  return (
    block.kind === 'anchor_asset_list' ||
    block.kind === 'brand_brief_card' ||
    block.kind === 'script_transcript' ||
    block.kind === 'storyboards' ||
    block.kind === 'video_brief_card'
  )
}

function markOldVersionedBlocksAsOutdated(blocks: TimelineRenderBlock[]): TimelineRenderBlock[] {
  const seen = new Set<SessionBlockKind>()
  const next = [...blocks]

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (!isSessionBlock(block)) {
      continue
    }
    if (!seen.has(block.kind)) {
      seen.add(block.kind)
      continue
    }

    next[index] = { ...block, blockStatus: 'outdated' }
  }

  return next
}

function matchMessageBlockEventId(blockId: string): null | number {
  const match = MESSAGE_BLOCK_EVENT_ID_RE.exec(blockId)
  return match ? Number(match[1]) : null
}

// Invariant for both gui folds (script here, brand below): folding a user's edit into its
// predecessor must never reduce the block count. A kind that loses its only block loses the
// card, and the canvas reads "no block" as "still generating". Whether a card is
// shown at the current phase is the phase filter's call, never the fold's.
function mergeGuiScriptBlocksIntoPrevious(
  blocks: TimelineRenderBlock[],
  guiEditRequestIds: Set<string>,
): TimelineRenderBlock[] {
  if (guiEditRequestIds.size === 0) {
    return blocks
  }

  const result: TimelineRenderBlock[] = []
  let lastNonGuiScriptIndex: null | number = null

  for (const block of blocks) {
    if (
      block.kind === 'script_transcript' &&
      block.guiRequestId !== undefined &&
      guiEditRequestIds.has(block.guiRequestId)
    ) {
      if (lastNonGuiScriptIndex === null) {
        // No prior transcript to fold into: the agent's snapshot landed while the phase was
        // still bootstrap_script, where the phase filter hides script_transcript.
        // Dropping the edit too leaves the session with no transcript block at all, which
        // force-closes the edit modal and reverts the Script section to its struck-through
        // checklist. Render it standalone instead, dropping the routing marker so
        // it is not treated as a merge artifact -- same as the brand fold below.
        const { guiRequestId: _ignored, ...rest } = block
        lastNonGuiScriptIndex = result.length
        result.push(rest)
        continue
      }
      const prev = result[lastNonGuiScriptIndex]
      if (prev.kind === 'script_transcript') {
        result[lastNonGuiScriptIndex] = {
          ...prev,
          audioSource: block.audioSource,
          audioUrl: block.audioUrl,
          text: block.text,
        }
      }
      continue
    }

    if (block.kind === 'script_transcript') {
      lastNonGuiScriptIndex = result.length
    }
    result.push(block)
  }

  return result
}

// Brand-brief GUI draft edits arrive as their own snapshot version carrying an
// event-only gui_request_id. Fold that snapshot's content into the prior brand
// card so a user's inline edits update the card in place rather than rendering
// as a separate Updated/Outdated version. Presence-based: the marker is event
// scoped (only the flush event carries it), so the agent's genuine rewrite,
// which has no marker, is never folded.
function mergeGuiBrandBlocksIntoPrevious(blocks: TimelineRenderBlock[]): TimelineRenderBlock[] {
  const result: TimelineRenderBlock[] = []
  let lastBrandIndex: null | number = null

  for (const block of blocks) {
    if (block.kind === 'brand_brief_card' && block.guiRequestId !== undefined) {
      if (lastBrandIndex !== null) {
        const prev = result[lastBrandIndex]
        if (prev.kind === 'brand_brief_card') {
          result[lastBrandIndex] = {
            ...prev,
            brandBank: block.brandBank,
            brandBankLockedAt: block.brandBankLockedAt,
            failureReason: block.failureReason,
            status: block.status,
            styleThumbnailUrl: block.styleThumbnailUrl,
          }
        }
        continue
      }
      // No prior brand card to fold into: render this one standalone, dropping
      // the routing marker so it is not treated as a merge artifact.
      const { guiRequestId: _ignored, ...rest } = block
      lastBrandIndex = result.length
      result.push(rest)
      continue
    }

    if (block.kind === 'brand_brief_card') {
      lastBrandIndex = result.length
    }
    result.push(block)
  }

  return result
}

// Within a single conversational turn (the span between two user messages), the
// backend may emit multiple session_changed events that each produce a
// brand_brief_card block. All but the last are extraction noise and must not
// render as separate cards. Additionally, the "Updated" badge should only appear
// when a previous turn already had a brand card -- i.e. the user triggered a
// change, not automatic backend emissions.
/**
 * Collapse intra-turn churn for one versioned card kind: within each turn (span between user
 * messages; turn 0 precedes the first) keep only the LAST card, drop the rest, then re-derive the
 * "Updated" badge. Positional, not value-based, so it absorbs any within-turn churn -- GUI echoes,
 * partial streaming, oscillation -- down to the turn's settled card. Shared by
 * brand_brief_card and video_brief_card.
 */
function collapseIntraTurnCardsOfKind(
  blocks: TimelineRenderBlock[],
  kind: 'brand_brief_card' | 'video_brief_card',
): TimelineRenderBlock[] {
  // First pass: assign a turn index to every block.
  let turn = 0
  const turnByIndex: number[] = blocks.map((block) => {
    if (block.kind === 'message' && block.role === 'user') {
      turn += 1
    }
    return turn
  })

  // Second pass: for each turn, keep only the LAST card of this kind and drop the rest.
  const lastIndexByTurn = new Map<number, number>()
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind === kind) {
      lastIndexByTurn.set(turnByIndex[i], i)
    }
  }

  // survivingTurns records, in order, the turn numbers for cards we keep.
  const survivingTurns: number[] = []

  const result: TimelineRenderBlock[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.kind !== kind) {
      result.push(block)
      continue
    }

    const t = turnByIndex[i]
    if (lastIndexByTurn.get(t) !== i) {
      // Not the last card for this turn -- drop it.
      continue
    }

    // This is the surviving card for turn t. Clear any 'updated' that slot
    // computation may have set; the badge decision is made below.
    survivingTurns.push(t)
    result.push({ ...block, blockStatus: 'default' as const })
  }

  // Third pass: re-determine the "Updated" badge. The last surviving card gets 'updated' only
  // when a card from a strictly earlier turn also survives (the user triggered a prior update) --
  // so a single turn's churn is not mislabeled as an update.
  if (survivingTurns.length >= 2) {
    for (let i = result.length - 1; i >= 0; i -= 1) {
      const card = result[i]
      if (card.kind === kind) {
        result[i] = { ...card, blockStatus: 'updated' as const }
        break
      }
    }
  }

  return result
}

// The style-candidates rail is a live singleton. The backend re-emits a
// style_candidates block on every session_changed event that touches
// global_constraints -- including each setStyle pick -- so a naive per-event
// timeline stacks one "Style Options" row per selection (each frozen to the
// selection as of that event). Collapse to a single rail: keep the FIRST
// occurrence's position (where candidates were first offered, so the rail does
// not jump on every pick) but carry the LATEST block's content (current
// candidates + selection). Unlike brand cards there is no per-turn history or
// "Updated" badge -- there is only ever one current style choice.
//
// The collapsed rail gets a CONSTANT id (not the latest event's
// `item-style-candidates-event-<id>`). appendSessionChangedBlocks suffixes each
// per-event block with its event id, so carrying the latest block's id would
// change the TimelineList key (keyed on `item.id`) every time a new
// session_changed event re-emits the block -- e.g. each setStyle publish. That
// key change remounts the card, which resets its optimistic in-component
// selection (`pendingStyleName`), flickering the highlight back to the top-pick
// default for a frame before the applied style catches up. A stable id keeps the
// same element mounted across events. It also keeps the impression observer from
// refiring and the thumbnails from reloading on every tick. Normalize even the
// single-block case so the id does not jump on the 1 -> N block transition.
const STYLE_CANDIDATES_RAIL_ID = 'item-style-candidates'
function collapseStyleCandidatesToSingleRail(blocks: TimelineRenderBlock[]): TimelineRenderBlock[] {
  const indices: number[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind === 'style_candidates') {
      indices.push(i)
    }
  }
  if (indices.length === 0) {
    return blocks
  }
  const firstIndex = indices[0]
  const latest = blocks[indices[indices.length - 1]]
  return blocks
    .map((block, i) => (i === firstIndex ? { ...latest, id: STYLE_CANDIDATES_RAIL_ID } : block))
    .filter((block, i) => block.kind !== 'style_candidates' || i === firstIndex)
}

// Product wants the style-candidates rail to render BELOW the transcript in the
// chat planner, even though the style offer is emitted before the transcript. Once
// both exist, move the (single, already-collapsed) rail to just after the current
// transcript block. Before the transcript arrives the rail keeps its natural
// first-offer position; when the transcript lands on a later tick it drops below.
// The rail keeps its constant id, so repositioning does not change its React key
// (no remount -- same invariant the flicker fix relies on). Chat timeline only;
// the canvas ArtifactPanel owns its own fixed section order.
function normalizeText(value: null | string | undefined): string {
  return value?.trim() ?? ''
}

function positionStyleRailAfterTranscript(blocks: TimelineRenderBlock[]): TimelineRenderBlock[] {
  const styleIndex = blocks.findIndex((b) => b.kind === 'style_candidates')
  if (styleIndex === -1) {
    return blocks
  }
  // Anchor on the LAST transcript (the current one); older versions get marked
  // outdated downstream but still occupy earlier slots.
  let lastTranscriptIndex = -1
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].kind === 'script_transcript') {
      lastTranscriptIndex = i
    }
  }
  if (lastTranscriptIndex === -1 || styleIndex > lastTranscriptIndex) {
    // No transcript yet, or the rail is already below it -- leave as-is.
    return blocks
  }
  const rail = blocks[styleIndex]
  const withoutRail = blocks.filter((_, i) => i !== styleIndex)
  // Removing the rail (which sat before the transcript) shifts the transcript one
  // slot left, so its new index is lastTranscriptIndex - 1; insert right after it.
  const insertAt = lastTranscriptIndex
  return [...withoutRail.slice(0, insertAt), rail, ...withoutRail.slice(insertAt)]
}
