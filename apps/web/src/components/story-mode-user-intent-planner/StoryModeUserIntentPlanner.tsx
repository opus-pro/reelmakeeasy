'use client'

import { cn, useIsScrolling } from '@shared/ui'
import { useAtomValue, useStore } from 'jotai'
import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useStickToBottom } from '@/hooks/useStickToBottom'
import { useIsMobile } from '@/util/browserUtils'

import { BottomPanel } from './planner/BottomPanel'
import { UserOperationHeartbeatEffect } from './planner/hooks/useUserOperationHeartbeat'
import { SelectTextOverlay } from './planner/SelectTextOverlay'
import { StageTwoBrandDialog } from './planner/StageTwoBrandDialog'
import { getVisibleTimelineBlocks, TimelineList } from './planner/TimelineList'
import { getPlannerFatalErrorAtom, getRenderStateAtom } from './state/atoms/planner'
import { getPlannerScopeElementAtom, getScrollInnerElementAtom } from './state/atoms/planner'
import { getSendQueueAtom } from './state/atoms/send-queue'
import { PlannerStateProvider } from './state/planner-context'
import { usePlannerState } from './state/planner-context'
import { createPlannerState, type PlannerState } from './state/planner-state'
import type { PlannerFatalError } from './state-types'

export interface StoryModeUserIntentPlannerProps {
  className?: string
  scrollContentClassName?: string
  /**
   * Set by StoryModeCanvas (uid_revamp): drops artifacts the canvas already
   * shows (script, voiceover, ready video) from the chat timeline, and hides
   * confirm/review gates here since StoryModeCanvas renders them itself via
   * ConfirmGateSlot, floating over the main canvas.
   */
  shouldHideArtifacts?: boolean
  /**
   * Set by StoryModeCanvas (uid_revamp): switches the panel to the
   * clearly-defined canvas look -- translucent glass fill (no vignette, no
   * composer backdrop) -- instead of the legacy solid bg-background fill
   * with a fade-to-opaque gradient behind the composer.
   * Old-UI (StoryModeUserIntentPlannerDialog) never sets this.
   */
  shouldUseCanvasStyle?: boolean
  state?: PlannerState
}

export interface StoryModeUserIntentPlannerRef {
  getState: () => PlannerState
}

interface ScrollMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

const SCROLL_BOTTOM_PIN_THRESHOLD_PX = 24

function readScrollMetrics(el: HTMLDivElement): ScrollMetrics {
  return {
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
  }
}

export const StoryModeUserIntentPlanner = forwardRef<
  StoryModeUserIntentPlannerRef,
  StoryModeUserIntentPlannerProps
>(function StoryModeUserIntentPlanner(
  { className, shouldHideArtifacts, shouldUseCanvasStyle, scrollContentClassName, state },
  ref,
) {
  const store = useStore()
  const internalState = useMemo(() => createPlannerState(store), [store])
  const resolvedState = state ?? internalState
  const resolvedStateRef = useRef(resolvedState)
  resolvedStateRef.current = resolvedState

  useImperativeHandle(
    ref,
    () => ({
      getState: () => resolvedStateRef.current,
    }),
    [],
  )

  return (
    <PlannerStateProvider value={resolvedState}>
      <StoryModeUserIntentPlannerInner
        className={className}
        scrollContentClassName={scrollContentClassName}
        shouldHideArtifacts={shouldHideArtifacts}
        shouldUseCanvasStyle={shouldUseCanvasStyle}
      />
    </PlannerStateProvider>
  )
})

function getPlannerFatalErrorContent(error: PlannerFatalError): { message: string; title: string } {
  const { type } = error
  if (type === 'unauthorized') {
    return {
      message: 'Refresh the page and try again.',
      title: "You don't have access to this project",
    }
  }
  return { title: `Unknown error ${type}`, message: '' }
}

