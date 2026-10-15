/**
 * UIP V2 signal + query handler registration.
 *
 * Change 3 (event log is the queue): every handler appends DIRECTLY to the
 * event log via `appendEvent`. There is no pendingSignals / pendingToolResults
 * staging. A decision-worthy event makes `hasUnprocessedDecisionEvent` true and
 * wakes the main loop; a passive event still lands in the log (and is a deadline
 * reset / persist trigger for the background loop) but does not wake the planner.
 * Dedup is by `actionId` against `state.seenActionIds`.
 *
 * Value imports are local pure modules + `@reelmakeeasy/workflow-engine/workflow`
 * only. Query handlers MUST NOT call foldSession (the API folds the raw events
 * into a SessionState on its side).
 *
 * Clock: `appendEvent` stamps the authoritative `at` from `Date.now()`, and
 * handlers add the human-readable `timestamp` from the same clock.
 */

import type { PatchOp, UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import { setHandler, uuid4 } from '@reelmakeeasy/workflow-engine/workflow'

import {
  brandBriefSubmitSignal,
  brandExtractionFailedSignal,
  brandExtractionReadySignal,
  cancelQueuedItemSignal,
  cancelSessionSignal,
  cancelToolSignal,
  childProgressMessageSignal,
  confirmBrandReviewSignal,
  confirmFastSignal,
  confirmSignal,
  continueUipDraftSignal,
  getActiveToolCallsQuery,
  getAgentEventsQuery,
  getWorkflowHealthQuery,
  guiUpdateSignal,
  musicBeatSheetSignal,
  preVoiceoverArtifactsReadySignal,
  preVoiceoverScriptReadySignal,
  scriptReviewUpdateSignal,
  setAutoContinueSignal,
  setStyleSignal,
  setTransitionVideoModelSignal,
  toolCancelledSignal,
  toolCompletedSignal,
  toolFailedSignal,
  toolSubstepSignal,
  userActivitySignal,
  userMessageSignal,
  userMessagesSignal,
  wakeSignal,
} from './channels'
import { appendEvent } from './event-log'
import {
  brandStatus,
  countDecisionWorthy,
  foldCurrentGateToken,
  foldPhase,
  foldSpecVersion,
  isAwaitingMusicBeatSheet,
  isLastUnprocessedWake,
} from './folds'
import type { GuiUpdateSignalPayload } from './signal-payloads'
import { isTerminal } from './state-util'
import type { WorkflowState } from './types'

/**
 * Record a dispatched action's id so the main loop claims (clears) the API's
 * nextAction record for it (new protocol). Recorded regardless of dedup/defer/
 * drop: the action is durably in the workflow (event log / deferred buffer /
 * seenActionIds) once the signal lands, so the API may safely release its
 * at-least-once guard. Claiming is idempotent. No-op for an absent actionId or
 * one already queued.
 */
function recordActionToClaim(state: WorkflowState, actionId: string | undefined): void {
  if (actionId && !state.actionIdsToClaim.includes(actionId)) {
    state.actionIdsToClaim.push(actionId)
  }
}

/**
 * Turn a summary-card edit into `update_global_field` ops.
 *
 * The field order is fixed, not derived from the payload's key order, so the same
 * signal always folds to the same op sequence. Only the three fields
 * `GuiUpdateSignalPayload` can carry are emitted, and all three are in
 * patch-apply's ALLOWED_GLOBAL_PATHS, so this can never build a patch that
 * applyPatch would reject wholesale.
 */
function buildSummaryPatchOps(
  globalConstraints: GuiUpdateSignalPayload['globalConstraints'],
): PatchOp[] {
  if (!globalConstraints) {
    return []
  }
  const ops: PatchOp[] = []
  if (globalConstraints.topic !== undefined) {
    ops.push({ op: 'update_global_field', path: 'topic', value: globalConstraints.topic })
  }
  if (globalConstraints.directives !== undefined) {
    ops.push({
      op: 'update_global_field',
      path: 'directives',
      value: globalConstraints.directives,
    })
  }
  if (globalConstraints.must_not_violate !== undefined) {
    ops.push({
      op: 'update_global_field',
      path: 'must_not_violate',
      value: globalConstraints.must_not_violate,
    })
  }
  return ops
}

/**
 * Whether a user message should be deferred into the buffer instead of waking the
 * planner: during the bootstrap_brand extraction hold, or during the
 * music beat-sheet hold in script_review. Both are system-owned waits where the
 * planner has nothing to do; the main loop flushes the buffer once the wait
 * resolves (flushDeferredUserMessages).
 */
function shouldDeferUserMessage(state: WorkflowState): boolean {
  const brandHold =
    state.brandExtractionEnabled &&
    foldPhase(state.events) === 'bootstrap_brand' &&
    brandStatus(state.events) === 'pending'
  const musicHold = isAwaitingMusicBeatSheet(state.events)
  return brandHold || musicHold
}

/** ISO timestamp from the workflow clock. */
function nowIso(): string {
  return new Date(Date.now()).toISOString()
}

/**
 * Idempotency guard. Returns true (skip) when `actionId` was already seen;
 * otherwise records it and returns false. An undefined actionId never dedups.
 */
function dedup(state: WorkflowState, actionId: string | undefined): boolean {
  if (!actionId) {
    return false
  }
  if (state.seenActionIds.has(actionId)) {
    return true
  }
  state.seenActionIds.add(actionId)
  return false
}

/**
 * Message-level idempotency guard for user messages. Returns true (skip) when a
 * `user_message` with this `messageId` already exists in the log OR is buffered
 * in `deferredUserMessages`. An undefined/empty messageId never dedups.
 *
 * Why this is needed on top of `dedup(actionId)`: the new-protocol API inbox
 * re-sends the same user message (e.g. after a `user_wake`) WITHOUT carrying a
 * stable `actionId`, so actionId dedup misses it and the same message lands in
 * the log twice. `messageId` is the stable per-message identity, so we dedup on
 * it (V1 dedups inbox records by message id at the API layer).
 */
function hasUserMessageId(state: WorkflowState, messageId: string | undefined): boolean {
  if (!messageId) {
    return false
  }
  for (const ev of state.events) {
    if (ev.type === 'user_message' && ev.messageId === messageId) {
      return true
    }
  }
  for (const m of state.deferredUserMessages) {
    if (m.messageId === messageId) {
      return true
    }
  }
  return false
}

/** Register the V2 read-only query handlers (raw events / active tools / health). */
export function registerAllQueryHandlers(state: WorkflowState): void {
  // Returns the RAW event log + artifacts; the API folds them into a
  // SessionState on its side (foldSession value-imports uip-planner-runtime,
  // which workflow code imports type-only).
  setHandler(getAgentEventsQuery, () => ({
    currentArtifacts: state.currentArtifacts,
    events: state.events,
  }))

  setHandler(getActiveToolCallsQuery, () =>
    Array.from(state.activeToolCalls.entries()).map(([toolCallId, info]) => ({
      childWorkflowId: info.childWorkflowId,
      startedAt: info.startedAt,
      toolCallId,
      toolName: info.toolName,
    })),
  )

  setHandler(getWorkflowHealthQuery, () => ({
    activeToolCount: state.activeToolCalls.size,
    eventCount: state.events.length,
    isTerminal: isTerminal(state),
    processedDecisionCount: countDecisionWorthy(state.events),
  }))
}

export function registerAllSignalHandlers(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
): void {
  // Passive browser activity resets foldDeadline without waking the planner or
  // triggering persistence. The signal is intentionally payloadless: workflow
  // receipt time is authoritative for the normal reset path; the Mongo stamp is
  // only the conservative fallback when signal delivery fails. Registered
  // unconditionally.
  setHandler(userActivitySignal, () => {
    appendEvent(state, {
      kind: 'operate',
      timestamp: nowIso(),
      type: 'user_activity',
    })
  })

  // -- User messages (decision-worthy) --
  setHandler(userMessageSignal, (payload) => {
    recordActionToClaim(state, payload.actionId)
    if (dedup(state, payload.actionId)) {
      return
    }
    // Drop a re-sent message with a messageId we have already logged/buffered
    // (the inbox replays messages after a wake without a stable actionId).
    if (hasUserMessageId(state, payload.messageId)) {
      return
    }
    // Defer while bootstrap_brand extraction is pending: buffer instead of
    // appending so the planner is not woken mid-extraction (V1
    // shouldDeferUserMessage). The main loop flushes these on brand_review entry.
    if (shouldDeferUserMessage(state)) {
      state.deferredUserMessages.push(payload)
      return
    }
    appendEvent(state, {
      type: 'user_message',
      actionId: payload.actionId,
      answerToMessageId: payload.answerToMessageId,
      message: payload.message,
      messageId: payload.messageId,
      sentAt: payload.sentAt,
      timestamp: nowIso(),
      uploadedAssets: payload.uploadedAssets,
    })
  })

  setHandler(userMessagesSignal, (payload) => {
    recordActionToClaim(state, payload.actionId)
    if (dedup(state, payload.actionId)) {
      return
    }
    for (const m of payload.messages) {
      // Per-message dedup: skip any message whose messageId is already logged
      // (the batch can overlap with previously delivered messages on a replay).
      if (hasUserMessageId(state, m.messageId)) {
        continue
      }
      appendEvent(state, {
        type: 'user_message',
        answerToMessageId: m.answerToMessageId,
        message: m.message,
        messageId: m.messageId,
        sentAt: m.sentAt,
        sentFrom: m.sentFrom,
        timestamp: nowIso(),
        uploadedAssets: m.uploadedAssets,
      })
    }
  })

  // -- Confirm (refinement -> lock) (decision-worthy) --
  setHandler(confirmSignal, (payload) => {
    recordActionToClaim(state, payload?.actionId)
    if (dedup(state, payload?.actionId)) {
      return
    }
    appendEvent(state, {
      type: 'user_confirm',
      actionId: payload?.actionId,
      timestamp: nowIso(),
    })
  })

  // -- confirm_fast (script_review -> skip HITL; API already started the fast
  //    downstream workflow). Workflow behavior == confirm: lock + closing. --
  setHandler(confirmFastSignal, (payload) => {
    recordActionToClaim(state, payload?.actionId)
    if (dedup(state, payload?.actionId)) {
      return
    }
    appendEvent(state, {
      type: 'user_confirm',
      actionId: payload?.actionId,
      fast: true,
      timestamp: nowIso(),
    })
  })

  // -- Continue draft (decision-worthy) --
  setHandler(continueUipDraftSignal, (payload) => {
    recordActionToClaim(state, payload.actionId)
    if (dedup(state, payload.actionId)) {
      return
    }
    // Gate-token validation: drop only a genuinely STALE (non-empty, mismatched)
    // token from an old tab. In the new protocol the API dispatches continue
    // server-side and does NOT carry a token (review_gate.token is not persisted
    // to the DB -- persistPayload omits it and writeReviewGateToken is unused),
    // so payload.gateToken is empty; that path must pass. V1 enforces no token
    // here at all (it drops continue only by phase, not token), and staleness in
    // V2 is already covered by forward-only advancePhase + actionId dedup.
    const currentToken = foldCurrentGateToken(state.events)
    if (payload.gateToken && currentToken !== null && currentToken !== payload.gateToken) {
      return
    }
    appendEvent(state, {
      type: 'user_continue_draft',
      actionId: payload.actionId,
      gateToken: payload.gateToken,
      timestamp: nowIso(),
    })
  })

  // -- Script review update (passive: writes working_script; deadline reset) --
  setHandler(scriptReviewUpdateSignal, (payload) => {
    appendEvent(state, {
      type: 'user_script_review_update',
      gateToken: payload.gateToken,
      globalConstraints: payload.globalConstraints,
      requestId: payload.requestId,
      script: payload.script,
      timestamp: nowIso(),
    })
  })

  // -- GUI update (passive: working_script.script edit; deadline reset) --
  setHandler(guiUpdateSignal, (payload) => {
    // Summary-edit lock race guard. The API preflight (uip-send-summary-update.ts)
    // 409s a summary edit once the persisted phase reaches bootstrap_visual, but
    // that check and this signal are not atomic -- the phase can fold to
    // bootstrap_visual (or the session can lock) between the preflight passing and
    // the signal landing here. Re-check from the folded event log and drop only
    // globalConstraints (not the whole event): only the summary payload is stale,
    // so the transcript path and the deadline reset are left untouched.
    const phase = foldPhase(state.events)
    const pastVisualLock = phase === 'bootstrap_visual' || phase === 'refinement' || state.isLocked
    // `globalConstraints` is deliberately NOT set here any more: the
    // summary fields ride the spec_patched below, so there is exactly one carrier
    // and one provenance. The field stays on the event TYPE, and
    // `mergeGlobalConstraints` stays in the activity fold, because event logs
    // written before this change still carry it and must fold unchanged.
    appendEvent(state, {
      type: 'user_gui_update',
      requestId: payload.requestId,
      timestamp: nowIso(),
      transcript: payload.transcript,
    })
    // The summary fields are a real spec mutation, so they travel as a
    // `spec_patched` -- the same shape setStyleSignal uses. Without this they
    // are merged straight onto the spec by the fold (mergeGlobalConstraints), which
    // bypasses applyPatch and writes no spec_history entry, so a manual edit is
    // invisible as a patch to everything downstream.
    //
    // `eventCountsAsDecision` counts spec_patched only when `source === 'planner'`,
    // so this cannot change the wake predicate; and a batch containing
    // `user_gui_update` is already non-transient (TRANSIENT_EVENT_TYPES in
    // folds.ts), so both events ride the same persist tick.
    //
    // Only guiUpdateSignal gets this: its payload type is exactly
    // { directives, must_not_violate, topic }, all three in patch-apply's
    // ALLOWED_GLOBAL_PATHS. scriptReviewUpdateSignal (the old-protocol path;
    // new-protocol updateScriptReview signals uip-gui-update instead) takes a wide
    // Partial<GlobalConstraints>, where one non-allowlisted path would make
    // applyPatch reject the WHOLE patch and silently drop the edit.
    const ops = buildSummaryPatchOps(pastVisualLock ? undefined : payload.globalConstraints)
    if (ops.length > 0) {
      appendEvent(state, {
        type: 'spec_patched',
        ops,
        source: 'user_signal',
        specVersionAfter: foldSpecVersion(state.events) + 1,
        timestamp: nowIso(),
      })
    }
  })

  // -- Auto-continue flip (passive: foldAutoContinueEnabled takes the latest;
  //    deadline reset so flipping back ON arms a fresh delay) --
  setHandler(setAutoContinueSignal, (payload) => {
    appendEvent(state, {
      type: 'user_auto_continue_changed',
      enabled: payload.enabled === true,
      requestId: payload.requestId,
      timestamp: nowIso(),
    })
  })

  // -- Transition video model selection (passive; folded into SessionState so
  //    model-specific planners read the latest UI choice) --
  setHandler(setTransitionVideoModelSignal, (payload) => {
    const trimmed =
      typeof payload.transitionVideoModel === 'string'
        ? payload.transitionVideoModel.trim() || undefined
        : undefined
    appendEvent(state, {
      type: 'user_transition_video_model_changed',
      requestId: payload.requestId,
      timestamp: nowIso(),
      transitionVideoModel: trimmed,
    })
  })

  // -- Explicit user style switch (Task 9; passive) --
  // Unlike scriptReviewUpdateSignal (which only merges into the activity-side
  // folded global_constraints via a `user_script_review_update` event -- never
  // a spec_patched), this MUST append a REAL spec_patched: the auto-style
  // re-selection gate (foldStyleSource in start-auto-style-child.ts) reads
  // style_source only from spec_patched update_global_field ops. Both `style`
  // (whole object) and `style_source` land in ONE atomic spec_patched (same
  // shape maybeSeedFallbackStyle in phase-machine.ts uses) so a partial apply
  // can't split them; patch-apply's ALLOWED_GLOBAL_PATHS already allowlists
  // both paths (select_auto_style's auto-apply writes the same fields).
  setHandler(setStyleSignal, (payload) => {
    // Visual-render lock race guard. The API preflight (uip-set-style.ts) rejects
    // a switch with 409 once the session passes the visual-render lock, but that
    // check and this signal are not atomic: the phase can advance into
    // bootstrap_visual (or the session can lock) in the window after the preflight
    // passed and before the signal lands here. Re-check the lock from the folded
    // event log and DROP the patch (no-op) rather than rewrite a
    // style already baked into the render pipeline. Mirrors the backend condition:
    // folded phase at/after bootstrap_visual (rank >= bootstrap_visual: only
    // bootstrap_visual / refinement qualify), or the session is locked.
    const phase = foldPhase(state.events)
    if (phase === 'bootstrap_visual' || phase === 'refinement' || state.isLocked) {
      return
    }
    const ops: PatchOp[] = [
      {
        op: 'update_global_field',
        path: 'style',
        value: {
          style_name: payload.styleName,
          style_text: payload.styleText,
          style_thumbnail_url: payload.styleThumbnailUrl,
        },
      },
      { op: 'update_global_field', path: 'style_source', value: 'auto_switched' },
    ]
    appendEvent(state, {
      type: 'spec_patched',
      ops,
      source: 'user_signal',
      specVersionAfter: foldSpecVersion(state.events) + 1,
      timestamp: nowIso(),
    })
  })

  // -- Cancel session (decision-worthy: wakes loop -> cancel fast-path) --
  setHandler(cancelSessionSignal, (payload) => {
    recordActionToClaim(state, payload.actionId)
    if (dedup(state, payload.actionId)) {
      return
    }
    appendEvent(state, {
      type: 'user_cancel',
      actionId: payload.actionId,
      gateToken: payload.gateToken,
      timestamp: nowIso(),
    })
  })

  // -- Cancel one running tool by name (decision-worthy: wakes loop -> tool-cancel fast-path) --
  setHandler(cancelToolSignal, (payload) => {
    recordActionToClaim(state, payload.actionId)
    if (dedup(state, payload.actionId)) {
      return
    }
    appendEvent(state, {
      type: 'user_cancel_tool',
      actionId: payload.actionId,
      timestamp: nowIso(),
      toolName: payload.toolName,
    })
  })

  // -- Cancel queued item (passive legacy) --
  setHandler(cancelQueuedItemSignal, (payload) => {
    appendEvent(state, {
      type: 'user_cancel_queued_item',
      queuedItemId: payload.queuedItemId,
      timestamp: nowIso(),
    })
  })

  // -- Wake (new protocol, decision-worthy). Skip a duplicate trailing wake. --
  setHandler(wakeSignal, () => {
    if (!isLastUnprocessedWake(state.events, state.processedDecisionCount)) {
      appendEvent(state, { type: 'user_wake', timestamp: nowIso() })
    }
  })

  // -- Pre-voiceover child -> parent. script_ready is decision-worthy;
  //    artifacts_ready is passive (canonical voiceOverPath update). --
  setHandler(preVoiceoverScriptReadySignal, (payload) => {
    state.preVoiceoverReadyPayload = payload
    state.preVoiceoverScriptReady = true
    appendEvent(state, {
      type: 'pre_voiceover_script_ready',
      audioDurationSeconds: payload.audioDurationSeconds,
      scriptText: payload.scriptText,
      timestamp: nowIso(),
      transcriptPath: payload.transcriptPath,
    })
  })

  setHandler(preVoiceoverArtifactsReadySignal, (payload) => {
    state.preVoiceoverArtifactsPayload = payload
    state.preVoiceoverArtifactsReady = true
    appendEvent(state, {
      type: 'pre_voiceover_artifacts_ready',
      audioDurationSeconds: payload.audioDurationSeconds,
      timestamp: nowIso(),
      transcriptPath: payload.transcriptPath,
      voiceOverPath: payload.voiceOverPath,
    })
  })

  // Music beat-sheet readiness. Decision-worthy: gates the
  // script_review -> bootstrap_visual transition for music sessions and folds
  // into spec.meta.music_beat_sheet_status for the VS tool's beat-locked vs
  // ASR-timing choice.
  setHandler(musicBeatSheetSignal, (payload) => {
    appendEvent(state, {
      type: 'music_beat_sheet',
      reason: payload.reason,
      status: payload.status,
      timestamp: nowIso(),
    })
  })

  // -- Tool lifecycle (child -> parent). All decision-worthy; handler removes
  //    the active-call entry and appends the outcome directly to the log. --
  setHandler(toolCompletedSignal, (payload) => {
    state.activeToolCalls.delete(payload.toolCallId)
    appendEvent(state, {
      type: 'tool_completed',
      completedAt: nowIso(),
      durationMs: payload.durationMs,
      output: payload.output,
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
    })
  })

  setHandler(toolFailedSignal, (payload) => {
    state.activeToolCalls.delete(payload.toolCallId)
    appendEvent(state, {
      type: 'tool_failed',
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
      failedAt: nowIso(),
      // Present only on a soft failure that staged a partial artifact; foldSession
      // stages it so the planner can inspect the partial result.
      output: payload.output,
      retryable: payload.retryable,
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
    })
  })

  setHandler(toolCancelledSignal, (payload) => {
    state.activeToolCalls.delete(payload.toolCallId)
    appendEvent(state, {
      type: 'tool_cancelled',
      cancelledAt: nowIso(),
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
    })
  })

  // Child -> parent: an in-flight progress milestone (V1 appendProgressReply
  // parity). Appended as a PASSIVE assistant_message (not decision-worthy, so it
  // does not wake the planner while the tool is still in flight) tagged with the
  // child workflow id. Deduped by (childWorkflowId, content): the activity that
  // emits these can be retried and would re-send the same milestone.
  setHandler(childProgressMessageSignal, (payload) => {
    const duplicate = state.events.some(
      (e) =>
        e.type === 'assistant_message' &&
        e.child_id === payload.childWorkflowId &&
        e.content === payload.content,
    )
    if (duplicate) {
      return
    }
    appendEvent(state, {
      type: 'assistant_message',
      child_id: payload.childWorkflowId,
      content: payload.content,
      messageId: uuid4(),
      phase: foldPhase(state.events),
      specVersion: foldSpecVersion(state.events),
      timestamp: nowIso(),
    })
  })

  // Child -> parent: substep progress of an in-flight tool (subTools display).
  // Appended as a PASSIVE, TRANSIENT tool_substep event: never wakes the
  // planner, and the sync loop publishes it without persisting (sub_tools is
  // stripped from every persisted payload). The payload carries the child
  // workflow id (the activity does not know its toolCallId); resolving via
  // activeToolCalls also drops late signals after tool completion. Deduped by
  // (toolCallId, substep, status): the emitting activity can be retried.
  setHandler(toolSubstepSignal, (payload) => {
    let toolCallId: null | string = null
    for (const [id, info] of state.activeToolCalls) {
      if (info.childWorkflowId === payload.childWorkflowId) {
        toolCallId = id
        break
      }
    }
    if (toolCallId == null) {
      return
    }
    const resolvedToolCallId = toolCallId
    const duplicate = state.events.some(
      (e) =>
        e.type === 'tool_substep' &&
        e.toolCallId === resolvedToolCallId &&
        e.substep === payload.substep &&
        e.status === payload.status,
    )
    if (duplicate) {
      return
    }
    appendEvent(state, {
      type: 'tool_substep',
      status: payload.status,
      substep: payload.substep,
      toolCallId: resolvedToolCallId,
      toolName: payload.toolName,
    })
  })

  // -- Brand extraction (registered only when the session gate is on). --
  if (params.brandExtractionEnabled) {
    registerBrandSignalHandlers(state)
  }
}

/**
 * Brand signal handlers. child->parent ready/failed capture the payload + append
 * a decision-worthy marker (the loop applies the seed/fail ops as spec_patched
 * before the planner turn). confirmBrandReview validates the gate token then
 * captures the lock+edits payload + appends user_confirm_brand_review.
 * brandBriefSubmit captures the input payload + surfaces a transcript message so
 * the planner turn runs once the input ops land.
 *
 * NOTE: standalone Tier-1 `brandBankEdit` live edits are deferred -- the primary
 * edit path is confirmBrandReview.edits (applied atomically with the lock).
 */
function registerBrandSignalHandlers(state: WorkflowState): void {
  setHandler(brandExtractionReadySignal, (payload) => {
    state.brandReadyPayload = payload
    appendEvent(state, {
      type: 'brand_extraction_ready',
      runId: payload.runId,
      timestamp: nowIso(),
    })
  })

  setHandler(brandExtractionFailedSignal, (payload) => {
    state.brandFailedPayload = payload
    appendEvent(state, {
      type: 'brand_extraction_failed',
      reason: payload.reason,
      runId: payload.runId,
      timestamp: nowIso(),
    })
  })

  setHandler(confirmBrandReviewSignal, (payload) => {
    // Gate-token validation: silently drop a stale token (old tab / duplicate
    // click) -- mirrors V1 isActiveReviewGateToken.
    if (foldCurrentGateToken(state.events) !== payload.gateToken) {
      return
    }
    state.pendingBrandConfirm = payload
    appendEvent(state, {
      type: 'user_confirm_brand_review',
      gateToken: payload.gateToken,
      timestamp: nowIso(),
    })
  })

  setHandler(brandBriefSubmitSignal, (payload) => {
    state.pendingBrandBrief = payload
    // Surface the submission as a user message so the planner turn runs after
    // the loop applies the input ops (mirrors V1 appendBrandBriefUserMessage).
    const content =
      payload.input.kind === 'url'
        ? `Here's my brand site: ${payload.input.url}`
        : `Here's about my brand: ${payload.input.text}`
    appendEvent(state, {
      type: 'user_message',
      answerToMessageId: payload.answerToMessageId,
      message: content,
      messageId: `brand-brief-${state.events.length}`,
      timestamp: nowIso(),
      uploadedAssets: payload.uploadedAssets,
    })
  })
}
