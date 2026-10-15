'use client'

import { useAtomValue } from 'jotai'
import { memo, useEffect, useMemo, useRef } from 'react'

import { projectAtom } from '@/atom/project'

interface FramePreviewProps {
  activeKeyframeIndex: number
  endShotLabel: string
  endUrl: string
  onSelectEnd?: () => void
  onSelectStart?: () => void
  startShotLabel: string
  startUrl: string
}

const ANIM_DUR = 300
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const BASE_SCALE = 0.95
const HOVER_SCALE = 1.2
const HOVER_OFFSET_X = 4
const HOVER_OFFSET_Y = 8
const HOVER_ROTATION = 2
const CARD_GAP = 10
const CARD_PAD = 5
const SHOT_LABEL_BOTTOM_OFFSET = 18

interface CardDims {
  cardBottom: number
  containerHeight: number
  containerWidth: number
  endLeft: number
  height: number
  startLeft: number
  width: number
}

function animateAdjacentTransition(
  container: HTMLElement,
  prevIdx: number,
  newIdx: number,
  startUrl: string,
  endUrl: string,
  startShotLabel: string,
  endShotLabel: string,
  dims: CardDims,
  onSelectStart?: () => void,
  onSelectEnd?: () => void,
) {
  const slots = [...container.querySelectorAll<HTMLElement>(':scope > div')]
  if (slots.length < 2) {
    renderSlots(container, startUrl, endUrl, startShotLabel, endShotLabel, dims)
    return
  }

  const slotA = slots[0]
  const slotB = slots[1]
  const cardA = slotA.querySelector<HTMLElement>('div')
  const cardB = slotB.querySelector<HTMLElement>('div')
  if (!cardA || !cardB) {
    return
  }

  const ease = `${ANIM_DUR}ms ${EASE}`
  const direction = newIdx > prevIdx ? 'right' : 'left'

  if (direction === 'right') {
    ;(cardA as HTMLElement & { _exiting?: boolean })._exiting = true
    cardA.style.transition = `transform ${ease}, opacity ${ease}`
    cardA.style.transform = 'translateX(-8px) rotate(-6deg) scale(0)'
    cardA.style.opacity = '0'

    slotB.style.transition = `left ${ease}`
    slotB.style.left = `${dims.startLeft}px`
    cardB.style.transition = `transform ${ease}`
    cardB.style.transform = 'rotate(-3deg)'
    const lblB = slotB.querySelector<HTMLElement>('[data-role="hover-label"]')
    if (lblB) {
      lblB.textContent = 'Edit start frame'
    }
    const shotLblB = slotB.querySelector<HTMLElement>('[data-role="shot-label"]')
    if (shotLblB) {
      shotLblB.textContent = startShotLabel
    }

    const slotC = createSlotEl(
      endUrl,
      'End',
      endShotLabel,
      dims.endLeft + 8,
      6,
      dims,
      0,
      0,
      onSelectEnd,
    )
    container.appendChild(slotC)
    const cardC = slotC.querySelector<HTMLElement>('div')
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cardC) {
          return
        }
        slotC.style.transition = `left ${ease}`
        slotC.style.left = `${dims.endLeft}px`
        cardC.style.transition = `transform ${ease}, opacity ${ease}`
        cardC.style.transform = `rotate(3deg) scale(${BASE_SCALE})`
        cardC.style.opacity = '1'
      }),
    )
  } else {
    ;(cardB as HTMLElement & { _exiting?: boolean })._exiting = true
    cardB.style.transition = `transform ${ease}, opacity ${ease}`
    cardB.style.transform = 'translateX(8px) rotate(6deg) scale(0)'
    cardB.style.opacity = '0'

    slotA.style.transition = `left ${ease}`
    slotA.style.left = `${dims.endLeft}px`
    cardA.style.transition = `transform ${ease}`
    cardA.style.transform = 'rotate(3deg)'
    const lblA = slotA.querySelector<HTMLElement>('[data-role="hover-label"]')
    if (lblA) {
      lblA.textContent = 'Edit end frame'
    }
    const shotLblA = slotA.querySelector<HTMLElement>('[data-role="shot-label"]')
    if (shotLblA) {
      shotLblA.textContent = endShotLabel
    }

    const slotC = createSlotEl(
      startUrl,
      'Start',
      startShotLabel,
      dims.startLeft - 8,
      -6,
      dims,
      0,
      0,
      onSelectStart,
    )
    container.appendChild(slotC)
    const cardC = slotC.querySelector<HTMLElement>('div')
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cardC) {
          return
        }
        slotC.style.transition = `left ${ease}`
        slotC.style.left = `${dims.startLeft}px`
        cardC.style.transition = `transform ${ease}, opacity ${ease}`
        cardC.style.transform = `rotate(-3deg) scale(${BASE_SCALE})`
        cardC.style.opacity = '1'
      }),
    )
  }
}