function StoryModeUserIntentPlannerContent({
  className,
  shouldHideArtifacts,
  shouldUseCanvasStyle,
  scrollContentClassName,
}: {
  className?: string
  scrollContentClassName?: string
  shouldHideArtifacts?: boolean
  shouldUseCanvasStyle?: boolean
}) {
  const state = usePlannerState()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isScrolling = useIsScrolling(scrollRef)
  // With the canvas dock in flow, this timeline is structurally what useStickToBottom was
  // written for -- it observes the viewport precisely because a shrink-0 composer sibling changes
  // clientHeight without changing content size. Wiring its refs (canvas only, below) hands it every
  // pin the canvas needs: the initial backlog, new blocks, a growing composer, and each frame of the
  // 300ms pane-width animation on the two-panel flip, which re-wraps messages across many frames
  // that a one-shot write would go stale on. It follows only while the reader is at the
  // bottom. The hook stays inert while its content ref is unset, so the legacy dialog keeps the
  // hand-rolled effects below.
  const {
    contentRef: stickToBottomContentRef,
    pin: stickToBottomPin,
    viewportRef: stickToBottomViewportRef,
  } = useStickToBottom<HTMLDivElement>()
  const scrollInnerElRef = useRef<HTMLDivElement | null>(null)
  const bottomPanelElRef = useRef<HTMLDivElement | null>(null)
  const [bottomPanelEl, setBottomPanelEl] = useState<HTMLDivElement | null>(null)
  const [scrollInnerEl, setScrollInnerEl] = useState<HTMLDivElement | null>(null)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(0)
  const [scrollVerticalGutterPx, setScrollVerticalGutterPx] = useState(0)
  const previousBottomPanelHeightRef = useRef(0)
  const scrollMetricsRef = useRef<null | ScrollMetrics>(null)
  const bottomPanelPaddingRightPx = scrollVerticalGutterPx + (isMobile ? 12 : 0)
  // On canvas the panel is a flow sibling of the scroll area, with no scroll-edge mask. Nothing can pass behind the panel, so the tips row needs no fill of its own, and the
  // block sits near the pane's bottom edge. The legacy planner keeps the absolute dock it was
  // tuned for.
  // z-20 belongs to the absolute dock, which stacks over the scroll area it covers; the flow dock
  // shares no space with anything and needs no stacking of its own.
  // The flow dock carries no top padding -- the gap to the last timeline block is the
  // scroll content's pb-6, so one value owns it and the measured panel height stays the panel's.
  // Padding is mobile-first in CSS rather than branched on useIsMobile: the hook resolves after
  // hydration, so a JS-picked class reflows the dock on load. sm: is the same 640px boundary.
  const dockClassName = shouldUseCanvasStyle
    ? 'shrink-0 px-3 pb-3 sm:px-0 sm:pb-2'
    : 'pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 py-4 sm:px-0 sm:py-6'

  // Auto-scroll: trigger when a new block appears at the bottom or isProcessing changes.
  // paddingBottom already reserves space for the bottom panel, so scrolling to scrollHeight
  // naturally keeps the thinking block visible above it. Keyed on the visible blocks so
  // canvas-hidden artifact updates cannot yank the scroll position.
  // Legacy only: on canvas useStickToBottom follows the content resize instead, which also stops
  // a new block from yanking a reader who has scrolled up into history.
  const renderState = useAtomValue(getRenderStateAtom(state))
  // Canvas only: re-pin on submit, whatever scroll position the reader is at -- a scroll up into
  // history releases the follow, and a submit is a request to see the newest content.
  // Keyed on the newest queued send's id rather than a pending flag: every submit enqueues an item
  // with a fresh id (enqueueAndFlush, shared by the composer and quick options), so a second send
  // while the first is still in flight is its own signal. Draining the queue only removes items, so
  // it never mints an id this has not already pinned for.
  const sendQueue = useAtomValue(getSendQueueAtom(state))
  const lastQueuedSendId = sendQueue[sendQueue.length - 1]?.id
  const pinnedForSendIdRef = useRef(lastQueuedSendId)
  useEffect(() => {
    if (lastQueuedSendId === pinnedForSendIdRef.current) {
      return
    }
    pinnedForSendIdRef.current = lastQueuedSendId
    if (lastQueuedSendId && shouldUseCanvasStyle) {
      stickToBottomPin()
    }
  }, [lastQueuedSendId, shouldUseCanvasStyle, stickToBottomPin])
  const visibleTimelineBlocks = getVisibleTimelineBlocks(renderState.blocks, shouldHideArtifacts)
  const lastBlockId = visibleTimelineBlocks[visibleTimelineBlocks.length - 1]?.id
  const { isProcessing } = renderState
  const quickOptionsKey = renderState.quickOptions.map((option) => option.id).join('|')
  // Mirrors BottomPanel's showAssetStrip condition: the "+" strip changes composer height, so the pin must re-fire.
  const showAssetStrip =
    !isMobile && (renderState.phase === 'bootstrap_visual' || renderState.phase === 'refinement')
  const timelineScrollKey = `${lastBlockId ?? ''}:${isProcessing ? 'processing' : 'idle'}:${quickOptionsKey}:${showAssetStrip ? 'strip' : 'nostrip'}`
  const previousTimelineScrollKeyRef = useRef<null | string>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || shouldUseCanvasStyle) {
      return
    }

    if (previousTimelineScrollKeyRef.current === timelineScrollKey) {
      return
    }

    previousTimelineScrollKeyRef.current = timelineScrollKey
    el.scrollTop = el.scrollHeight
    scrollMetricsRef.current = readScrollMetrics(el)
  }, [shouldUseCanvasStyle, timelineScrollKey])

  // Scrollbar is inside the overflow-y region, so clientWidth excludes it, but the bottom dock
  // is centered in the full section width. Add padding to match the scroll body width.
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) {
      return
    }

    const measure = () => {
      setScrollVerticalGutterPx(Math.max(0, scroll.offsetWidth - scroll.clientWidth))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    if (scrollInnerEl) {
      observer.observe(scrollInnerEl)
    }
    return () => observer.disconnect()
  }, [scrollInnerEl])

  useLayoutEffect(() => {
    if (!bottomPanelEl) {
      return
    }

    const measure = (entry?: ResizeObserverEntry) => {
      const nextHeight = entry?.borderBoxSize[0]?.blockSize ?? bottomPanelEl.offsetHeight
      setBottomPanelHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight,
      )
    }

    measure()
    const observer = new ResizeObserver(([entry]) => measure(entry))
    observer.observe(bottomPanelEl)
    return () => observer.disconnect()
  }, [bottomPanelEl])

  // Reconcile scroll after paddingBottom/gutter re-renders. ResizeObserver only schedules work;
  // this effect is the single place that writes scrollTop after React has applied layout state.
  // Legacy only: the absolute dock covers the viewport's bottom, so a taller dock has to be
  // answered by scrolling down to keep the reader's content out from behind it. The canvas dock is
  // in flow, where a taller dock shrinks the scroller instead of covering it -- useStickToBottom
  // follows that viewport resize, and compensating on top of it would jump the reader.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || shouldUseCanvasStyle) {
      return
    }

    const previousHeight = previousBottomPanelHeightRef.current
    const panelDelta = bottomPanelHeight - previousHeight
    previousBottomPanelHeightRef.current = bottomPanelHeight

    if (panelDelta === 0) {
      scrollMetricsRef.current = readScrollMetrics(el)
      return
    }

    const previousMetrics = scrollMetricsRef.current
    const previousDistanceToBottom = previousMetrics
      ? previousMetrics.scrollHeight - previousMetrics.clientHeight - previousMetrics.scrollTop
      : el.scrollHeight - el.clientHeight - el.scrollTop

    if (previousDistanceToBottom <= SCROLL_BOTTOM_PIN_THRESHOLD_PX) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTop += panelDelta
    }

    scrollMetricsRef.current = readScrollMetrics(el)
  }, [bottomPanelHeight, shouldUseCanvasStyle])

  // Both the viewport and the content need two refs: the planner's own (gutter measurement, the
  // scroll-element atom) and useStickToBottom's. The hook's are only handed the node on canvas --
  // with its content ref unset its effect returns early, leaving the legacy dialog on the
  // hand-rolled effects above.
  const handleScrollViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (shouldUseCanvasStyle) {
        stickToBottomViewportRef.current = node
      }
    },
    [shouldUseCanvasStyle, stickToBottomViewportRef],
  )

  const handleScrollInnerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (scrollInnerElRef.current === node) {
        return
      }
      scrollInnerElRef.current = node
      setScrollInnerEl(node)
      state.set(getScrollInnerElementAtom, node)
      if (shouldUseCanvasStyle) {
        stickToBottomContentRef(node)
      }
    },
    [shouldUseCanvasStyle, state, stickToBottomContentRef],
  )

  const handleBottomPanelRef = useCallback((node: HTMLDivElement | null) => {
    if (bottomPanelElRef.current === node) {
      return
    }
    bottomPanelElRef.current = node
    setBottomPanelEl(node)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    scrollMetricsRef.current = readScrollMetrics(el)
  }, [])

  return (
    <StoryModeUserIntentPlannerShell
      className={className}
      shouldUseCanvasStyle={shouldUseCanvasStyle}
    >
      {(renderState.scriptReviewGate || renderState.autoLockGate) && (
        <UserOperationHeartbeatEffect />
      )}
      <div
        className={cn(
          'scrollbar-thin scrollbar-reveal relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]',
          isScrolling && 'is-scrolling',
        )}
        onScroll={handleScroll}
        ref={handleScrollViewportRef}
        style={
          {
            '--bottom-panel-height': `${bottomPanelHeight}px`,
            '--scroll-gutter-px': `${scrollVerticalGutterPx}px`,
          } as CSSProperties
        }
      >
        <div
          className={cn(
            'relative mx-auto flex w-full flex-col',
            // The gate-card design frames draw the card 800 wide; the old
            // max-w-[800px] minus the 24px gutters rendered the whole column (and the
            // gate card with it) at 752. 848 keeps the gutters and puts content at 800.
            isMobile ? 'max-w-full px-4 pt-4' : 'max-w-[848px] px-6 pt-6',
            // The last block clears the flow dock by the same 24px the timeline puts
            // between blocks, so a tail thinking row reads evenly padded instead of pressed into
            // the composer. The legacy dock is absolute and reserves its space below instead.
            shouldUseCanvasStyle && 'pb-6',
            scrollContentClassName,
          )}
          data-testid="uip-scroll-content"
          ref={handleScrollInnerRef}
          // Canvas reserves the panel's space by laying it out in flow, so padding here would
          // double it. The legacy dock is absolute and still needs the reservation.
          style={{ paddingBottom: shouldUseCanvasStyle ? undefined : bottomPanelHeight }}
        >
          <div className="flex flex-col gap-6">
            <TimelineList
              shouldHideArtifacts={shouldHideArtifacts}
              shouldUseCanvasStyle={shouldUseCanvasStyle}
              // Canvas user bubbles are the warm brown surface; the legacy planner
              // dialog keeps the translucent-white default.
              userMessageTone={shouldUseCanvasStyle ? 'warm' : 'neutral'}
            />
          </div>

          <SelectTextOverlay />
        </div>
      </div>

      {shouldUseCanvasStyle ? null : (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-[linear-gradient(180deg,rgba(26,26,26,0)_0%,rgba(26,26,26,0.52)_46%,rgba(26,26,26,0.94)_100%)]"
            style={{
              bottom: bottomPanelHeight - 60,
              height: 60,
              marginRight: scrollVerticalGutterPx,
            }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-[linear-gradient(180deg,rgba(26,26,26,0)_0%,rgba(26,26,26,0.52)_46%,rgba(26,26,26,0.94)_100%)] [backdrop-filter:blur(15px)]"
            style={{ height: bottomPanelHeight - 24, marginRight: scrollVerticalGutterPx }}
          />
        </>
      )}

      <div
        className={cn('flex justify-center', dockClassName)}
        data-testid="uip-bottom-dock"
        ref={handleBottomPanelRef}
        style={{ paddingRight: bottomPanelPaddingRightPx }}
      >
        <div
          className={cn(
            'flex flex-col gap-2 pointer-events-auto w-full',
            // Matches the scroll column's D-21 widening above -- dock and column must
            // share one width or the gate card misaligns with the timeline.
            isMobile ? 'max-w-full' : 'max-w-[848px] px-6',
          )}
        >
          <BottomPanel
            shouldHideArtifacts={shouldHideArtifacts}
            shouldUseCanvasStyle={shouldUseCanvasStyle}
          />
        </div>
      </div>
      <StageTwoBrandDialog />
    </StoryModeUserIntentPlannerShell>
  )
}

