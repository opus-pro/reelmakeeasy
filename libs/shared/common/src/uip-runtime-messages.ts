/**
 * UIP runtime-injected, user-facing messages shared between the two orchestrators:
 * V1 (`@reelmakeeasy/uip-planner-runtime` reply-vocab / planner-actions) and V2
 * (`story-mode-runtime` workflow execute-decision). These are runtime invariants,
 * not planner decisions, so both orchestrators must emit identical copy.
 *
 * This module is the single source of truth and is safe to import from workflow
 * code: V2's execute-decision is workflow code, which keeps clear of value imports
 * from `@reelmakeeasy/uip-planner-runtime` (to stay light) but may import `@reelmakeeasy/common`.
 */

/**
 * Appended right after a MODE_CONFIRMED confirmation: tells the user the agent is
 * now autonomously building the video and explains the "stay to refine vs step away
 * and let auto-lock finish" UX. Always emitted (it is a runtime invariant, kept out
 * of the planner prompt).
 */
export const MODE_CONFIRMED_FOLLOWUP_MESSAGE =
  "I'm starting your video! Stay to refine it together, or I'll use my best judgment to finish the video if you step away."

/**
 * Appended on entering `brand_review` (after brand extraction completes): the
 * proactive "your brand profile is ready" prompt that points the user at the
 * review card + Continue CTA. A runtime invariant, not a planner decision. V1
 * emits it via `transitionToBrandReview`; V2 (no such transition helper) emits it
 * deterministically on brand_review entry, so both share this copy.
 */
export const BRAND_REVIEW_READY_MESSAGE =
  'Your brand profile is ready to review. Adjust any details, then click "Continue" to confirm your brand profile.'

/**
 * Appended once the backend has actually HANDLED a per-tool cancel:
 * every targeted tool child reported `tool_cancelled` back and nothing is left
 * running, so the planner is paused awaiting the user. Tells the user the pause is
 * deliberate and how to resume -- any message wakes the session, "continue" being
 * the obvious one.
 *
 * V2-only: per-tool cancel has no V1 counterpart, so unlike the two
 * messages above there is no second orchestrator to mirror this copy into.
 *
 * A cancel stops the WAIT, not generation already in flight.
 */
export const TOOL_CANCELLED_PAUSED_MESSAGE =
  "I've paused what I was working on. Just say continue whenever you want me to pick it back up, or tell me what to change instead."
