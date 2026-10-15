'use client'

import { useAtomValue } from 'jotai'

import { getRenderStateAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'

/**
 * Whether a mention click can still reach the composer. Mentions land in MessageTextArea, which
 * only mounts inside BottomPanel's active, unlocked branch, so on a completed, cancelled,
 * timed-out or locked project the emitted event has no subscriber. Mention affordances gate on
 * this to drop their click handler, and with it the pointer cursor and tab stop.
 */
export function useCanMentionInComposer(): boolean {
  const state = usePlannerState()
  const { isLocked, status } = useAtomValue(getRenderStateAtom(state))
  return status === 'active' && !isLocked
}
