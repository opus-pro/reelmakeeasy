/**
 * Extracted main-loop boundary step handlers for UipSessionV2Workflow. These are
 * "consume the decision boundary and loop" steps lifted out of
 * runMainLoopIteration to keep that function -- and workflow.ts, which sits at the
 * 800-line / cognitive-complexity-20 ceiling -- within budget. Each is a pure
 * control-flow helper: it reads the event log + light control state, may issue the
 * SAME workflow command(s) as the old inline code at the same logical point, and
 * returns a directive the caller acts on.
 *
 * Imports stay light: only workflow-safe modules (folds,
 * `@reelmakeeasy/workflow-engine/workflow`, local types) -- never
 * `@reelmakeeasy/uip-planner-runtime` as a value import.
 */

import type { CancellableToolName } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import { TOOL_CANCELLED_PAUSED_MESSAGE } from '@reelmakeeasy/common/uip-runtime-messages'
import { getExternalWorkflowHandle } from '@reelmakeeasy/workflow-engine/workflow'

import { appendEvent, nextMessageId } from './event-log'
import {
  countDecisionWorthy,
  foldPhase,
  isOnlyUnprocessedToolCancelled,
  isOnlyUnprocessedWake,
  openToolStartedEvents,
  unprocessedToolCancelTargets,
} from './folds'
import { currentSpecVersion, nowIso } from './planner-turn-helpers'
import type { WorkflowState } from './types'

/**
 * Per-tool cancel fast-path: cancel every in-flight tool
 * child whose toolName is targeted, keeping the session alive (no isCancelled,
 * no session_cancelled -- contrast handleCancelFastPath). The child reports
 * tool_cancelled back (nonCancellable), which clears its activeToolCalls entry;
 * the "only tool_cancelled" boundary skip below then pauses the planner so the
 * session idles awaiting the next user message.
 */
export async function handleToolCancelFastPath(
  state: WorkflowState,
  targets: CancellableToolName[],
): Promise<void> {
  for (const [, info] of state.activeToolCalls) {
    if (targets.includes(info.toolName as CancellableToolName)) {
      await getExternalWorkflowHandle(info.childWorkflowId)
        .cancel()
        .catch(() => undefined)
    }
  }
}

/**
 * 7b.2 + 7c.1 Per-tool cancel. A `user_cancel_tool` asks to cancel a
 * running tool by name -> cancel the matching child(ren) and consume the
 * boundary; the session stays alive. The child's `tool_cancelled` report-back is
 * the completion side: when the only unprocessed decision events are
 * `tool_cancelled`, consume the boundary and skip the planner so the session idles
 * awaiting the next user message (pause & await user). Both are mutually exclusive
 * "only-unprocessed-X" boundaries, so handling them together (before the wake /
 * lock / deadline no-ops) is behavior-equivalent to two separate blocks. Returns
 * 'loop' when a boundary was consumed, else 'continue'. Targets are computed
 * against the OLD boundary, then the boundary is advanced, then the cancel is
 * issued (order matters for correctness).
 */
export async function toolCancelDirective(state: WorkflowState): Promise<'continue' | 'loop'> {
  const targets = unprocessedToolCancelTargets(state.events, state.processedDecisionCount)
  if (targets.length > 0) {
    state.processedDecisionCount = countDecisionWorthy(state.events)
    await handleToolCancelFastPath(state, targets)
    return 'loop'
  }
  if (isOnlyUnprocessedToolCancelled(state.events, state.processedDecisionCount)) {
    state.processedDecisionCount = countDecisionWorthy(state.events)
    // The cancel is now HANDLED and the planner is about to be skipped,
    // so tell the user the pause is deliberate and how to resume -- otherwise the
    // agent just goes silent mid-step. Gated on nothing being left in flight: with
    // a sibling tool still running the agent is NOT paused, and the guard also
    // keeps a multi-tool cancel that reports back in separate batches to ONE
    // message (only the batch that empties the set emits).
    if (openToolStartedEvents(state.events).length === 0) {
      // This copy is a FIXED string, so every pause after the first would be
      // swallowed by the API's (turn_id, content) dedup -- V2 sets no turn id on
      // assistant messages, making that bucket session-wide. Stamping each pause
      // with its own turn id (the message id is unique)
      // puts it in its own bucket, so a user who stops at several stages gets a
      // message every time. See AssistantMessageEvent.turnId.
      const messageId = nextMessageId(state)
      appendEvent(state, {
        type: 'assistant_message',
        content: TOOL_CANCELLED_PAUSED_MESSAGE,
        messageId,
        phase: foldPhase(state.events),
        specVersion: currentSpecVersion(state),
        timestamp: nowIso(),
        turnId: messageId,
      })
    }
    return 'loop'
  }
  return 'continue'
}

/**
 * 7c. New-protocol wake decision (SYNC). Classifies the current boundary:
 *  - 'skip'    : no consumable wake -- fall through to the rest of the loop.
 *  - 'consume' : consume the wake but do NOT nudge the API, because a tool is still
 *                in flight (pulling the next inbox message mid-tool would materialize
 *                it instead of leaving it queued; V1 holds messages in the inbox
 *                while busy). The queued message is pulled by the idle nudge (7j)
 *                once the tool completes.
 *  - 'nudge'   : consume the wake AND nudge the API for the authoritative next action.
 *
 * Synchronous: the caller advances the boundary and awaits
 * triggerNextActionActivity inline.
 */
export function newProtocolWakeAction(state: WorkflowState): 'consume' | 'nudge' | 'skip' {
  if (!state.isNewProtocol || !isOnlyUnprocessedWake(state.events, state.processedDecisionCount)) {
    return 'skip'
  }
  return openToolStartedEvents(state.events).length === 0 ? 'nudge' : 'consume'
}
