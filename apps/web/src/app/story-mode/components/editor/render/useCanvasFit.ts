'use client'

import { type RefObject, useEffect, useState } from 'react'

export type CanvasDisplaySize = { height: number; width: number }

/**
 * The largest whole-pixel size a `canvasWidth` x `canvasHeight` canvas fits into the
 * container at, kept up to date as the container resizes; null until measured. Used to
 * size the editor engine's canvas.
 */
export function useCanvasFit(
  containerRef: RefObject<HTMLElement | null>,
  canvasWidth: number,
  canvasHeight: number,
): CanvasDisplaySize | null {
  const [displaySize, setDisplaySize] = useState<CanvasDisplaySize | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    setDisplaySize(null)
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) {
        return
      }
      const scale = Math.min(width / canvasWidth, height / canvasHeight)
      const nextWidth = Math.floor(canvasWidth * scale)
      const nextHeight = Math.floor(canvasHeight * scale)
      setDisplaySize((prev) => {
        if (prev?.width === nextWidth && prev?.height === nextHeight) {
          return prev
        }
        return { width: nextWidth, height: nextHeight }
      })
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [containerRef, canvasWidth, canvasHeight])

  return displaySize
}