function clearContainer(el: HTMLElement) {
  while (el.firstChild) {
    el.removeChild(el.firstChild)
  }
}

function computeCardDims(ratioStr: string): CardDims {
  const [wStr, hStr] = ratioStr.split(':')
  const rw = Number(wStr) || 9
  const rh = Number(hStr) || 16
  const aspect = rw / rh

  // Fixed card sizes matching Figma: 45/60 swapped by orientation
  let width: number
  let height: number
  if (aspect < 1) {
    // Portrait (e.g. 9:16)
    width = 45
    height = 60
  } else if (aspect > 1) {
    // Landscape (e.g. 16:9)
    width = 60
    height = 45
  } else {
    // Square (1:1)
    width = 45
    height = 45
  }

  const startLeft = CARD_PAD
  const endLeft = startLeft + width + CARD_GAP
  const containerWidth = endLeft + width + CARD_PAD
  // Cards stick out above container; percentage offset pushes them up uniformly
  const cardBottom = 15
  const containerHeight = Math.round(height * (1 - cardBottom / 100))

  return { width, height, startLeft, endLeft, containerWidth, containerHeight, cardBottom }
}

function createSlotEl(
  url: string,
  label: string,
  shotLabel: string,
  leftPx: number,
  rotation: number,
  dims: CardDims,
  opacity = 1,
  scale = 1,
  onClick?: () => void,
): HTMLElement {
  const slot = document.createElement('div')
  slot.className = 'absolute'
  slot.style.cssText = `left:${leftPx}px; bottom:${dims.cardBottom}%; width:${dims.width}px; height:${dims.height}px;`

  const card = document.createElement('div')
  card.className = 'relative w-full h-full rounded-xs overflow-hidden cursor-pointer'
  card.style.transform = `rotate(${rotation}deg) scale(${scale})`
  card.style.opacity = String(opacity)
  card.style.transition = 'transform 150ms'
  if (onClick) {
    card.addEventListener('click', (event) => {
      event.stopPropagation()
      onClick()
    })
  }

  if (url) {
    const img = document.createElement('img')
    img.src = url
    img.alt = label
    img.className = 'absolute inset-0 w-full h-full object-cover'
    card.appendChild(img)
  } else {
    const bg = document.createElement('div')
    bg.className = 'absolute inset-0 bg-fill-secondary'
    card.appendChild(bg)
  }

  const grad = document.createElement('div')
  grad.className = 'absolute inset-0'
  grad.style.background = 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.82) 100%)'
  card.appendChild(grad)

  const hoverLabel = label === 'Start' ? 'Edit start frame' : 'Edit end frame'
  const hoverX = label === 'Start' ? -HOVER_OFFSET_X : HOVER_OFFSET_X
  const hoverRot = label === 'Start' ? rotation - HOVER_ROTATION : rotation + HOVER_ROTATION

  const shotLbl = document.createElement('span')
  shotLbl.textContent = shotLabel
  shotLbl.dataset.role = 'shot-label'
  shotLbl.className = 'absolute text-xs font-medium text-primary leading-none'
  shotLbl.style.cssText = `bottom:${SHOT_LABEL_BOTTOM_OFFSET}px; left:4px;`
  card.appendChild(shotLbl)

  const lbl = document.createElement('span')
  lbl.textContent = hoverLabel
  lbl.dataset.role = 'hover-label'
  lbl.className = 'absolute text-xs font-medium text-primary leading-none'
  lbl.style.cssText = 'bottom:4px; left:4px; opacity:0; transition:opacity 150ms;'
  card.appendChild(lbl)

  card.addEventListener('mouseenter', () => {
    if (!(card as HTMLElement & { _exiting?: boolean })._exiting) {
      card.style.transform = `rotate(${hoverRot}deg) scale(${HOVER_SCALE}) translate(${hoverX}px, -${HOVER_OFFSET_Y}px)`
      lbl.style.opacity = '1'
    }
  })
  card.addEventListener('mouseleave', () => {
    if (!(card as HTMLElement & { _exiting?: boolean })._exiting) {
      card.style.transform = `rotate(${rotation}deg) scale(${BASE_SCALE})`
      lbl.style.opacity = '0'
    }
  })

  slot.appendChild(card)
  return slot
}