function StoryModeUserIntentPlannerFatalError({
  className,
  error,
  shouldUseCanvasStyle,
}: {
  className?: string
  error: PlannerFatalError
  shouldUseCanvasStyle?: boolean
}) {
  const content = getPlannerFatalErrorContent(error)

  return (
    <StoryModeUserIntentPlannerShell
      className={className}
      shouldUseCanvasStyle={shouldUseCanvasStyle}
    >
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <div className="max-w-[420px]">
          <div className="text-[20px] font-semibold leading-7 text-white">{content.title}</div>
          <div className="mt-2 text-[14px] leading-6 text-white/62">{content.message}</div>
        </div>
      </div>
    </StoryModeUserIntentPlannerShell>
  )
}

function StoryModeUserIntentPlannerInner({
  className,
  shouldHideArtifacts,
  shouldUseCanvasStyle,
  scrollContentClassName,
}: {
  className?: string
  scrollContentClassName?: string
  shouldHideArtifacts?: boolean
  shouldUseCanvasStyle?: boolean
}) {
  const state = usePlannerState()
  const fatalError = useAtomValue(getPlannerFatalErrorAtom(state))

  if (fatalError) {
    return (
      <StoryModeUserIntentPlannerFatalError
        className={className}
        error={fatalError}
        shouldUseCanvasStyle={shouldUseCanvasStyle}
      />
    )
  }

  return (
    <StoryModeUserIntentPlannerContent
      className={className}
      scrollContentClassName={scrollContentClassName}
      shouldHideArtifacts={shouldHideArtifacts}
      shouldUseCanvasStyle={shouldUseCanvasStyle}
    />
  )
}

