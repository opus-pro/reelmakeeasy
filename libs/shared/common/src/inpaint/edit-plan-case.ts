// Shared inpaint edit-plan structures.
//
// The plan case describes which transition clips an edit affects (structure only).
// The editor workflow builds it (resolveEditPlanCase).

// ---- Types ----

export type EditPlanCase =
  | { kind: 'boundary_end' | 'boundary_start' | 'direct' | 'split'; transitions: [TransitionInfo] }
  | { kind: 'case1_first' | 'case2_last'; transitions: [TransitionInfo, TransitionInfo] }
  | { kind: 'case3_both'; transitions: [TransitionInfo, TransitionInfo, TransitionInfo] }
  | { kind: 'case4a_nearFirst' | 'case4b_nearLast'; transitions: [TransitionInfo, TransitionInfo] }
  | { kind: 'range'; transitions: TransitionInfo[] }

export type TransitionInfo = {
  durationSec: number
  firstFrameUrl: string
  lastFrameUrl: string
  // Signed distance from the edited (cur) transition: prev -1, cur 0, next +1.
  // Optional because this type is reachable from persisted state.
  offset?: number
  role: 'cur' | 'next' | 'prev'
  videoUri: string
}

// ---- Offset addressing (additive; role remains the source of truth) ----

export function resolveOffset(info: { offset?: number; role: TransitionInfo['role'] }): number {
  return Number.isInteger(info.offset) ? (info.offset as number) : transitionOffset(info.role)
}

export function transitionOffset(role: TransitionInfo['role']): number {
  switch (role) {
    case 'cur': {
      return 0
    }
    case 'next': {
      return 1
    }
    case 'prev': {
      return -1
    }
  }
}

// How far a resolved plan case reaches from the edit's own transition, per side.
// The spread is a function of the transitions the plan carries (via resolveOffset),
// not of its kind. Consumed by the neighbor-conflict gate to compute a precise
// occupancy interval instead of always assuming both neighbors.
export function planCaseSpread(planCase: EditPlanCase): { left: number; right: number } {
  const offsets = planCase.transitions.map(resolveOffset)
  return { left: Math.max(0, -Math.min(...offsets)), right: Math.max(0, Math.max(...offsets)) }
}
