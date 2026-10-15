import type { RefObject } from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

export type OverlapAvoidDirection = 'left' | 'right'

export type OverlapAvoidSelector = {
  direction?: OverlapAvoidDirection
  gapPx?: number
  selector: string
}

type SelectorOverlapCollisionOptions = {
  enabled?: boolean
  gapPx?: number
  hysteresisGapPx?: number
  lockWhileVerticalOverlap?: boolean
  minViewportWidth?: number
  selectors: string[]
  updateDebounceMs?: number
}

type SelectorOverlapShiftOptions = {
  enabled?: boolean
  minViewportWidth?: number
  selectors: OverlapAvoidSelector[]
  updateDebounceMs?: number
}

type UseSelectorOverlapValueOptions<T> = {
  computeValue: (params: { currentValue: T; target: HTMLElement }) => T
  enabled?: boolean
  initialValue: T
  minViewportWidth?: number
  observeSelectors: string[]
  updateDebounceMs?: number
}

const DEFAULT_COLLISION_GAP_PX = 0
const DEFAULT_COLLISION_HYSTERESIS_GAP_PX = 6
const DEFAULT_GAP_PX = 8
const DEFAULT_UPDATE_DEBOUNCE_MS = 0

export function useSelectorOverlapCollision(
  targetRef: RefObject<HTMLElement | null>,
  options: SelectorOverlapCollisionOptions,
): boolean {
  const enabled = options.enabled ?? true
  const gapPx = options.gapPx ?? DEFAULT_COLLISION_GAP_PX
  const hysteresisGapPx = options.hysteresisGapPx ?? DEFAULT_COLLISION_HYSTERESIS_GAP_PX
  const lockWhileVerticalOverlap = options.lockWhileVerticalOverlap ?? false
  const minViewportWidth = options.minViewportWidth
  const selectors = options.selectors
  const updateDebounceMs = Math.max(0, options.updateDebounceMs ?? DEFAULT_UPDATE_DEBOUNCE_MS)

  const observeSelectors = useMemo(() => collectObservedSelectors(selectors), [selectors])

  return useSelectorOverlapValue<boolean>(targetRef, {
    computeValue: ({ currentValue, target }) => {
      const targetRect = target.getBoundingClientRect()

      if (
        currentValue &&
        lockWhileVerticalOverlap &&
        hasSelectorObstacleMatch(target, selectors, (obstacleRect) =>
          hasVerticalOverlap(targetRect, obstacleRect),
        )
      ) {
        return true
      }

      const effectiveGapPx = currentValue ? gapPx + hysteresisGapPx : gapPx

      return hasSelectorObstacleMatch(target, selectors, (obstacleRect) =>
        hasRectOverlap(targetRect, obstacleRect, effectiveGapPx),
      )
    },
    enabled,
    initialValue: false,
    minViewportWidth,
    observeSelectors,
    updateDebounceMs,
  })
}

export function useSelectorOverlapShift(
  targetRef: RefObject<HTMLElement | null>,
  options: SelectorOverlapShiftOptions,
): number {
  const enabled = options.enabled ?? true
  const minViewportWidth = options.minViewportWidth
  const selectors = options.selectors
  const updateDebounceMs = Math.max(0, options.updateDebounceMs ?? DEFAULT_UPDATE_DEBOUNCE_MS)

  const observeSelectors = useMemo(
    () => collectObservedSelectors(selectors.map((item) => item.selector)),
    [selectors],
  )

  return useSelectorOverlapValue<number>(targetRef, {
    computeValue: ({ currentValue, target }) => {
      const targetRect = target.getBoundingClientRect()
      const naturalRect = {
        bottom: targetRect.bottom,
        left: targetRect.left - currentValue,
        right: targetRect.right - currentValue,
        top: targetRect.top,
      }
      let lowerBound = Number.NEGATIVE_INFINITY
      let upperBound = Number.POSITIVE_INFINITY
      let hasConstraint = false

      selectors.forEach((item) => {
        const direction = item.direction ?? 'right'
        const gapPx = item.gapPx ?? DEFAULT_GAP_PX
        const nodes = document.querySelectorAll<HTMLElement>(item.selector)

        nodes.forEach((node) => {
          const obstacleRect = node.getBoundingClientRect()
          if (!hasVerticalOverlap(targetRect, obstacleRect)) {
            return
          }

          hasConstraint = true

          if (direction === 'left') {
            const nextUpperBound = Math.floor(obstacleRect.left - gapPx - naturalRect.right)
            upperBound = Math.min(upperBound, nextUpperBound)
            return
          }

          const nextLowerBound = Math.ceil(obstacleRect.right + gapPx - naturalRect.left)
          lowerBound = Math.max(lowerBound, nextLowerBound)
        })
      })

      const desiredShiftPx = hasConstraint ? resolveShift(lowerBound, upperBound) : 0
      return applyShiftHysteresis({
        currentShiftPx: currentValue,
        desiredShiftPx,
        hasConstraint,
      })
    },
    enabled,
    initialValue: 0,
    minViewportWidth,
    observeSelectors,
    updateDebounceMs,
  })
}