function renderSlots(
  container: HTMLElement,
  startUrl: string,
  endUrl: string,
  startShotLabel: string,
  endShotLabel: string,
  dims: CardDims,
  onSelectStart?: () => void,
  onSelectEnd?: () => void,
) {
  clearContainer(container)
  container.appendChild(
    createSlotEl(
      startUrl,
      'Start',
      startShotLabel,
      dims.startLeft,
      -3,
      dims,
      1,
      BASE_SCALE,
      onSelectStart,
    ),
  )
  container.appendChild(
    createSlotEl(endUrl, 'End', endShotLabel, dims.endLeft, 3, dims, 1, BASE_SCALE, onSelectEnd),
  )
}

/**
 * Animated Start/End frame preview cards for the EditBox.
 * Uses imperative DOM manipulation for smooth slide/rotate/fade transitions.
 */
const FramePreview: React.FC<FramePreviewProps> = ({
  startUrl,
  endUrl,
  startShotLabel,
  endShotLabel,
  activeKeyframeIndex,
  onSelectStart,
  onSelectEnd,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevIdxRef = useRef(activeKeyframeIndex)
  const cleanupRef = useRef<(() => void) | null>(null)

  const projectInfo = useAtomValue(projectAtom)
  const dims = useMemo(
    () => computeCardDims(projectInfo?.longTakeRatio ?? '9:16'),
    [projectInfo?.longTakeRatio],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    renderSlots(
      container,
      startUrl,
      endUrl,
      startShotLabel,
      endShotLabel,
      dims,
      onSelectStart,
      onSelectEnd,
    )
  }, [dims, endShotLabel, endUrl, onSelectEnd, onSelectStart, startShotLabel, startUrl])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const prevIdx = prevIdxRef.current
    const newIdx = activeKeyframeIndex

    if (prevIdx === newIdx) {
      renderSlots(
        container,
        startUrl,
        endUrl,
        startShotLabel,
        endShotLabel,
        dims,
        onSelectStart,
        onSelectEnd,
      )
      return
    }

    prevIdxRef.current = newIdx

    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }

    const adjacent = Math.abs(newIdx - prevIdx) === 1

    if (!adjacent) {
      renderSlots(
        container,
        startUrl,
        endUrl,
        startShotLabel,
        endShotLabel,
        dims,
        onSelectStart,
        onSelectEnd,
      )
      return
    }

    animateAdjacentTransition(
      container,
      prevIdx,
      newIdx,
      startUrl,
      endUrl,
      startShotLabel,
      endShotLabel,
      dims,
      onSelectStart,
      onSelectEnd,
    )

    const timerId = window.setTimeout(() => {
      cleanupRef.current = null
      renderSlots(
        container,
        startUrl,
        endUrl,
        startShotLabel,
        endShotLabel,
        dims,
        onSelectStart,
        onSelectEnd,
      )
    }, ANIM_DUR + 30)

    cleanupRef.current = () => {
      clearTimeout(timerId)
      renderSlots(
        container,
        startUrl,
        endUrl,
        startShotLabel,
        endShotLabel,
        dims,
        onSelectStart,
        onSelectEnd,
      )
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
    }
  }, [
    activeKeyframeIndex,
    dims,
    endShotLabel,
    endUrl,
    onSelectEnd,
    onSelectStart,
    startShotLabel,
    startUrl,
  ])

  return (
    <div
      className="relative flex-shrink-0 overflow-visible"
      ref={containerRef}
      style={{ width: dims.containerWidth, height: dims.containerHeight }}
    />
  )
}

export default memo(FramePreview)
