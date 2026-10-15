/**
 * UIP V2 session termination: the single, consistently-formatted exit log + the
 * exit-status projection. Extracted from workflow.ts so the orchestrator stays
 * under the file-length cap; both helpers are pure-ish (a log line, no event-log
 * mutation) and are called from every exit path.
 *
 * `@reelmakeeasy/uip-planner-runtime` is imported via `import type` ONLY (no value
 * import dragged into workflow code).
 */

import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'

import { createWorkflowLogger } from '../../utilities/workflow-logger'

import { foldAutoContinueEnabled, foldPhase, sessionCommitted } from './folds'
import { currentSpecVersion } from './planner-turn-helpers'
import type { WorkflowState } from './types'
import type { UipSessionV2WorkflowResult } from './workflow'

/**
 * Phases at or after script_review (mirrors API PHASE_RANK >= script_review; a
 * lib can't import that API-app constant). An idle timeout in one of these
 * means the user abandoned a session that had already produced a script / visual
 * plan / refinement -> log as error; earlier phases are an expected drop-off.
 */
const SCRIPT_REVIEW_AND_LATER: ReadonlySet<string> = new Set([
  'bootstrap_visual',
  'refinement',
  'script_review',
])

export type TerminationReason =
  | 'external_cancel'
  | 'idle_timeout'
  | 'lock'
  | 'pre_voiceover_failed'
  | 'user_cancel'

/** Best-effort exit status derived from the terminal flags on state. */
export function computeExitStatus(state: WorkflowState): UipSessionV2WorkflowResult['status'] {
  if (state.isCancelled) {
    return 'cancelled'
  }
  if (state.isFailed) {
    return 'failed'
  }
  if (state.isTimedOut) {
    return 'timed_out'
  }
  return 'completed'
}

/**
 * Single, consistently-formatted termination log for EVERY V2 exit path, so they
 * are trivially greppable: message
 * `[uip-v2] session terminated reason=<reason> phase=<phase> committed=<bool>`.
 * reason/phase/committed are embedded in the MESSAGE (not just the structured
 * fields) because plain-text logs drop the structured field object -- only
 * the message string is searchable there. The same fields are also
 * attached structured (plus status / specVersion / context via
 * createWorkflowLogger: projectId / userId / workflowId / workflowRunId). Levels:
 *   - user_cancel / lock / external_cancel -> info (expected)
 *   - pre_voiceover_failed -> error
 *   - idle_timeout -> error iff phase is script_review or later AND the user
 *     committed (continue/confirm) AND auto-continue was ON.
 *     A committed session that then idle-times-out without finishing while
 *     auto-continue was on is worth investigating (the gate should have
 *     auto-continued / auto-locked). An idle timeout WITHOUT a commit is an
 *     expected drop-off (user reached the gate and left without committing), and
 *     an idle timeout with auto-continue OFF is the designed outcome
 *     of the opt-out (the user chose to review at their own pace) -> both info.
 */
export function logTermination(
  params: UipSessionWorkflowParams,
  state: WorkflowState,
  reason: TerminationReason,
): void {
  const phase = foldPhase(state.events)
  const committed = sessionCommitted(state.events)
  // Whether the session opted out of auto-continue. Tracked on the
  // termination so idle-timeout terminations can be attributed to the opt-out
  // (an expected outcome) vs an anomaly where auto-continue was on but the gate
  // never fired.
  const autoContinueEnabled = foldAutoContinueEnabled(state.events)
  const fields = {
    reason,
    status: computeExitStatus(state),
    phase,
    sessionCommitted: committed,
    autoContinueEnabled,
    specVersion: currentSpecVersion(state),
    eventCount: state.events.length,
    lastEventType: state.events[state.events.length - 1]?.type,
  }
  const logger = createWorkflowLogger({ projectId: params.projectId, userId: params.userId })
  const isError =
    reason === 'pre_voiceover_failed' ||
    (reason === 'idle_timeout' &&
      SCRIPT_REVIEW_AND_LATER.has(phase) &&
      committed &&
      autoContinueEnabled)
  // Embed reason/phase/committed/autoContinue in the message so they stay
  // searchable in plain-text logs, which keep only the message (not the fields).
  const message = `[uip-v2] session terminated reason=${reason} phase=${phase} committed=${committed} autoContinue=${autoContinueEnabled}`
  if (isError) {
    logger.error(message, fields)
  } else {
    logger.info(message, fields)
  }
}
