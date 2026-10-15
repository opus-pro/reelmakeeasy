import type { ProjectStage } from '@shared/types/api/project'
import { isTerminalStage, PROJECT_STAGE } from '@shared/types/enums/project'

/**
 * Whether the /story-mode/[projectId] viewer should show the UIP planner
 * instead of its own default (editor/processing) view.
 *
 * Mirrors ProjectPageClient.tsx's exact-stage gate: the planner shows while the
 * session is planning (or was canceled), and fast-confirm ("Create Video Now")
 * drops to the processing view.
 *
 * plannerDismissed is a local latch: once the user acts on the video-ready gate
 * ("Edit or Download") the planner is dismissed synchronously, before a stage
 * refetch confirms the terminal stage the cache is still lagging on.
 *
 * rerunFrom marks a project as coming from the regenerate flow rather than the
 * planner, which never writes a UipSession; the stage-driven default-view
 * branch is suppressed for it so an actively-rendering regenerate doesn't get
 * swapped into a stale planner, while an explicit viewUip request still
 * opens it.
 */
export function shouldShowUipPlanner(params: {
  isConfirmFast: boolean
  isUip: boolean
  plannerDismissed?: boolean
  rerunFrom?: string
  stage?: ProjectStage
  viewUip: boolean
}): boolean {
  const { isConfirmFast, isUip, plannerDismissed, rerunFrom, stage, viewUip } = params
  if (!isUip) {
    return false
  }
  if (isConfirmFast) {
    return false
  }
  // An explicit view-chat-history request wins over a prior dismissal, so the
  // planner can reopen after the video-ready gate was closed.
  if (viewUip) {
    return true
  }
  if (plannerDismissed) {
    return false
  }
  if (rerunFrom) {
    return false
  }
  return stage === PROJECT_STAGE.UIP_PLANNING || stage === PROJECT_STAGE.CANCELED
}

/**
 * Whether a stage transition should clear the video-ready gate's dismissal latch.
 *
 * Only a fresh non-terminal run does -- e.g. an agentic re-edit that unlocks and
 * regenerates sections. The terminal stage itself must not clear it: clearing at
 * rest would remount the planner on top of the viewer the gate just opened.
 */
export function shouldClearPlannerDismissal(stage?: ProjectStage): boolean {
  return Boolean(stage) && !isTerminalStage(stage) && stage !== PROJECT_STAGE.FAILED
}
