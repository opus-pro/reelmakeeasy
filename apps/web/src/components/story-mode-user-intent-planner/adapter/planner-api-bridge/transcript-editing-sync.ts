import type { PlannerState } from '../../state/planner-state'
import {
  getTranscriptEditingOptimisticOpsAtom,
  type TranscriptEditingOptimisticOp,
} from '../adapter-atoms'
import type { StateChanges } from '../api-types'

export const TRANSCRIPT_EDITING_STALE_MS = 60_000
const TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS = 5 * 60 * 1000

export function applyTranscriptEditingOptimisticRemoveClient(
  plannerState: PlannerState,
  clientId: string,
  ts: string = new Date().toISOString(),
): string {
  const opId = crypto.randomUUID()
  plannerState.set(getTranscriptEditingOptimisticOpsAtom, (current) => [
    ...current,
    { active: false, clientId, opId, ts },
  ])
  return opId
}

export function applyTranscriptEditingOptimisticSetClientActive(
  plannerState: PlannerState,
  clientId: string,
  ts: string = new Date().toISOString(),
): string {
  const opId = crypto.randomUUID()
  plannerState.set(getTranscriptEditingOptimisticOpsAtom, (current) => [
    ...current,
    { active: true, clientId, opId, ts },
  ])
  return opId
}

export function clearTranscriptEditingOptimisticOp(plannerState: PlannerState, opId: string): void {
  plannerState.set(getTranscriptEditingOptimisticOpsAtom, (current) =>
    current.filter((op) => op.opId !== opId),
  )
}

export function getEffectiveSessionState(params: {
  optimisticOps: TranscriptEditingOptimisticOp[]
  state: StateChanges['state']
}): StateChanges['state'] {
  const { optimisticOps, state } = params
  if (optimisticOps.length === 0) {
    return state
  }

  const nextEditingAt = { ...getTranscriptEditingAt(state) }
  let nextDeadline = state.review_gate?.review_auto_continue_deadline_at ?? null
  for (const op of optimisticOps) {
    nextDeadline = maxIsoTimestamp(
      nextDeadline,
      addMillisecondsToIso(op.ts, TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS),
    )
    if (op.active) {
      nextEditingAt[op.clientId] = op.ts ?? new Date().toISOString()
    } else {
      delete nextEditingAt[op.clientId]
    }
  }

  return patchTranscriptEditingAt(state, nextEditingAt, nextDeadline)
}

export function hasAnyActiveTranscriptEditor(params: {
  nowMs?: number
  state: StateChanges['state']
}): boolean {
  const { nowMs = Date.now(), state } = params
  const editingAtByClient = getTranscriptEditingAt(state)
  return Object.values(editingAtByClient).some((timestamp) => {
    const tsMs = new Date(timestamp).getTime()
    return Number.isFinite(tsMs) && nowMs - tsMs < TRANSCRIPT_EDITING_STALE_MS
  })
}

function addMillisecondsToIso(value: null | string | undefined, deltaMs: number): null | string {
  if (!value) {
    return null
  }
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) {
    return null
  }
  return new Date(ms + deltaMs).toISOString()
}

function getTranscriptEditingAt(state: StateChanges['state']): Record<string, string> {
  return state.transcript?.editing_at ?? {}
}

function maxIsoTimestamp(...values: Array<null | string | undefined>): null | string {
  let maxValue: null | string = null
  for (const value of values) {
    if (!value) {
      continue
    }
    if (!maxValue || value > maxValue) {
      maxValue = value
    }
  }
  return maxValue
}

function patchTranscriptEditingAt(
  state: StateChanges['state'],
  editingAtByClient: Record<string, string>,
  deadline: null | string,
): StateChanges['state'] {
  const nextReviewGate = state.review_gate
    ? {
        ...state.review_gate,
        ...(deadline ? { review_auto_continue_deadline_at: deadline } : {}),
      }
    : deadline
      ? { review_auto_continue_deadline_at: deadline }
      : undefined
  return {
    ...state,
    ...(nextReviewGate ? { review_gate: nextReviewGate } : {}),
    transcript: {
      ...state.transcript,
      editing_at: editingAtByClient,
    },
  }
}
