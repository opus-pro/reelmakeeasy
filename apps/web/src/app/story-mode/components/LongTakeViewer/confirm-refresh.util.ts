import { PROJECT_STAGE } from '@shared/types/enums/project'

/**
 * Whether the viewer should poll `projectInfo` to recover from the fast-confirm
 * staleness window.
 *
 * On the normal confirm path the planner stays mounted until the session
 * completes and refetches `projectInfo` itself, so the project record is fresh
 * before the processing view appears. Fast-confirm instead flips the viewer to
 * the processing view (and unmounts the planner) the moment `confirm_fast` is
 * requested -- before the confirm write lands -- so the once-fetched, unpolled
 * `projectInfo` keeps its pre-confirm `UIP_PLANNING` stage with stale style /
 * video model / script. Poll only in that exact window and stop the moment the
 * confirm write lands and stage advances.
 */
export function shouldPollProjectInfoAfterFastConfirm({
  isConfirmFast,
  stage,
}: {
  isConfirmFast: boolean
  stage: string | undefined
}): boolean {
  return isConfirmFast && stage === PROJECT_STAGE.UIP_PLANNING
}
