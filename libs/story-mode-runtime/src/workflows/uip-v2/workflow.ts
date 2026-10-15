/**
 * UipSessionV2Workflow -- the UIP V2 event-driven session workflow.
 *
 * Architecture: the append-only `AgentEvent[]` log is the source of truth. The
 * MAIN LOOP waits (condition) for a decision-worthy event, runs ONE planner step
 * (plannerStepActivity) + executes the decision, and appends events -- it never
 * persists inline and holds no timer. A concurrent BACKGROUND sync loop owns
 * persistence + the auto-continue/auto-lock deadline timer (see sync-loop.ts).
 *
 * Imports stay light: EVERY import from `@reelmakeeasy/uip-planner-runtime` is
 * `import type` ONLY. The idle-timeout constant is mirrored locally rather than
 * value-imported. The heavy foldSession projection lives in activities; the
 * workflow only passes `events` + `currentArtifacts` through.
 *
 * Ids come from the parent/uuid4 (in executeDecision / phase machine); time from
 * the global `Date.now()`.
 */

import {
  API_INBOX_WORKFLOW_PROTOCOL_SINCE,
  supportsWorkflowProtocolFeature,
} from '@reelmakeeasy/common/uip/protocol-version'
import { BRAND_REVIEW_READY_MESSAGE } from '@reelmakeeasy/common/uip-runtime-messages'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import type { PlannerPhase, UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import {
  CancellationScope,
  condition,
  continueAsNew,
  getExternalWorkflowHandle,
  isCancellation,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import type { PlannerStepFn } from './activity-proxies'
import {
  claimNextActionActivity,
  cleanupPlannerChainActivity,
  createCheckDeadlineExpiredProxy,
  createPersistProxy,
  createPlannerStepProxy,
  createTriggerNextActionProxy,
} from './activity-proxies'
import { buildInitialSpec } from './build-initial-spec'
import { toolRunnerCancelSignal } from './channels'
import { compactEvents, shouldContinueAsNew } from './compaction'
import { continueAsNewSignals } from './continue-as-new-signals'
import { appendEvent, nextMessageId } from './event-log'
import {
  brandStatus,
  consecutivePlannerPatchWakes,
  countDeadlineExtends,
  countDecisionWorthy,
  findLast,
  foldCurrentGateToken,
  foldPhase,
  gateDeadlineNeedsDispatch,
  hasAudio,
  hasBrandAutoStartUrlCandidate,
  hasBrandInput,
  hasUnprocessedCancel,
  hasUnprocessedDecisionEvent,
  isAwaitingMusicBeatSheet,
  isOnlyUnprocessedMusicBeatSheet,
  MAX_AUTO_EXTENDS,
  openToolStartedEvents,
  seededEditableBrandReview,
  shouldSkipPlannerForMusicBeatSheet,
} from './folds'
import { shouldWakeMainLoop } from './main-loop-gating'
import { newProtocolWakeAction, toolCancelDirective } from './main-loop-steps'
import {
  handleSessionLock,
  openReviewGate,
  reviewGateToOpen,
  shouldTerminateByLock,
} from './phase-machine'
import { advancePhase } from './phase-machine'
import { currentSpecVersion, nowIso } from './planner-turn-helpers'
import { computeExitStatus, logTermination } from './session-termination'
import { registerAllQueryHandlers, registerAllSignalHandlers } from './signal-handlers'
import { maybeStartAutoStyleChild, maybeStartAutoStyleChildEarly } from './start-auto-style-child'
import { startPreVoiceoverChild } from './start-pre-voiceover-child'
import { isTerminal } from './state-util'
import { sessionSyncLoop } from './sync-loop'
import type { AgentEvent, ContinueAsNewParams, WorkflowState } from './types'
import {
  articleDoorEngaged,
  maybeClassifyPastedUrl,
  maybeRunArticleExtraction,
  newsDoorBlocksBrandAutoStart,
  urlRouteBlocksBrandAutoStart,
} from './workflow-article'
import {
  applyBrandOps,
  maybeFoldSavedBriefUploads,
  maybeReExtractBrandChild,
  maybeStartBrandChild,
} from './workflow-brand'
import { runPlannerTurn } from './workflow-planner-turn'

/**
 * Idle timeout (3h). Mirrored from V1 `SHORTENED_SESSION_IDLE_TIMEOUT_MS`
 * (libs/uip-planner-runtime/src/workflow-types.ts). Defined locally so this
 * workflow file never value-imports `@reelmakeeasy/uip-planner-runtime`. V2
 * always uses 3h.
 */
const SHORTENED_SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000

/**
 * V2 workflow result. Adds 'cancelled' to the V1 status union (the V1
 * `UipSessionWorkflowResult` omits it); defined locally so V1 is untouched.
 */
export interface UipSessionV2WorkflowResult {
  projectId: string
  status: 'cancelled' | 'completed' | 'failed' | 'timed_out'
}

/** The UIP V2 session workflow entry point (see file header for the design). */
export async function UipSessionV2Workflow(
  params: UipSessionWorkflowParams,
): Promise<UipSessionV2WorkflowResult> {
  // 1. Initialize (fresh, or restore from a continueAsNew handoff).
  const state = initWorkflowState(params)
  const { taskQueue } = workflowInfo()
  setWorkflowScopedContext({ projectId: params.projectId, userId: params.userId })

  // 2-3. Register signal + query handlers (handlers append directly to the log).
  registerAllSignalHandlers(state, params)
  registerAllQueryHandlers(state)

  // 4. Inject the initial message (fresh start only; a handoff already carries it).
  const restored = (params as ContinueAsNewParams)._v2CompactedEvents != null
  if (params.initialMessage && !restored) {
    appendEvent(state, {
      type: 'user_message',
      message: params.initialMessage,
      messageId: params.initialMessageId ?? '__initial_message__',
      sentAt: params.initialMessageSentAt,
      timestamp: nowIso(),
      uploadedAssets: params.uploadedAssets,
    })
  }

  // 5. Pre-voiceover child start (audio sessions). Fresh start only -- the
  //    ABANDON child survives a continueAsNew handoff, so a restored run must
  //    not start a second one.
  if (params.audioPath && !restored) {
    await startPreVoiceoverChild(params)
  }

  const planner = createPlannerStepProxy(taskQueue)
  const persist = createPersistProxy(taskQueue)

  // 6. Start the background sync loop (persist + deadline timer), concurrent
  //    with the main loop. Must be after all setHandler calls. persist is a
  //    REGULAR activity that runs concurrently with the main loop's local
  //    activities.
  const syncPromise = sessionSyncLoop(state, params, persist.projectAndPersistActivity)

  // 7. Main loop -- append-only; no inline persist, no deadline branch. Each
  //    iteration's body lives in runMainLoopIteration; this shell only waits for
  //    a decision-worthy event and dispatches the returned directive.
  try {
    while (!isTerminal(state)) {
      // 7a. Wait for a decision-worthy event; timeout = idle timeout.
      const fired = await condition(() => shouldWakeMainLoop(state), state.idleTimeoutMs)
      if (!fired) {
        handleIdleTimeout(state)
        logTermination(params, state, 'idle_timeout')
        break
      }

      const directive = await runMainLoopIteration(
        state,
        planner.plannerStepActivity,
        params,
        taskQueue,
      )
      if (directive === 'break') {
        break
      }
      if (directive === 'continue-as-new') {
        state.mainLoopDone = true
        await syncPromise
        return await compactAndContinue(state, params)
      }
    }

    // 8. Main loop ended (lock / cancel / idle / audio-exit): flush terminal
    //    state via the background loop, then clean up the orphaned chain.
    state.mainLoopDone = true
    await syncPromise
    await maybeCleanupPlannerChain(state, params.projectId)
    return { projectId: params.projectId, status: computeExitStatus(state) }
  } catch (err) {
    if (isCancellation(err)) {
      // External cancel: swallow the background loop's CancelledFailure,
      // then do a nonCancellable terminal persist fallback.
      state.isCancelled = true
      state.mainLoopDone = true
      logTermination(params, state, 'external_cancel')
      await syncPromise.catch(() => undefined)
      await CancellationScope.nonCancellable(async () => {
        await persist.projectAndPersistActivity({
          cancelled: true,
          currentArtifacts: state.currentArtifacts,
          events: state.events,
          projectId: params.projectId,
          // The sync loop exits without its terminal flush on external cancel,
          // so this fallback owns the once-per-session event_log dump.
          writeEventLog: true,
        })
        await maybeCleanupPlannerChain(state, params.projectId)
      })
      return { projectId: params.projectId, status: 'cancelled' }
    }
    throw err
  }
}

/**
 * Claim (clear) the API's nextAction records for dispatched actions the workflow
 * has durably received. Local activity awaited sequentially (never concurrently
 * with another local activity). Best-effort: claimNextActionActivity is
 * idempotent and already retries; a final failure is swallowed so it never
 * bricks the loop (the record is a stale-state cleanup, not load-bearing for the
 * event log).
 */
async function claimDispatchedActions(state: WorkflowState, projectId: string): Promise<void> {
  if (state.actionIdsToClaim.length === 0) {
    return
  }
  const ids = state.actionIdsToClaim.splice(0)
  for (const actionId of ids) {
    await claimNextActionActivity({ actionId, projectId }).catch(() => undefined)
  }
}

/** Lowercase alias to match the V1 export convention (workflows.ts re-exports both). */
export const uipSessionV2Workflow = UipSessionV2Workflow

type MainLoopDirective = 'break' | 'continue-as-new' | 'loop'

/**
 * Route a fired gate-phase deadline through the API and return whether it was
 * dispatched (the caller then loops). The sync-loop timer already decided to fire
 * (busy-defer + cap applied), but the side effects are owned by the API, not the
 * workflow:
 *   - refinement -> intent=confirm: executeConfirmOrchestration starts story-mode,
 *     sets uipSession.lockedAt, signals uip-confirm back -> the
 *     lock lands via 7b on the next wake. We must NOT self-lock (the persist would
 *     set lockedAt and the orchestration would short-circuit -> no video-gen).
 *   - script_review -> intent=continue: runs the same continue orchestration as
 *     the "Create video" click and signals uip-continue-draft back ->
 *     advancePhase advances to bootstrap_visual on the next wake.
 * Mirrors V1's checkDeadlineExpiredActivity. force: the timer already applied
 * busy-defer + cap, so the API must dispatch now, not re-extend against its own
 * persisted deadline (which races the concurrent sync-loop persist). We consume
 * the boundary first so the loop does not spin on the still-pending
 * deadline_expired (the inbound uip-confirm / uip-continue-draft is the next
 * decision-worthy event that re-wakes us, and supersedes the pending deadline).
 * Re-dispatch is idempotent (orchestration skips once lockedAt is set; the
 * continue marker skips when continuedAt is set).
 */
async function routeGateDeadline(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  taskQueue: string,
): Promise<boolean> {
  const phase = foldPhase(state.events)
  // brand_review: unlike refinement/script_review -- whose deadlines
  // carry API side effects (orchestration) and route through the
  // API -- a brand_review confirm has none, so we self-append the same event a
  // manual confirm produces; advancePhase then routes brand_review ->
  // bootstrap_script. Deliberately NOT the explicit "Confirm + Save" (saving is a
  // user action). The deadline only fires for a seeded editable review
  // (foldDeadline gates on that), so this is inert for fresh-extraction reviews.
  if (phase === 'brand_review') {
    if (
      !seededEditableBrandReview(state.events) ||
      !gateDeadlineNeedsDispatch(state.events) ||
      openToolStartedEvents(state.events).length > 0
    ) {
      return false
    }
    state.processedDecisionCount = countDecisionWorthy(state.events)
    appendEvent(state, {
      gateToken: foldCurrentGateToken(state.events) ?? '',
      type: 'user_confirm_brand_review',
    })
    appendEvent(state, { phase: 'brand_review', type: 'gate_deadline_dispatched' })
    return true
  }
  if (
    (phase !== 'refinement' && phase !== 'script_review') ||
    !gateDeadlineNeedsDispatch(state.events) ||
    openToolStartedEvents(state.events).length > 0
  ) {
    return false
  }
  state.processedDecisionCount = countDecisionWorthy(state.events)
  const { checkDeadlineExpiredActivity } = createCheckDeadlineExpiredProxy(taskQueue)
  const decision = await checkDeadlineExpiredActivity({
    force: true,
    intent: phase === 'refinement' ? 'confirm' : 'continue',
    projectId: params.projectId,
  })
  // The Mongo fallback found activity that won the API session lock. Re-arm from
  // workflow receipt time: this may be later than the exact server-stamped
  // deadline when signalling failed, but it can never dispatch earlier than the
  // full inactivity window. Activity is user-owned, so it bypasses the automatic
  // extension cap and must not emit dispatch markers.
  if (decision.action === 'activity') {
    appendEvent(state, {
      kind: 'operate',
      timestamp: nowIso(),
      type: 'user_activity',
    })
    return true
  }
  // extend => the API did NOT dispatch (no uip-continue-draft / uip-confirm
  // signal-back is coming). The old code
  // appended gate_deadline_dispatched regardless and then waited forever for a
  // signal that never arrives, silently stranding the gate. V1 instead re-arms the
  // deadline so the gate retries (turn-executor.ts). Mirror that: append a
  // deadline_extended (a foldDeadline reset) so the timer fires again after the
  // delay and re-dispatches. Bounded by MAX_AUTO_EXTENDS (shared with busy-defer)
  // so a session can't retry forever -- which would also keep the main loop
  // waking every delay and never idle-timing-out. Past the cap (or on
  // continue/confirm) fall back to gate_deadline_dispatched: stop the timer and
  // wait for the signal-back / the user.
  const rearm =
    decision.action === 'extend' && countDeadlineExtends(state.events) < MAX_AUTO_EXTENDS
  if (rearm) {
    appendEvent(state, { phase, type: 'deadline_extended' })
  } else {
    // Explicit dedup marker: record that this deadline was routed to the API so the
    // signal-back (uip-continue-draft / uip-confirm) can't make us re-dispatch.
    // Appended AFTER the await so it sits after any signal-back the activity already
    // produced -> the next gateDeadlineNeedsDispatch scan hits it first and stops.
    appendEvent(state, { phase, type: 'gate_deadline_dispatched' })
  }
  return true
}

/**
 * 7f.2 Whether the bootstrap_script planner turn must be held until
 * the ASR script is seeded, so generate_intent_context is never dispatched into
 * an empty working_script. Holds ALL audio (incl. audio_music) so the brief
 * grounds on the transcript instead of reading the filename as the topic.
 * Released by working_script_seeded (fired even for an empty/instrumental
 * transcript) or pre-voiceover failure.
 */
function shouldHoldForScriptSeed(state: WorkflowState): boolean {
  const inBootstrapPreSeed =
    foldPhase(state.events) === 'bootstrap_script' &&
    !state.events.some((e) => e.type === 'working_script_seeded')
  if (!inBootstrapPreSeed) {
    return false
  }
  return hasAudio(state.events) && !state.preVoiceoverChildFailureMessage
}

/**
 * One main-loop iteration body (design steps 7b-7j). Returns a directive the
 * loop shell acts on: 'break' (terminal: cancel / lock / audio-exit),
 * 'continue-as-new' (history handoff), or 'loop' (keep iterating).
 */
async function runMainLoopIteration(
  state: WorkflowState,
  plannerStepActivity: PlannerStepFn,
  params: UipSessionWorkflowParams,
  taskQueue: string,
): Promise<MainLoopDirective> {
  // triggerNextActionActivity is a REGULAR activity (see createTriggerNextActionProxy):
  // only regular activities get the ReqCtx header forwarded by the interceptor, so
  // the internal /trigger-next-action call runs with the real user context.
  const { triggerNextActionActivity } = createTriggerNextActionProxy(taskQueue)

  // 7a.1 Claim the API's nextAction records for actions we have now durably
  //      received (new protocol). Releases the at-least-once guard so a later
  //      action (e.g. continue) is not rejected by evaluateActionIntentGuards as
  //      a conflicting pending nextAction. Mirrors V1 run-planner-turn claimAction.
  await claimDispatchedActions(state, params.projectId)

  // 7b. Termination triggers (symmetric with cancel; not in advancePhase):
  //     user_cancel (any phase) -> cancel fast-path; refinement confirm /
  //     still-expired deadline -> explicit / auto lock.
  if (hasUnprocessedCancel(state.events, state.processedDecisionCount)) {
    await handleCancelFastPath(state)
    logTermination(params, state, 'user_cancel')
    return 'break'
  }

  // 7b.2 + 7c.1 Per-tool cancel: a user_cancel_tool cancels
  // the matching tool child(ren), and the child's tool_cancelled report-back then
  // pauses the planner -- the session stays alive (contrast 7b's whole-session
  // cancel). Both boundaries are consumed here; see toolCancelDirective
  // (main-loop-steps.ts) for the rationale.
  if ((await toolCancelDirective(state)) === 'loop') {
    return 'loop'
  }

  // M2 fix: pass processedDecisionCount so only genuinely unprocessed events
  // are checked (prevents a previously-handled user_confirm from re-triggering
  // lock on the next wake when using unprocessedSincePhase).
  if (shouldTerminateByLock(state, state.processedDecisionCount)) {
    handleSessionLock(state, params.projectId, state.processedDecisionCount)
    logTermination(params, state, 'lock')
    return 'break'
  }

  // 7b.1 Gate-phase deadline -> route the action through the API, or self-continue
  // a seeded brand_review (no API side effects). See routeGateDeadline.
  if (await routeGateDeadline(state, params, taskQueue)) {
    return 'loop'
  }

  // 7c. New-protocol wake: consume it and nudge the API to send the authoritative
  //     next action -- but never while a tool is in flight (the queued message
  //     stays in the inbox until the tool completes; the idle nudge (7j) pulls it
  //     later). The DECISION is a sync helper; triggerNextActionActivity is awaited
  //     INLINE here (see newProtocolWakeAction).
  const wakeAction = newProtocolWakeAction(state)
  if (wakeAction !== 'skip') {
    state.processedDecisionCount = countDecisionWorthy(state.events)
    if (wakeAction === 'nudge') {
      await triggerNextActionActivity({ projectId: params.projectId })
    }
    return 'loop'
  }

  // 7d. Advance the consumption boundary (this turn handles up to here).
  // Capture, BEFORE advancing the boundary + advancePhase, whether the
  // only newly-unprocessed decision events are music_beat_sheet signals and the
  // current phase -- so 7f.4 can skip a no-op planner turn when such a signal
  // lands without moving the phase (the common pre-CTA case).
  const onlyMusicBeatSheetWasNew = isOnlyUnprocessedMusicBeatSheet(
    state.events,
    state.processedDecisionCount,
  )
  const phaseBeforeAdvance = foldPhase(state.events)
  state.processedDecisionCount = countDecisionWorthy(state.events)

  // 7d.1 Brand machine state (child ready/failed, confirm-review lock+edits):
  //      apply the named ops as spec_patched BEFORE advancePhase so the
  //      brand_bank is in the spec when the phase transitions to brand_review
  //      and the lock lands before brand_review -> bootstrap_script.
  await applyPendingBrandState(state)

  // 7d.2a Article auto-start. Runs
  //      BEFORE the brand auto-start and, when the article door is engaged
  //      (gate on + entry_use_case = news-article-to-video),
  //      the brand auto-start below is short-circuited -- the entry door
  //      decides the article-vs-brand collision for a pasted URL (v1 product
  //      default). All guards are cheap in-process folds; the extraction
  //      itself is awaited inline so the planner's first grounded turn reads
  //      the article.
  // 7d.0 Pasted-URL router: for main-box sessions
  //      (entry_use_case != news), classify a pasted link as article vs brand
  //      BEFORE either door fires. A confident article verdict opens the
  //      article door (articleDoorEngaged ORs it in); a confident brand
  //      verdict leaves 7d.2 untouched; an uncertain verdict parks both doors
  //      while the planner asks the user (re-classified on their reply).
  await maybeClassifyPastedUrl(state, params)
  await maybeRunArticleExtraction(state, params)

  // 7d.2 Brand auto-start (v1 parity for
  //      maybeAutoStartBrandExtractionFromPrompt): the RUNTIME -- never the
  //      planner -- sets brand_extraction_input from a promoted-business URL in
  //      the user's messages, and a URL matching a staged carry applies the
  //      carry instead (no re-extraction). Runs before advancePhase so a
  //      same-source carry apply (status 'completed') routes
  //      mode_confirmation -> ... -> brand_review in this same wake. ALL
  //      guards here are cheap in-process folds -- including the URL-candidate
  //      pre-check: without it every brand-enabled
  //      session scheduled a no-op LOCAL activity on every mode_confirmation
  //      wake. The activity's full detector on the folded spec stays
  //      authoritative for what actually counts as a brand URL.
  if (
    // News-door sessions route the pasted URL to article extraction instead
    // (7d.2a).
    !articleDoorEngaged(state) &&
    // ...and they must not fall THROUGH to the brand door when the article
    // gate reads false (it is pinned at session creation): the news entry is
    // statically Story Mode, so without this the pasted article
    // URL gets crawled as the user's brand.
    !newsDoorBlocksBrandAutoStart(state) &&
    // Router verdicts (7d.0): a confident-article or uncertain verdict parks
    // the brand auto-start; error/off behaves exactly like today.
    !urlRouteBlocksBrandAutoStart(state) &&
    state.brandExtractionEnabled &&
    foldPhase(state.events) === 'mode_confirmation' &&
    !hasBrandInput(state.events) &&
    brandStatus(state.events) === null &&
    hasBrandAutoStartUrlCandidate(state.events)
  ) {
    await applyBrandOps(state, { kind: 'auto_start' })
  }

  // 7e + 7f. Forward-only phase progression (mode->bootstrap, tool_completed->next
  //     phase, etc; a transition into a review phase appends phase_changed but does
  //     NOT open the gate -- that happens after the planner reply below), the
  //     deferred-message flush, and the audio pipeline step (seed working_script
  //     from a pre-voiceover script_ready; a child failure is terminal). The
  //     seed runs BEFORE advancePhase so an audio session advances
  //     bootstrap_script -> script_review on the SAME turn the script is seeded;
  //     otherwise the planner (7g) runs in a stale bootstrap_script the recovery
  //     validator rejects ("system-owned phase boundary"), gives up, and the
  //     session idles out -- pre_voiceover_artifacts_ready is passive, so nothing
  //     re-wakes the loop. See advancePhaseWithAudioSeed.
  // advancePhaseWithAudioSeed also resolves the music beat-sheet hold (7f.4)
  // right after advancePhase, returning 'loop' to skip the planner when the music
  // readiness signal is being awaited or just landed without moving the phase.
  // 7d.3 Auto style pick, EARLY dispatch for audio sessions. See
  //      maybeStartAutoStyleChildEarly: their phase advances on the brief's own
  //      tool_completed, so the normal 7g.3 dispatch would miss the window.
  await maybeStartAutoStyleChildEarly(state, params, taskQueue)

  const advanceDirective = advancePhaseWithAudioSeed(
    state,
    params,
    onlyMusicBeatSheetWasNew,
    phaseBeforeAdvance,
  )
  if (advanceDirective !== 'continue') {
    return advanceDirective
  }

  // 7f.1 Never run the planner (or nudge the API for the next action) while a
  //      tool is still in flight. A user_message / wake arriving mid-tool must
  //      NOT start a second planner turn -- it would act on incomplete state and
  //      could dispatch a conflicting / duplicate tool. The in-flight tool's
  //      tool_completed is decision-worthy and re-wakes the loop to plan then.
  if (openToolStartedEvents(state.events).length > 0) {
    return 'loop'
  }

  // 7f.2 Audio mode: hold the bootstrap_script planner turn until the ASR script
  //      is seeded, so generate_intent_context is never dispatched into an empty
  //      working_script. See shouldHoldForScriptSeed.
  if (shouldHoldForScriptSeed(state)) {
    return 'loop'
  }

  // 7f.3 Bound the planner-patch re-wake loop (see shouldHaltPatchSpin):
  //      after too many patch-only turns, skip the planner so the loop settles to
  //      idle instead of spinning.
  if (shouldHaltPatchSpin(state)) {
    return 'loop'
  }

  // 7g. One planner decision (foldSession + buildContext run inside the
  //     activity; the workflow only passes events + light control info).
  if (!isTerminal(state)) {
    await runPlannerTurn(state, plannerStepActivity, params.projectId, taskQueue, params)
  }

  // 7g.0 Open the review gate for a freshly-entered review phase, derived purely
  //      from the event log (reviewGateToOpen). Emitting review_gate_opened AFTER
  //      the planner reply makes the actionable gate button land after its
  //      explanatory message (phase_changed -> assistant_message ->
  //      review_gate_opened). The "since last phase_changed" guard opens it once.
  const gateToOpen = reviewGateToOpen(state.events)
  if (gateToOpen) {
    if (gateToOpen === 'BRAND_REVIEW') {
      // Saved-brief reuse: fold the user's init-prompt uploads into the
      // seeded bank before the review card renders, so they show on the card and
      // feed the video. No-op on the fresh path (it folds on the 'ready' signal).
      await maybeFoldSavedBriefUploads(state)
      // V2 has no V1 transitionToBrandReview to append the proactive review
      // message, and (unlike script_review) the planner prompt has no brand_review
      // entry example, so emit it deterministically here -- before the gate, once
      // per entry (reviewGateToOpen is once-per-entry). V1 parity via the shared
      // const. script_review keeps emitting its message via the planner.
      appendEvent(state, {
        type: 'assistant_message',
        content: BRAND_REVIEW_READY_MESSAGE,
        messageId: nextMessageId(state),
        phase: foldPhase(state.events),
        specVersion: currentSpecVersion(state),
        timestamp: nowIso(),
      })
    }
    openReviewGate(state, gateToOpen)
  }

  // 7g.1 Brand child start: the planner may have just set brand_extraction_input
  //      via PATCH_SPEC. Arm + start the BrandExtractionWorkflow child (idempotent).
  await maybeStartBrandChild(state, params, taskQueue)

  // 7g.2 Brand re-extraction: the planner emitted
  //      change_brand_extraction_source / retry_brand_extraction in brand_review.
  //      v1 re-fired the child here; v2 never did, so the bank reset to pending
  //      but never re-extracted.
  await maybeReExtractBrandChild(state, params)

  // 7g.3 Auto style pick: the RUNTIME -- never the planner -- starts
  //      the select_auto_style tool child once the brief is complete. Placed
  //      HERE, after the planner turn, so it runs CONCURRENTLY with the planner's
  //      generate_explainer_script: both ABANDON children are in flight and the
  //      loop parks at 7f.1 (openToolStartedEvents) until BOTH complete.
  //      Dispatching before the planner turn would serialize them. Self-gated +
  //      idempotent.
  await maybeStartAutoStyleChild(state, params, taskQueue)

  // 7i. continueAsNew handoff (the shell flushes + hands off).
  if (shouldContinueAsNew(state, continueAsNewSignals())) {
    return 'continue-as-new'
  }

  // 7j. New-protocol self-chain: when idle, nudge the API to send the next action.
  await maybeSelfChainNudge(state, params.projectId, triggerNextActionActivity)

  return 'loop'
}

/**
 * 7j self-chain nudge: when idle, nudge the API to send the next action. "Idle" = no
 * unprocessed decision events AND no tool in flight -- the planner may have just
 * dispatched a tool this turn, and pulling the next inbox message now would
 * materialize it instead of leaving it queued (same invariant as 7c / 7f.1). The
 * tool's completion re-wakes the loop, so this nudge fires once the chain finishes.
 */
async function maybeSelfChainNudge(
  state: WorkflowState,
  projectId: string,
  triggerNextActionActivity: (input: { projectId: string }) => Promise<unknown>,
): Promise<void> {
  if (
    state.isNewProtocol &&
    !hasUnprocessedDecisionEvent(state.events, state.processedDecisionCount) &&
    openToolStartedEvents(state.events).length === 0
  ) {
    await triggerNextActionActivity({ projectId })
  }
}

// Cap consecutive planner PATCH_SPEC-only re-wakes (no tool/user
// progress between) so a degraded planner cannot spin the loop. A healthy
// planner realizes on the re-wake, resetting the count well under this bound.
const MAX_CONSECUTIVE_PLANNER_PATCH_WAKES = 3

// Phases where a planner PATCH_SPEC has no realize follow-up -- no tool
// or cascade runs after the patch, so a self-rewake just re-emits the same edit
// (observed: the planner re-set the same brand-bank CTA 3x in
// brand_review). In these the spin guard halts at the FIRST patch; every other
// phase keeps the 3-cap because the rewake there legitimately drives the realize
// step (e.g. bootstrap_visual re-running the visual-script after a brief patch).
const NO_REALIZE_REWAKE_PHASES = new Set<PlannerPhase>(['bootstrap_brand', 'brand_review'])

/**
 * Whether to skip the planner turn because the planner has re-woken on its own
 * patches too many times without realizing them. 7d has already
 * advanced the boundary, so skipping lets condition() settle to idle instead of
 * re-firing.
 *
 * The count resets on a phase advance (so a spin never leaks into the
 * next phase) and brand/mode-setup phases halt at the first patch (no realize
 * follow-up).
 */
function shouldHaltPatchSpin(state: WorkflowState): boolean {
  const wakes = consecutivePlannerPatchWakes(state.events)
  const cap = NO_REALIZE_REWAKE_PHASES.has(foldPhase(state.events))
    ? 1
    : MAX_CONSECUTIVE_PLANNER_PATCH_WAKES
  return wakes >= cap
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initWorkflowState(params: UipSessionWorkflowParams): WorkflowState {
  const can = params as ContinueAsNewParams
  const isNewProtocol = supportsWorkflowProtocolFeature(
    params.workflowProtocolVersion,
    API_INBOX_WORKFLOW_PROTOCOL_SINCE,
  )
  if (can._v2CompactedEvents) {
    // Restore from a continueAsNew handoff. spec is re-derived on the activity
    // side from the carried artifacts; processedDecisionCount is recomputed.
    const events = can._v2CompactedEvents
    return {
      ...baseFlagsFromEvents(events),
      actionIdsToClaim: can._v2ActionIdsToClaim ?? [],
      activeToolCalls: new Map(
        (can._v2ActiveToolCalls ?? []).map((t) => [
          t.toolCallId,
          { childWorkflowId: t.childWorkflowId, startedAt: '', toolName: t.toolName },
        ]),
      ),
      // Params are re-passed verbatim at continueAsNew, so the article gate
      // snapshot needs no _v2 carry field.
      articleExtractionEnabled: params.articleExtractionEnabled ?? false,
      brandExtractionEnabled:
        can._v2BrandExtractionEnabled ?? params.brandExtractionEnabled ?? false,
      brandExtractionPending: can._v2BrandExtractionPending ?? false,
      brandFailedPayload: null,
      brandReadyPayload: null,
      currentArtifacts: can._v2CurrentArtifacts ?? {},
      deferredUserMessages: [],
      events,
      idleTimeoutMs: SHORTENED_SESSION_IDLE_TIMEOUT_MS,
      isNewProtocol,
      mainLoopDone: false,
      pendingBrandBrief: can._v2PendingBrandBrief ?? null, // M1 fix: restore across continueAsNew
      pendingBrandConfirm: null,
      plannerChainGroundingKey: can._v2PlannerChainGroundingKey ?? 'base',
      plannerChainSegment: can._v2PlannerChainSegment ?? 'mode_confirmation',
      plannerModel: can._v2PlannerModel,
      plannerOrphanedChainResponseIds: can._v2PlannerOrphanedChainResponseIds ?? [],
      plannerResponseId: can._v2PlannerResponseId ?? null,
      preVoiceoverArtifactsPayload: null,
      preVoiceoverArtifactsReady: false,
      preVoiceoverChildFailureMessage: can._v2PreVoiceoverChildFailureMessage ?? null,
      preVoiceoverReadyPayload: null,
      preVoiceoverScriptReady: false,
      processedDecisionCount: countDecisionWorthy(events),
      projectId: params.projectId,
      seenActionIds: new Set(can._v2SeenActionIds ?? []),
      workflowProtocolVersion: params.workflowProtocolVersion,
    }
  }

  // Fresh start.
  const events: AgentEvent[] = [buildSessionInitializedEvent(params)]
  return {
    actionIdsToClaim: [],
    activeToolCalls: new Map(),
    articleExtractionEnabled: params.articleExtractionEnabled ?? false,
    brandExtractionEnabled: params.brandExtractionEnabled ?? false,
    brandExtractionPending: false,
    brandFailedPayload: null,
    brandReadyPayload: null,
    currentArtifacts: {},
    deferredUserMessages: [],
    events,
    idleTimeoutMs: SHORTENED_SESSION_IDLE_TIMEOUT_MS,
    isCancelled: false,
    isFailed: false,
    isLocked: false,
    isNewProtocol,
    isTimedOut: false,
    mainLoopDone: false,
    pendingBrandBrief: null,
    pendingBrandConfirm: null,
    plannerChainGroundingKey: 'base',
    plannerChainSegment: 'mode_confirmation',
    plannerModel: undefined,
    plannerOrphanedChainResponseIds: [],
    plannerResponseId: null,
    preVoiceoverArtifactsPayload: null,
    preVoiceoverArtifactsReady: false,
    preVoiceoverChildFailureMessage: null,
    preVoiceoverReadyPayload: null,
    preVoiceoverScriptReady: false,
    processedDecisionCount: countDecisionWorthy(events),
    projectId: params.projectId,
    seenActionIds: new Set(),
    workflowProtocolVersion: params.workflowProtocolVersion,
  }
}

/** Terminal flags re-derived from a (possibly restored) event log. */
function baseFlagsFromEvents(events: AgentEvent[]): {
  isCancelled: boolean
  isFailed: boolean
  isLocked: boolean
  isTimedOut: boolean
} {
  return {
    isCancelled: events.some((e) => e.type === 'session_cancelled'),
    isFailed: events.some((e) => e.type === 'session_failed'),
    isLocked: events.some((e) => e.type === 'session_locked'),
    isTimedOut: events.some((e) => e.type === 'session_timed_out'),
  }
}

// Exported as a test seam (like buildInitialSpec); not imported by other modules.
export function buildSessionInitializedEvent(
  params: UipSessionWorkflowParams,
): Extract<AgentEvent, { type: 'session_initialized' }> {
  return {
    type: 'session_initialized',
    at: Date.now(),
    initialSpecSnapshot: buildInitialSpec(params),
    params: {
      // Initial auto-continue setting (mid-session flips land as
      // user_auto_continue_changed events, which foldAutoContinueEnabled
      // prefers). Snapshotted directly -- undefined for older params is
      // dropped in serialization, so those sessions keep the always-on default
      // (same treatment as longVideoEnabled).
      autoContinueEnabled: params.autoContinueEnabled,
      audioPath: params.audioPath,
      brandExtractionEnabled: params.brandExtractionEnabled,
      generationResolution: params.generationResolution,
      imageModel: params.imageModel,
      improvedVisualScriptEnabled: params.improvedVisualScriptEnabled,
      modelSelectorTier: params.modelSelectorTier,
      orgId: params.orgId,
      projectId: params.projectId,
      transitionVideoModel: params.transitionVideoModel,
      remixContext: params.remixContext,
      seedStyleInstruction: params.seedStyleInstruction,
      userEmail: params.userEmail,
      userId: params.userId,
      voiceId: params.voiceId,
      voiceProfile: params.voiceProfile,
      workflowProtocolVersion: params.workflowProtocolVersion,
    },
    timestamp: nowIso(),
  }
}

// ---------------------------------------------------------------------------
// Lifecycle handlers
// ---------------------------------------------------------------------------

/** Idle timeout (no decision-worthy event within the window): mark timed out. */
function handleIdleTimeout(state: WorkflowState): void {
  appendEvent(state, { type: 'session_timed_out', timestamp: nowIso() })
  state.isTimedOut = true
}

/**
 * Cancel fast-path (V1 maybeFastPathCancelExit): append a closing message + the
 * session_cancelled event, mark cancelled, and best-effort cancel every in-flight
 * tool child. Persistence is owned by the background loop's terminal flush.
 */
async function handleCancelFastPath(state: WorkflowState): Promise<void> {
  appendEvent(state, {
    type: 'assistant_message',
    content: 'Your session has been cancelled.',
    messageId: nextMessageId(state),
    phase: foldPhase(state.events),
    specVersion: currentSpecVersion(state),
    timestamp: nowIso(),
  })
  appendEvent(state, {
    type: 'session_cancelled',
    cancelledAt: nowIso(),
    timestamp: nowIso(),
  })
  state.isCancelled = true

  for (const [, info] of state.activeToolCalls) {
    await getExternalWorkflowHandle(info.childWorkflowId)
      .signal(toolRunnerCancelSignal)
      .catch(() => undefined)
  }
}

/**
 * Audio pipeline step (Phase-3 minimal). Surfaces a pre-voiceover child failure
 * as a terminal session_failed; the full seed/handshake lands in Phase 4.
 */
function handleAudioPipelineStep(state: WorkflowState): 'continue' | 'exit' {
  if (state.preVoiceoverChildFailureMessage) {
    appendEvent(state, {
      type: 'session_failed',
      failureCode: 'PRE_VOICEOVER_FAILED',
      failureMessage: state.preVoiceoverChildFailureMessage,
      timestamp: nowIso(),
    })
    state.isFailed = true
    return 'exit'
  }

  // Deterministic seed: when the pre-voiceover child has sent script_ready and
  // we have not yet seeded the working script, append working_script_seeded.
  // foldSession projects it into the working_script artifact + audio_source +
  // duration, which unblocks bootstrap_script (the planner sees the script and
  // skips generate_explainer_script). Idempotent via the "already seeded" check.
  const scriptReady = findLast(state.events, (e) => e.type === 'pre_voiceover_script_ready')
  const alreadySeeded = state.events.some((e) => e.type === 'working_script_seeded')
  if (scriptReady && scriptReady.type === 'pre_voiceover_script_ready' && !alreadySeeded) {
    appendEvent(state, {
      type: 'working_script_seeded',
      audioDurationSeconds: scriptReady.audioDurationSeconds,
      scriptText: scriptReady.scriptText,
      timestamp: nowIso(),
      transcriptPath: scriptReady.transcriptPath,
    })
  }

  return 'continue'
}

/**
 * 7f (audio seed): seed working_script from a pre-voiceover script_ready and map a
 * child failure to a terminal break. Returns 'break' when the caller must exit.
 */
function runAudioSeedStep(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
): 'break' | 'continue' {
  if (handleAudioPipelineStep(state) === 'exit') {
    logTermination(params, state, 'pre_voiceover_failed')
    return 'break'
  }
  return 'continue'
}

/**
 * 7e + 7f: forward phase progression interleaved with the audio script seed.
 * The seed runs BEFORE advancePhase so an audio session advances
 * bootstrap_script -> script_review on the SAME turn the script is seeded
 * (advancePhase is a forward-only, condition-gated cascade, so it is a no-op until
 * the seed makes the transition eligible). Returns 'break' on a terminal pre-voiceover
 * child failure, or 'loop' when the music beat-sheet hold (7f.4) means
 * the planner has nothing to do this turn -- resolved here, right after advancePhase,
 * so it sees the post-advance phase. 'continue' otherwise.
 */
/**
 * Run the audio-seed step, advance the phase, flush deferred messages, and resolve
 * the music beat-sheet hold -- returning 'loop'/'break' to short-circuit the
 * planner turn when appropriate, else 'continue'.
 */
function advancePhaseWithAudioSeed(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  onlyMusicBeatSheetWasNew: boolean,
  phaseBeforeAdvance: PlannerPhase,
): 'continue' | MainLoopDirective {
  if (runAudioSeedStep(state, params) === 'break') {
    return 'break'
  }
  advancePhase(state)
  flushDeferredUserMessages(state)
  if (
    shouldSkipPlannerForMusicBeatSheet(state.events, onlyMusicBeatSheetWasNew, phaseBeforeAdvance)
  ) {
    return 'loop'
  }
  return 'continue'
}

// ---------------------------------------------------------------------------
// Brand extraction (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Apply captured brand machine / user-action payloads as spec_patched ops before
 * advancePhase (ready -> seed_brand_synthesis + add_brand_asset; failed ->
 * fail_brand_extraction; confirm -> [styleDirective?, ...edits, lock_brand_bank]).
 * Local activities awaited sequentially.
 */
async function applyPendingBrandState(state: WorkflowState): Promise<void> {
  // C2 fix: consume brandBriefSubmit payload as spec_patched ops. Mirrors V1
  // applyBrandBriefSubmit (run-planner-turn-brand-signals.ts). Sets
  // brand_extraction_input so the planner sees it in the next turn. Must be
  // applied before ready/failed/confirm so extraction_input is set before
  // start_brand_extraction lands.
  if (state.pendingBrandBrief) {
    const brief = state.pendingBrandBrief
    state.pendingBrandBrief = null
    await applyBrandOps(state, { brief, kind: 'brief' })
  }
  if (state.brandReadyPayload) {
    const ready = state.brandReadyPayload
    state.brandReadyPayload = null
    // The child reached a terminal result -- clear the in-flight latch so a
    // later re-extraction (maybeReExtractBrandChild) is not blocked.
    state.brandExtractionPending = false
    await applyBrandOps(state, { kind: 'ready', ready })
  }
  if (state.brandFailedPayload) {
    const { reason } = state.brandFailedPayload
    state.brandFailedPayload = null
    state.brandExtractionPending = false
    await applyBrandOps(state, { kind: 'failed', reason })
  }
  if (state.pendingBrandConfirm) {
    const confirm = state.pendingBrandConfirm
    state.pendingBrandConfirm = null
    await applyBrandOps(state, { confirm, kind: 'confirm' })
  }
}

/** Apply one brand action via the activity; append spec_patched on success. */
/**
 * Flush user messages deferred during a system-owned wait once we have left it:
 * bootstrap_brand extraction (brand hold) or, for a music-candidate session, the
 * music beat-sheet hold in script_review. Holding the flush keeps the
 * planner from waking on a buffered message before the wait resolves.
 */
function flushDeferredUserMessages(state: WorkflowState): void {
  const stillHolding =
    foldPhase(state.events) === 'bootstrap_brand' || isAwaitingMusicBeatSheet(state.events)
  if (state.deferredUserMessages.length === 0 || stillHolding) {
    return
  }
  const buffered = state.deferredUserMessages.splice(0)
  for (const payload of buffered) {
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
  }
}

/** Best-effort cleanup of the OpenAI Responses chain ids on session exit. */
async function maybeCleanupPlannerChain(state: WorkflowState, projectId: string): Promise<void> {
  const ids = new Set<string>(state.plannerOrphanedChainResponseIds)
  if (state.plannerResponseId) {
    ids.add(state.plannerResponseId)
  }
  for (const responseId of ids) {
    await cleanupPlannerChainActivity({ projectId, responseId }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// continueAsNew
// ---------------------------------------------------------------------------

async function compactAndContinue(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
): Promise<never> {
  const next: ContinueAsNewParams = {
    ...params,
    _v2ActionIdsToClaim: state.actionIdsToClaim,
    _v2ActiveToolCalls: Array.from(state.activeToolCalls.entries()).map(([toolCallId, info]) => ({
      childWorkflowId: info.childWorkflowId,
      toolCallId,
      toolName: info.toolName,
    })),
    _v2BrandExtractionEnabled: state.brandExtractionEnabled,
    _v2BrandExtractionPending: state.brandExtractionPending,
    // Pin the just-flushed spec version (the `await syncPromise` at the
    // 'continue-as-new' branch persisted spec/versions/v{N}/spec.json before this
    // runs) so the next run seeds its base spec from that immutable checkpoint
    // rather than replaying the truncated event log onto the creation snapshot.
    _v2CompactedEvents: compactEvents(state.events, currentSpecVersion(state)),
    _v2CurrentArtifacts: state.currentArtifacts,
    // M1 fix: carry pendingBrandBrief. It has no corresponding event so it
    // would be silently lost across continueAsNew without explicit carry.
    _v2PendingBrandBrief: state.pendingBrandBrief,
    _v2PlannerChainGroundingKey: state.plannerChainGroundingKey,
    _v2PlannerChainSegment: state.plannerChainSegment,
    // Carry the pinned arm: it has no corresponding event, so without this a
    // long session would re-resolve (and possibly change) its model at every
    // compaction boundary.
    _v2PlannerModel: state.plannerModel,
    _v2PlannerOrphanedChainResponseIds: state.plannerOrphanedChainResponseIds,
    _v2PlannerResponseId: state.plannerResponseId,
    _v2PreVoiceoverChildFailureMessage: state.preVoiceoverChildFailureMessage,
    _v2SeenActionIds: Array.from(state.seenActionIds),
  }
  return await continueAsNew<typeof UipSessionV2Workflow>(next)
}
