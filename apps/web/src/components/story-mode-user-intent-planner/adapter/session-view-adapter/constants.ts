import type { PlannerPhase } from '../api-types'

export const PHASE_ORDER = [
  'mode_confirmation',
  'bootstrap_brand',
  'brand_review',
  'bootstrap_script',
  'script_review',
  'bootstrap_visual',
  'refinement',
] as const satisfies PlannerPhase[]

export type OrderedPhase = (typeof PHASE_ORDER)[number]

export const PHASE_INDEX: Record<OrderedPhase, number> = Object.fromEntries(
  PHASE_ORDER.map((phase, index) => [phase, index]),
) as Record<OrderedPhase, number>

/**
 * Has the folded phase reached the point where the visual render is committed? Unknown phases
 * count as the earliest one, matching PHASE_INDEX's ordering. Callers that also treat a stamped
 * `locked_at` as past the lock OR that in themselves -- this is the phase half of the rule only.
 */
export function isPhaseAtOrAfterVisualRenderLock(phase: null | string | undefined): boolean {
  const phaseIndex =
    typeof phase === 'string' && phase in PHASE_INDEX ? PHASE_INDEX[phase as OrderedPhase] : 0

  return phaseIndex >= PHASE_INDEX.bootstrap_visual
}
