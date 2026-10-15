'use client'

import { useEffect, useRef, useState } from 'react'

import { Quotes } from '@/components/icons/core'

import { getPlannerScopeElementAtom, getScrollInnerElementAtom } from '../state/atoms/planner'
import { getPlannerEvents, selectTextEvent } from '../state/events/planner-events'
import { usePlannerState } from '../state/planner-context'

interface SelectionActionState {
  text: string
  x: number
  y: number
}

export function SelectTextOverlay() {
  const state = usePlannerState()
  const [isPointerSelecting, setIsPointerSelecting] = useState(false)
  const [selectionAction, setSelectionAction] = useState<null | SelectionActionState>(null)
  const pendingDragFromSelectionRef = useRef(false)
  const pointerDownPointRef = useRef<null | { x: number; y: number }>(null)

  useEffect(() => {
    const isMouseDownInsideCurrentSelection = (event: MouseEvent, scopeElement: HTMLElement) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false
      }

      const { anchorNode, focusNode } = selection
      if (!anchorNode || !focusNode) {
        return false
      }
      if (!scopeElement.contains(anchorNode) || !scopeElement.contains(focusNode)) {
        return false
      }

      const x = event.clientX
      const y = event.clientY
      const rects = selection.getRangeAt(0).getClientRects()
      for (const rect of rects) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return true
        }
      }
      return false
    }

    const computeSelectionAction = (options?: {
      ignorePointerSelecting?: boolean
    }): null | SelectionActionState => {
      const scopeElement = state.get(getPlannerScopeElementAtom)
      const positionElement = state.get(getScrollInnerElementAtom)
      if (!scopeElement || !positionElement) {
        return null
      }
      if (!options?.ignorePointerSelecting && isPointerSelecting) {
        return null
      }

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null
      }

      const { anchorNode, focusNode } = selection
      if (!anchorNode || !focusNode) {
        return null
      }

      if (!scopeElement.contains(anchorNode) || !scopeElement.contains(focusNode)) {
        return null
      }

      const selectedText = selection.toString().replace(/\s+/g, ' ').trim()
      if (!selectedText) {
        return null
      }

      const rangeRect = selection.getRangeAt(0).getBoundingClientRect()
      if (rangeRect.width <= 0 && rangeRect.height <= 0) {
        return null
      }

      const containerRect = positionElement.getBoundingClientRect()
      return {
        text: selectedText,
        x: rangeRect.left + rangeRect.width / 2 - containerRect.left,
        y: rangeRect.top - 12 - containerRect.top,
      }
    }

    const updateSelectionAction = () => {
      if (pendingDragFromSelectionRef.current) {
        return
      }
      setSelectionAction(computeSelectionAction())
    }

    const handleMouseDown = (event: MouseEvent) => {
      const scopeElement = state.get(getPlannerScopeElementAtom)
      const target = event.target
      if (!(target instanceof Node) || !scopeElement?.contains(target)) {
        return
      }
      if (target instanceof Element && target.closest('[data-select-text-overlay="button"]')) {
        return
      }

      pointerDownPointRef.current = { x: event.clientX, y: event.clientY }
      if (isMouseDownInsideCurrentSelection(event, scopeElement)) {
        pendingDragFromSelectionRef.current = true
        return
      }

      pendingDragFromSelectionRef.current = false
      setIsPointerSelecting(true)
      setSelectionAction(null)
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!pendingDragFromSelectionRef.current) {
        return
      }

      const point = pointerDownPointRef.current
      if (!point || event.buttons !== 1) {
        return
      }

      const movedX = Math.abs(event.clientX - point.x)
      const movedY = Math.abs(event.clientY - point.y)
      if (movedX < 2 && movedY < 2) {
        return
      }

      pendingDragFromSelectionRef.current = false
      setIsPointerSelecting(true)
      setSelectionAction(null)
    }

    const handleMouseUp = () => {
      if (pendingDragFromSelectionRef.current) {
        pendingDragFromSelectionRef.current = false
        pointerDownPointRef.current = null
        return
      }

      pendingDragFromSelectionRef.current = false
      pointerDownPointRef.current = null
      setIsPointerSelecting(false)
      setSelectionAction(computeSelectionAction({ ignorePointerSelecting: true }))
    }

    document.addEventListener('selectionchange', updateSelectionAction)
    document.addEventListener('mousedown', handleMouseDown, { capture: true })
    document.addEventListener('mousemove', handleMouseMove, { capture: true })
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('resize', updateSelectionAction)
    window.addEventListener('scroll', updateSelectionAction, true)

    return () => {
      document.removeEventListener('selectionchange', updateSelectionAction)
      document.removeEventListener('mousedown', handleMouseDown, { capture: true })
      document.removeEventListener('mousemove', handleMouseMove, { capture: true })
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('resize', updateSelectionAction)
      window.removeEventListener('scroll', updateSelectionAction, true)
    }
  }, [isPointerSelecting, state])

  if (!selectionAction) {
    return null
  }

  return (
    <button
      className="absolute z-[220] inline-flex select-none items-center justify-center gap-1.5 rounded-[10px] bg-white/10 px-2.5 py-2 text-[14px] font-medium leading-[17px] text-white backdrop-blur-2xl transition-colors hover:bg-white/15"
      data-select-text-overlay="button"
      onClick={() => {
        getPlannerEvents(state).emit(selectTextEvent, { text: selectionAction.text })
      }}
      onMouseDown={(event) => event.preventDefault()}
      style={{
        left: selectionAction.x,
        top: selectionAction.y,
        transform: 'translate(-50%, -100%)',
      }}
      type="button"
    >
      <Quotes className="size-[18px] text-white" />
      <span>Modify</span>
    </button>
  )
}
