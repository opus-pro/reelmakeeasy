'use client'

import { Button, cn } from '@shared/ui'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'

import { CrossSmall } from '@/components/icons/core'

export interface OnboardingStep {
  description: string
  /**
   * Draw a static orange ring around a control while this step shows.
   * `selector` defaults to targetSelector; `radiusPx` should
   * match the highlighted control's own border radius. Ring animation is
   * design-owned - only the static ring ships here.
   */
  highlight?: { radiusPx?: number; selector?: string }
  id: string
  /** Preferred placement relative to target */
  placement?:
    | 'bottom'
    | 'bottom-left'
    | 'bottom-right'
    | 'left'
    | 'right'
    | 'top'
    | 'top-left'
    | 'top-right'
  /** Target element selector for positioning - if not provided, tooltip will be centered */
  targetSelector?: string
  title: string
}

type HighlightRect = { height: number; left: number; top: number; width: number }

interface OnboardingTooltipProps {
  currentStepIndex: number
  isLastStep: boolean
  /** Called when user completes the tour (clicks Done on last step) */
  onComplete: () => void
  onGoToStep: (stepIndex: number) => void
  /** Called when user skips the tour (clicks X button) */
  onSkip: () => void
  step: OnboardingStep
  totalSteps: number
}

type TooltipPosition =
  | {
      arrowLeft?: number
      arrowPosition: 'bottom' | 'left' | 'right' | 'top'
      centered?: never
      highlightRect?: HighlightRect
      left: number
      top: number
    }
  | { centered: true }

function isSameHighlightRect(a?: HighlightRect, b?: HighlightRect): boolean {
  if (!a || !b) {
    return Boolean(a) === Boolean(b)
  }
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

function isSamePosition(a: null | TooltipPosition, b: null | TooltipPosition): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  if (a.centered || b.centered) {
    return Boolean(a.centered) === Boolean(b.centered)
  }
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    a.arrowPosition === b.arrowPosition &&
    a.arrowLeft === b.arrowLeft &&
    isSameHighlightRect(a.highlightRect, b.highlightRect)
  )
}

/**
 * Onboarding tooltip component matching the Figma design.
 * Features:
 * - Glassmorphism effect with dark background
 * - Close button (X) in top-right
 * - Title and description
 * - Pagination dots (clickable to jump to any step)
 * - Next/Done button
 */