function applyShiftHysteresis({
  currentShiftPx,
  desiredShiftPx,
  hasConstraint,
}: {
  currentShiftPx: number
  desiredShiftPx: number
  hasConstraint: boolean
}): number {
  if (!hasConstraint) {
    return 0
  }
  if (currentShiftPx === 0) {
    return desiredShiftPx
  }
  if (desiredShiftPx === 0) {
    return currentShiftPx
  }
  if (desiredShiftPx > 0 && currentShiftPx > 0) {
    return Math.max(desiredShiftPx, currentShiftPx)
  }
  if (desiredShiftPx < 0 && currentShiftPx < 0) {
    return Math.min(desiredShiftPx, currentShiftPx)
  }
  return desiredShiftPx
}

function collectObservedSelectors(selectors: string[]): string[] {
  return Array.from(new Set(selectors.filter(Boolean)))
}

function hasHorizontalOverlap(targetRect: DOMRect, obstacleRect: DOMRect, gapPx = 0): boolean {
  return (
    targetRect.left - gapPx < obstacleRect.right && targetRect.right + gapPx > obstacleRect.left
  )
}

function hasRectOverlap(targetRect: DOMRect, obstacleRect: DOMRect, gapPx = 0): boolean {
  return (
    hasHorizontalOverlap(targetRect, obstacleRect, gapPx) &&
    hasVerticalOverlap(targetRect, obstacleRect, gapPx)
  )
}

function hasSelectorObstacleMatch(
  target: HTMLElement,
  selectors: string[],
  predicate: (obstacleRect: DOMRect) => boolean,
): boolean {
  for (const selector of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(selector)
    for (const node of nodes) {
      if (node === target) {
        continue
      }

      if (predicate(node.getBoundingClientRect())) {
        return true
      }
    }
  }

  return false
}

function hasVerticalOverlap(targetRect: DOMRect, obstacleRect: DOMRect, gapPx = 0): boolean {
  return (
    targetRect.top - gapPx < obstacleRect.bottom && targetRect.bottom + gapPx > obstacleRect.top
  )
}

function matchesMinViewportWidth(minViewportWidth?: number): boolean {
  if (typeof minViewportWidth !== 'number') {
    return true
  }

  if (!window.matchMedia) {
    return true
  }

  return window.matchMedia(`(min-width: ${minViewportWidth}px)`).matches
}

function resolveShift(lowerBound: number, upperBound: number): number {
  const hasLowerBound = Number.isFinite(lowerBound)
  const hasUpperBound = Number.isFinite(upperBound)

  if (!hasLowerBound && !hasUpperBound) {
    return 0
  }

  if (hasLowerBound && hasUpperBound && lowerBound > upperBound) {
    return Math.abs(lowerBound) <= Math.abs(upperBound) ? lowerBound : upperBound
  }

  if (!hasLowerBound) {
    return Math.min(0, upperBound)
  }
  if (!hasUpperBound) {
    return Math.max(0, lowerBound)
  }

  if (lowerBound <= 0 && upperBound >= 0) {
    return 0
  }
  if (lowerBound > 0) {
    return lowerBound
  }
  return upperBound
}

function useSelectorOverlapValue<T>(
  targetRef: RefObject<HTMLElement | null>,
  options: UseSelectorOverlapValueOptions<T>,
): T {
  const enabled = options.enabled ?? true
  const minViewportWidth = options.minViewportWidth
  const updateDebounceMs = Math.max(0, options.updateDebounceMs ?? DEFAULT_UPDATE_DEBOUNCE_MS)

  const [value, setValue] = useState(options.initialValue)
  const valueRef = useRef(options.initialValue)

  useLayoutEffect(() => {
    const resetValue = () => {
      if (Object.is(valueRef.current, options.initialValue)) {
        return
      }

      valueRef.current = options.initialValue
      setValue(options.initialValue)
    }

    if (!enabled || options.observeSelectors.length === 0) {
      resetValue()
      return
    }

    const updateValue = () => {
      const target = targetRef.current
      if (!target) {
        resetValue()
        return
      }

      if (!matchesMinViewportWidth(minViewportWidth)) {
        resetValue()
        return
      }

      const nextValue = options.computeValue({
        currentValue: valueRef.current,
        target,
      })

      if (Object.is(nextValue, valueRef.current)) {
        return
      }

      valueRef.current = nextValue
      setValue(nextValue)
    }

    updateValue()

    let debounceTimer: null | number = null
    const scheduleUpdate = () => {
      if (updateDebounceMs === 0) {
        updateValue()
        return
      }

      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer)
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        updateValue()
      }, updateDebounceMs)
    }

    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleUpdate)
    const target = targetRef.current
    if (target) {
      resizeObserver?.observe(target)
    }

    const observedElements = new Set<HTMLElement>()
    options.observeSelectors.forEach((selector) => {
      const nodes = document.querySelectorAll<HTMLElement>(selector)
      nodes.forEach((node) => {
        if (observedElements.has(node)) {
          return
        }
        observedElements.add(node)
        resizeObserver?.observe(node)
      })
    })

    const mutationObserver =
      typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(scheduleUpdate)
    if (mutationObserver && document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer)
      }
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [
    enabled,
    minViewportWidth,
    options.computeValue,
    options.initialValue,
    options.observeSelectors,
    targetRef,
    updateDebounceMs,
  ])

  return value
}
