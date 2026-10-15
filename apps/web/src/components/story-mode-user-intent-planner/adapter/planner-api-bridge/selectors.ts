import type { PlannerState } from '../../state/planner-state'
import {
  getAdapterSessionAtom,
  getAdapterTimelineMetaAtom,
  getSessionStateAtom,
} from '../adapter-atoms'

export function getCurrentTimelineVersion(plannerState: PlannerState): null | number {
  return plannerState.get(getAdapterSessionAtom)?.timeline.version ?? null
}

export function getGateTokenOrThrow(plannerState: PlannerState): string {
  const token = plannerState.get(getAdapterTimelineMetaAtom)?.gateToken
  if (!token) {
    throw new Error('Script review gate is not available.')
  }
  return token
}

export function shouldPollSession(plannerState: PlannerState): boolean {
  const { state } = plannerState.get(getSessionStateAtom)
  if (state.pending_action) {
    return true
  }
  const timelineMeta = plannerState.get(getAdapterTimelineMetaAtom)
  if (!timelineMeta) {
    return false
  }
  return timelineMeta.isProcessingFromTimeline || timelineMeta.lastMessageType === 'user_message'
}