export const OnboardingTooltip: React.FC<OnboardingTooltipProps> = ({
  step,
  currentStepIndex,
  totalSteps,
  onComplete,
  onGoToStep,
  onSkip,
  isLastStep,
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState<null | TooltipPosition>(null)

  // Calculate tooltip position based on target element
  const calculatePosition = useCallback((): null | TooltipPosition => {
    if (!step.targetSelector) {
      // Center the tooltip if no target
      return { centered: true }
    }

    const targetElement = document.querySelector(step.targetSelector)
    const tooltipElement = tooltipRef.current

    if (!targetElement || !tooltipElement) {
      return null
    }

    const targetRect = targetElement.getBoundingClientRect()
    const tooltipRect = tooltipElement.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const ARROW_SIZE = 10
    const SPACING = 8

    let top = 0
    let left = 0
    let arrowPosition: 'bottom' | 'left' | 'right' | 'top' = 'top'
    let arrowLeft: number | undefined

    const placement = step.placement || 'bottom'

    // Calculate initial position based on preferred placement
    switch (placement) {
      case 'bottom': {
        // Tooltip below target, centered
        top = targetRect.bottom + ARROW_SIZE + SPACING
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2
        arrowPosition = 'top'
        break
      }
      case 'bottom-left': {
        // Tooltip below target, aligned to left with arrow pointing up
        top = targetRect.bottom + ARROW_SIZE
        left = targetRect.left
        arrowPosition = 'top'
        arrowLeft = 24
        break
      }
      case 'bottom-right': {
        // Tooltip below target, aligned to right
        top = targetRect.bottom + ARROW_SIZE + SPACING
        left = targetRect.right - tooltipRect.width
        arrowPosition = 'top'
        arrowLeft = tooltipRect.width - 40
        break
      }
      case 'left': {
        // Tooltip to the left of target
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2
        left = targetRect.left - tooltipRect.width - ARROW_SIZE - SPACING
        arrowPosition = 'right'
        break
      }
      case 'right': {
        // Tooltip to the right of target
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2
        left = targetRect.right + ARROW_SIZE + SPACING
        arrowPosition = 'left'
        break
      }
      case 'top': {
        // Tooltip above target, centered
        top = targetRect.top - tooltipRect.height - ARROW_SIZE
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2
        arrowPosition = 'bottom'
        break
      }
      case 'top-left': {
        // Tooltip above target, left-aligned with arrow pointing down
        top = targetRect.top - tooltipRect.height - ARROW_SIZE
        left = targetRect.left
        arrowPosition = 'bottom'
        arrowLeft = 40
        break
      }
      case 'top-right': {
        // Tooltip above target, aligned to right
        top = targetRect.top - tooltipRect.height - 2
        left = targetRect.right - tooltipRect.width
        arrowPosition = 'bottom'
        arrowLeft = tooltipRect.width - 40
        break
      }
    }

    // Adjust for viewport boundaries
    const padding = 16

    // Horizontal bounds
    if (left < padding) {
      left = padding
    } else if (left + tooltipRect.width > viewportWidth - padding) {
      left = viewportWidth - tooltipRect.width - padding
    }

    // Vertical bounds
    if (top < padding) {
      top = padding
      if (arrowPosition === 'top') {
        arrowPosition = 'bottom'
        top = targetRect.bottom + ARROW_SIZE + SPACING
      }
    } else if (top + tooltipRect.height > viewportHeight - padding) {
      top = viewportHeight - tooltipRect.height - padding
      if (arrowPosition === 'bottom') {
        arrowPosition = 'top'
        top = targetRect.top - tooltipRect.height - ARROW_SIZE - SPACING
      }
    }

    let highlightRect: HighlightRect | undefined
    if (step.highlight) {
      const highlightElement = document.querySelector(
        step.highlight.selector ?? step.targetSelector ?? '',
      )
      if (highlightElement) {
        const rect = highlightElement.getBoundingClientRect()
        highlightRect = { height: rect.height, left: rect.left, top: rect.top, width: rect.width }
      }
    }

    return { top, left, arrowPosition, arrowLeft, highlightRect }
  }, [step.highlight, step.targetSelector, step.placement])

  // Track the target continuously: the anchor can move after mount (e.g. the
  // omnibox shifts when the announcement banner collapses or the song upload
  // card swaps to the standard panel), and a measure-once approach leaves the
  // tooltip floating at a stale position. An rAF loop with an equality guard
  // re-renders only when the rect actually changes.
  useEffect(() => {
    let frame = 0

    const track = () => {
      const next = calculatePosition()
      setPosition((prev) => (isSamePosition(prev, next) ? prev : next))
      frame = window.requestAnimationFrame(track)
    }

    track()

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [calculatePosition])

  // Handle Escape key to skip the tour.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onSkip])

  // Arrow component based on position
  const Arrow = useMemo(() => {
    if (!position || position.centered) {
      return null
    }

    const baseClasses = 'absolute w-0 h-0 border-solid'

    // If we have a custom arrow left position, use inline styles
    if (
      position.arrowLeft !== undefined &&
      (position.arrowPosition === 'top' || position.arrowPosition === 'bottom')
    ) {
      const isTop = position.arrowPosition === 'top'
      return (
        <div
          className={cn(
            baseClasses,
            isTop
              ? 'border-l-[10px] border-r-[10px] border-b-[10px] border-l-transparent border-r-transparent border-b-[#444] -top-[10px]'
              : 'border-l-[10px] border-r-[10px] border-t-[10px] border-l-transparent border-r-transparent border-t-[#444] -bottom-[10px]',
          )}
          style={{ left: position.arrowLeft, transform: 'translateX(-50%)' }}
        />
      )
    }

    const arrowClasses = cn(baseClasses, {
      // Arrow pointing up (tooltip is below target)
      'border-l-[10px] border-r-[10px] border-b-[10px] border-l-transparent border-r-transparent border-b-[#444]':
        position.arrowPosition === 'top',
      '-top-[10px] left-1/2 -translate-x-1/2': position.arrowPosition === 'top',
      // Arrow pointing down (tooltip is above target)
      'border-l-[10px] border-r-[10px] border-t-[10px] border-l-transparent border-r-transparent border-t-[#444]':
        position.arrowPosition === 'bottom',
      '-bottom-[10px] left-1/2 -translate-x-1/2': position.arrowPosition === 'bottom',
      // Arrow pointing left (tooltip is to the right of target)
      'border-t-[10px] border-b-[10px] border-r-[10px] border-t-transparent border-b-transparent border-r-[#444]':
        position.arrowPosition === 'left',
      '-left-[10px] top-1/2 -translate-y-1/2': position.arrowPosition === 'left',
      // Arrow pointing right (tooltip is to the left of target)
      'border-t-[10px] border-b-[10px] border-l-[10px] border-t-transparent border-b-transparent border-l-[#444]':
        position.arrowPosition === 'right',
      '-right-[10px] top-1/2 -translate-y-1/2': position.arrowPosition === 'right',
    })

    return <div className={arrowClasses} />
  }, [position])

  const handleNextOrDone = useCallback(() => {
    if (isLastStep) {
      onComplete()
    } else {
      onGoToStep(currentStepIndex + 1)
    }
  }, [isLastStep, onComplete, onGoToStep, currentStepIndex])

  const tooltipStyle =
    position && !position.centered
      ? { top: position.top, left: position.left, position: 'fixed' as const }
      : { position: 'fixed' as const, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  // Static highlight ring, inflated a touch beyond the control so the stroke
  // never overlaps it. Non-interactive by design: the control stays clickable.
  const RING_INSET = 4
  const highlightRect = position && !position.centered ? position.highlightRect : undefined
  const highlightRing = highlightRect ? (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[59] border-2 border-accent-orange"
      data-testid="onboarding-highlight-ring"
      style={{
        borderRadius: step.highlight?.radiusPx ?? 9999,
        height: highlightRect.height + RING_INSET * 2,
        left: highlightRect.left - RING_INSET,
        top: highlightRect.top - RING_INSET,
        width: highlightRect.width + RING_INSET * 2,
      }}
    />
  ) : null

  return (
    <>
      {highlightRing}
      <div
        aria-describedby="onboarding-description"
        aria-labelledby="onboarding-title"
        aria-modal="true"
        className={cn(
          'z-[60] w-[310px] max-w-[calc(100vw-32px)] rounded-[10px] bg-[#444] p-4 shadow-lg',
          // Stay invisible until the anchor has been measured: the first paint
          // would otherwise flash the centered fallback before jumping into
          // place. The animation classes attach on the same render the position
          // lands, so the tooltip fades in already anchored.
          position
            ? 'duration-200 animate-in fade-in-0 zoom-in-95'
            : 'pointer-events-none opacity-0',
        )}
        ref={tooltipRef}
        role="dialog"
        style={tooltipStyle}
      >
        {/* Arrow */}
        {Arrow}

        {/* Content */}
        <div className="flex flex-col gap-4">
          <div className="flex items-start">
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="text-base font-medium text-white leading-[20px]" id="onboarding-title">
                {step.title}
              </h3>
              <p
                className="text-sm text-white/50 leading-[22px] min-h-[44px]"
                id="onboarding-description"
              >
                {step.description}
              </p>
            </div>
            {/* Close button */}
            <button
              aria-label="Skip onboarding tour"
              className="flex items-center justify-center size-5 shrink-0 rounded-full bg-white/10 hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onSkip}
              type="button"
            >
              <CrossSmall className="size-4 text-white/60" />
            </button>
          </div>

          {/* Footer: Pagination dots and Next/Done button */}
          <div className="flex items-center justify-between">
            {/* Pagination dots */}
            <div
              aria-label={`Step ${currentStepIndex + 1} of ${totalSteps}`}
              className="flex items-center gap-1.5"
              role="tablist"
            >
              {Array.from({ length: totalSteps }).map((_, index) => (
                <button
                  aria-label={`Go to step ${index + 1}`}
                  aria-selected={index === currentStepIndex}
                  className={cn(
                    'size-[6px] rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    index === currentStepIndex
                      ? 'bg-white'
                      : 'bg-white/30 hover:bg-white/50 cursor-pointer',
                  )}
                  key={index}
                  onClick={() => onGoToStep(index)}
                  role="tab"
                  type="button"
                />
              ))}
            </div>

            {/* Next/Done button */}
            <Button
              className="h-[38px] px-4 text-sm font-medium bg-white text-black hover:bg-white/90 rounded-[10px]"
              onClick={handleNextOrDone}
              variant="primary"
            >
              {isLastStep ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
