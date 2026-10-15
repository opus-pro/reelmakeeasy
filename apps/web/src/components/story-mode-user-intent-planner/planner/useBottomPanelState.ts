import { useAtomValue } from 'jotai'

import { useIsMobile } from '@/util/browserUtils'

import { getIsVideoReadyAtom, getRenderStateAtom } from '../state/atoms/planner'
import { getIsQuickQuestionModeAtom } from '../state/computed/planner'
import { usePlannerState } from '../state/planner-context'

export function useBottomPanelState() {
  const state = usePlannerState()
  const isMobile = useIsMobile()
  const isQuickQuestionMode = useAtomValue(getIsQuickQuestionModeAtom(state))
  const { isLocked, phase, status } = useAtomValue(getRenderStateAtom(state))
  const isVideoReady = useAtomValue(getIsVideoReadyAtom(state))

  return {
    isActive: status === 'active',
    isLocked,
    isMobile,
    isQuickQuestionMode,
    isVideoReady,
    phase,
    status,
  }
}
