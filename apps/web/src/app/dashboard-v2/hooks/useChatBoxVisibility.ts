'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import type { CreateWorkflow } from '@/constants/create-use-cases'

import {
  dashboardChatBoxVisibleAtom,
  dashboardSelectedUseCaseKeyAtom,
} from '../state/dashboard-v2-atoms'

type Params = {
  chatBoxRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  selectedWorkflow: CreateWorkflow
}

export function useChatBoxVisibility({ chatBoxRef, scrollContainerRef, selectedWorkflow }: Params) {
  const selectedUseCaseKey = useAtomValue(dashboardSelectedUseCaseKeyAtom)
  const setIsChatBoxVisible = useSetAtom(dashboardChatBoxVisibleAtom)

  useEffect(() => {
    const node = chatBoxRef.current
    if (!node) {
      return
    }
    const scrollContainer: EventTarget = scrollContainerRef?.current ?? window

    let rafId: null | number = null

    const measureVisibility = () => {
      rafId = null
      const rect = node.getBoundingClientRect()
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth
      const hasVisibleHeight = rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight
      const hasVisibleWidth = rect.width > 0 && rect.right > 0 && rect.left < viewportWidth
      setIsChatBoxVisible(hasVisibleHeight && hasVisibleWidth)
    }

    const scheduleMeasure = () => {
      if (rafId !== null) {
        return
      }
      rafId = window.requestAnimationFrame(measureVisibility)
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure()
    })
    resizeObserver.observe(node)
    scrollContainer.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    scheduleMeasure()

    return () => {
      scrollContainer.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
      resizeObserver.disconnect()
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [chatBoxRef, scrollContainerRef, selectedUseCaseKey, selectedWorkflow, setIsChatBoxVisible])
}
