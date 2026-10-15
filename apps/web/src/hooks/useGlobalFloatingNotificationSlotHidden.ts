'use client'

import { useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'

import {
  popGlobalFloatingNotificationSlotHideTokenAtom,
  pushGlobalFloatingNotificationSlotHideTokenAtom,
} from '@/atom/ui'

type Options = {
  scope?: string
}

export function useGlobalFloatingNotificationSlotHidden(hidden: boolean, options?: Options) {
  const pushHideToken = useSetAtom(pushGlobalFloatingNotificationSlotHideTokenAtom)
  const popHideToken = useSetAtom(popGlobalFloatingNotificationSlotHideTokenAtom)
  const tokenRef = useRef(
    `${options?.scope ?? 'global-floating-slot'}:${Math.random().toString(36).slice(2, 10)}`,
  )

  useEffect(() => {
    const token = tokenRef.current

    if (hidden) {
      pushHideToken(token)
      return () => {
        popHideToken(token)
      }
    }

    popHideToken(token)
    return undefined
  }, [hidden, popHideToken, pushHideToken])
}
