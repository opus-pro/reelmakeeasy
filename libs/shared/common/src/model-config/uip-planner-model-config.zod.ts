import type { Model } from '../llm/models'

/**
 * Models the UIP planner agent loop may run on. `satisfies readonly Model[]` is
 * the load-bearing part: an arm that is not a real model id fails the build
 * here, instead of 400ing once per planner round in production.
 */
export const UIP_PLANNER_MODEL_ARMS = [
  'gpt-5.4',
  'gpt-5.6-luna',
] as const satisfies readonly Model[]

export type UipPlannerModelArm = (typeof UIP_PLANNER_MODEL_ARMS)[number]

/**
 * Whether a value is still a declared arm. Used to validate an arm PINNED
 * earlier in a session before reusing it: a pin carried across a deploy (or a
 * continueAsNew) may name an arm that has since been retired from the
 * allowlist, and reusing it would route the planner at a model we no longer
 * intend to serve. A failed check falls back to UIP_PLANNER_MODEL_DEFAULT.
 */
export function isUipPlannerModelArm(value: unknown): value is UipPlannerModelArm {
  return typeof value === 'string' && (UIP_PLANNER_MODEL_ARMS as readonly string[]).includes(value)
}

/** Control arm -- what the planner loop has run on since it was written. */
export const UIP_PLANNER_MODEL_DEFAULT: UipPlannerModelArm = 'gpt-5.4'
