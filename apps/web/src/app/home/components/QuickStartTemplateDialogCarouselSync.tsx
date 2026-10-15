'use client'
import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useCarousel } from '@shared/ui'
import { useRouter } from 'next/navigation'
import React, { useEffect, useRef } from 'react'

// Invisible carousel-context-syncing components. None render visible DOM;
// each bridges useCarousel() to an outside concern (URL sync, aspect-ratio
// atom, navigation tracking, scroll ref).

export const CarouselControlsWrapper: React.FC<{
  carouselRef: React.MutableRefObject<null | { scrollNext: () => void; scrollPrev: () => void }>
}> = ({ carouselRef }) => {
  const { scrollPrev, scrollNext } = useCarousel()

  useEffect(() => {
    carouselRef.current = { scrollPrev, scrollNext }
  }, [scrollPrev, scrollNext, carouselRef])

  return null
}

export const AspectRatioSyncWrapper: React.FC<{
  onAspectRatioChange: (ratio: '1:1' | '9:16' | '16:9' | undefined) => void
  templates: QuickStartTemplate[]
}> = ({ templates, onAspectRatioChange }) => {
  const { selectedIndex } = useCarousel()
  const currentTemplate = templates[selectedIndex]

  useEffect(() => {
    onAspectRatioChange(currentTemplate?.aspectRatio)
  }, [selectedIndex, currentTemplate?.aspectRatio, onAspectRatioChange])

  return null
}

export const TemplateQuerySyncWrapper: React.FC<{
  templates: QuickStartTemplate[]
  urlPattern: 'path' | 'query'
}> = ({ templates, urlPattern }) => {
  const { selectedIndex } = useCarousel()
  const currentItem = templates[selectedIndex]
  const router = useRouter()

  useEffect(() => {
    const pathname = window.location.pathname
    const isAlreadyPathBased = pathname.match(/^\/d\//)

    if (urlPattern === 'path' && !isAlreadyPathBased) {
      router.replace(`/d/${encodeURIComponent(currentItem.projectId)}`)
    }
  }, [selectedIndex, currentItem.projectId, urlPattern, router])

  return null
}

// Track demo navigation (thumbnail clicks, arrow buttons, keyboard arrows).
// Uses a rAF gate so the initial carousel settlement (Embla moving from index 0
// to the actual startIndex) is ignored and only real user navigation fires.
export const DemoNavigationTracker: React.FC<{
  templates: QuickStartTemplate[]
}> = ({ templates }) => {
  const { selectedIndex } = useCarousel()
  const prevIndexRef = useRef(selectedIndex)
  const canTrackRef = useRef(false)

  // Enable tracking after the first paint, by then Embla has settled.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      canTrackRef.current = true
    })
    return () => cancelAnimationFrame(frameId)
  }, [])

  useEffect(() => {
    if (prevIndexRef.current === selectedIndex) {
      return
    }
    prevIndexRef.current = selectedIndex

    if (!canTrackRef.current) {
      return
    }

    const template = templates[selectedIndex]
    if (!template) {
      return
    }
  }, [selectedIndex, templates])

  return null
}
