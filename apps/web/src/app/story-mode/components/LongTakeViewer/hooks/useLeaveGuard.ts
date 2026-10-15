'use client'

import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'

import { longtakeHistoryStore } from '@/atom/longtake-history.store'

export function useLeaveGuard(enable: boolean) {
  const regeneratingTransitionIds = useAtomValue(longtakeHistoryStore.regeneratingTransitionIdsAtom)
  const shouldGuard = enable && regeneratingTransitionIds.size > 0

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const confirmedRef = useRef(false)
  const pendingActionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shouldGuard && !confirmedRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [shouldGuard])

  const attemptLeave = useCallback(
    (action: () => void) => {
      if (shouldGuard) {
        pendingActionRef.current = action
        setIsDialogOpen(true)
      } else {
        action()
      }
    },
    [shouldGuard],
  )

  const handleConfirmLeave = useCallback(() => {
    confirmedRef.current = true
    setIsDialogOpen(false)
    const action = pendingActionRef.current
    pendingActionRef.current = null
    action?.()
  }, [])

  const handleCancelLeave = useCallback(() => {
    pendingActionRef.current = null
    setIsDialogOpen(false)
  }, [])

  return { attemptLeave, handleCancelLeave, handleConfirmLeave, isDialogOpen }
}
