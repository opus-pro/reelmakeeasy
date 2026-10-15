import { defineLiteralsFromKeyMap } from '@reelmakeeasy/common/utils/type-utils'
import { USER_INACTIVITY_TIMEOUT_MS } from '@reelmakeeasy/common/workflow/uip-v2-deadline-policy'
import type { PlannerPhase, SessionStatus } from '@reelmakeeasy/uip-planner-runtime'

export const terminalSessionStatus = defineLiteralsFromKeyMap<Exclude<SessionStatus, 'active'>>({
  cancelled: true,
  completed: true,
  failed: true,
  timed_out: true,
})

export const TRANSCRIPT_EDITING_STALE_MS = 60_000
export const OPERATE_AT_STALE_MS = 60_000
export const TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS = USER_INACTIVITY_TIMEOUT_MS
export const OPERATE_AT_DEADLINE_EXTENSION_MS = USER_INACTIVITY_TIMEOUT_MS
// When an auto-confirm/continue action is rejected because the user must take action first
// (e.g. shorten the script), extend the deadline by this interval so the
// workflow retries automatically without requiring a manual "Create video" click.
export const USER_ACTION_REQUIRED_RETRY_MS = 10 * 60 * 1000
// When deadline fires but a user-triggered action is already in-flight (pending_action set
// or nextAction record exists), defer by this interval so triggerNextAction can finish first.
export const PENDING_ACTION_DEFER_MS = 5 * 60 * 1000

export const PHASE_RANK: Record<string, number> = {
  mode_confirmation: 0,
  bootstrap_brand: 1,
  brand_review: 2,
  bootstrap_script: 3,
  script_review: 4,
  bootstrap_visual: 5,
  refinement: 6,
} satisfies Record<PlannerPhase, number>