function StoryModeUserIntentPlannerShell({
  children,
  className,
  shouldUseCanvasStyle,
}: {
  children: ReactNode
  className?: string
  shouldUseCanvasStyle?: boolean
}) {
  const state = usePlannerState()
  const plannerScopeElRef = useRef<HTMLElement | null>(null)

  const handlePlannerScopeRef = useCallback(
    (node: HTMLElement | null) => {
      if (plannerScopeElRef.current === node) {
        return
      }
      plannerScopeElRef.current = node
      state.set(getPlannerScopeElementAtom, node)
    },
    [state],
  )

  return (
    <section
      className={cn(
        'relative isolate flex h-full w-full flex-col overflow-hidden text-white selection:bg-[#ff8000]/50 selection:text-white',
        // Canvas mode: no own background -- the Workbench `side` wrapper (the only
        // caller passing shouldUseCanvasStyle) already paints the translucent glass
        // fill, so painting it again here would double-stack the alpha and read
        // visibly brighter than the single-layer edit modals.
        !shouldUseCanvasStyle && 'bg-background',
        className,
      )}
      data-testid="story-mode-user-intent-planner"
      ref={handlePlannerScopeRef}
    >
      {!shouldUseCanvasStyle && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(52,52,52,0.42)_0%,rgba(26,26,26,0.95)_70%)]" />
      )}
      {children}
    </section>
  )
}
