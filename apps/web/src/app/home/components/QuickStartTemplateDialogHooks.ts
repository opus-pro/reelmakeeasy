'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useAtomValue } from 'jotai'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { quickStartDeepLinkTemplateAtom, quickStartTemplatesAtom } from '@/atom/home'

const computeVideoDimensions = (
  el: HTMLElement,
  widthRatio: number,
  heightRatio: number,
  panelWidth: number,
) => {
  const containerHeight = el.clientHeight
  const containerWidth = el.clientWidth

  if (containerHeight <= 0 || containerWidth <= 0) {
    return null
  }

  const availableWidthForVideo = containerWidth - panelWidth - 48
  const widthBasedVideoWidth = availableWidthForVideo
  const widthBasedVideoHeight = (widthBasedVideoWidth * heightRatio) / widthRatio

  const heightBasedVideoWidth = (containerHeight * widthRatio) / heightRatio
  const heightBasedVideoHeight = containerHeight

  const isWidthConstrained = widthBasedVideoHeight < heightBasedVideoHeight

  if (isWidthConstrained) {
    return {
      videoWidth: widthBasedVideoWidth,
      videoHeight: widthBasedVideoHeight,
      isWidthConstrained: true,
    }
  }
  return {
    videoWidth: heightBasedVideoWidth,
    videoHeight: heightBasedVideoHeight,
    isWidthConstrained: false,
  }
}

export const useVideoDimensions = (widthRatio = 9, heightRatio = 16, panelWidth = 400) => {
  const [dimensions, setDimensions] = useState<{
    isWidthConstrained: boolean
    videoHeight: number | undefined
    videoWidth: number | undefined
  }>({ isWidthConstrained: false, videoHeight: undefined, videoWidth: undefined })

  const elementRef = useRef<HTMLElement | null>(null)
  const resizeObserverRef = useRef<null | ResizeObserver>(null)

  const updateDimensions = useCallback(
    (el: HTMLElement) => {
      const result = computeVideoDimensions(el, widthRatio, heightRatio, panelWidth)
      if (result) {
        setDimensions((prev) => {
          if (
            prev.videoWidth === result.videoWidth &&
            prev.videoHeight === result.videoHeight &&
            prev.isWidthConstrained === result.isWidthConstrained
          ) {
            return prev
          }
          return result
        })
      }
    },
    [widthRatio, heightRatio, panelWidth],
  )

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }

      elementRef.current = el

      if (el) {
        updateDimensions(el)

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserverRef.current = new ResizeObserver(() => updateDimensions(el))
          resizeObserverRef.current.observe(el)
        }
      }
    },
    [updateDimensions],
  )

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
      }
    }
  }, [])

  return { ...dimensions, videoPaneRef: setRef }
}

export const useDisplayList = (templates: QuickStartTemplate[] | undefined) => {
  const currentTemplateList = useAtomValue(quickStartTemplatesAtom)
  const deepLinkTemplate = useAtomValue(quickStartDeepLinkTemplateAtom)
  const baseList = templates ?? currentTemplateList
  return useMemo(() => {
    if (!deepLinkTemplate) {
      return baseList
    }
    const isInList = baseList.some((t) => t.projectId === deepLinkTemplate.projectId)
    if (isInList) {
      return baseList
    }
    return [deepLinkTemplate, ...baseList]
  }, [baseList, deepLinkTemplate])
}

export const detectClosestAspectRatioLabel = (videoWidth: number, videoHeight: number) => {
  if (!videoWidth || !videoHeight) {
    return undefined
  }

  const aspectRatio = videoWidth / videoHeight
  const ratios = [
    { ratio: 1, label: '1:1' },
    { ratio: 9 / 16, label: '9:16' },
    { ratio: 16 / 9, label: '16:9' },
  ] as const

  const closest = ratios.slice(1).reduce((acc, current) => {
    const currentDiff = Math.abs(aspectRatio - current.ratio)
    const accDiff = Math.abs(aspectRatio - acc.ratio)
    return currentDiff < accDiff ? current : acc
  }, ratios[0])

  return closest.label
}

export const aspectRatioToWidthHeight = (ratio?: '1:1' | '9:16' | '16:9') => {
  switch (ratio) {
    case '1:1': {
      return { widthRatio: 1, heightRatio: 1 }
    }
    case '16:9': {
      return { widthRatio: 16, heightRatio: 9 }
    }
    default: {
      return { widthRatio: 9, heightRatio: 16 }
    }
  }
}

const KEY_ACTIONS: Record<string, 'close' | 'next' | 'prev'> = {
  ArrowUp: 'prev',
  ArrowDown: 'next',
  Escape: 'close',
}

export const useDialogKeyboard = (
  open: boolean,
  carouselRef: React.MutableRefObject<null | { scrollNext: () => void; scrollPrev: () => void }>,
  dialogContentRef: React.RefObject<HTMLDivElement | null>,
  handleClose: () => void,
) => {
  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const action = KEY_ACTIONS[e.key]
      if (!action) {
        return
      }
      e.preventDefault()
      if (action === 'prev') {
        carouselRef.current?.scrollPrev()
      } else if (action === 'next') {
        carouselRef.current?.scrollNext()
      } else {
        handleClose()
      }
      dialogContentRef.current?.focus()
    }

    dialogContentRef.current?.focus()
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handleClose, carouselRef, dialogContentRef])
}
