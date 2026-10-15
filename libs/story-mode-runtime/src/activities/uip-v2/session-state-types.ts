import type { SessionState } from '@reelmakeeasy/uip-planner-runtime'

/**
 * The session state as the fold builds it: the planner-runtime `SessionState`
 * plus the workflow-only terminal flags the runtime itself ignores.
 *
 * Lives in its own module so sibling fold modules can take it as a parameter
 * without importing session-state.ts, which imports them.
 */
export type FoldedSessionState = SessionState & {
  _cancelled?: boolean
  _cancelled_at?: string
  _failed?: boolean
  _failure_message?: string
  _timed_out?: boolean
}
