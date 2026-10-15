type DashboardTopBannerMode = 'fallback' | 'timeline'
type HotModuleLike = {
  hot?: {
    dispose: (callback: () => void) => void
  }
}

const DASHBOARD_TOP_BANNER_STYLE_ID = 'dashboard-top-full-banner-style'
const DASHBOARD_TOP_BANNER_ROOT_ATTR = 'data-dashboard-top-full-banner'
const DASHBOARD_TOP_BANNER_MODE_ATTR = 'data-dashboard-top-full-banner-mode'
const DASHBOARD_TOP_BANNER_SOURCE_ATTR = 'data-dashboard-top-full-banner-source'
const DASHBOARD_TOP_BANNER_VISIBLE_HEIGHT_VAR = '--dashboard-top-promo-visible-height'
const DASHBOARD_TOP_BANNER_TOTAL_HEIGHT_VAR = '--dashboard-top-promo-total-height'
const DASHBOARD_TOP_BANNER_IDLE_MS = 140
const DASHBOARD_TOP_BANNER_TIMELINE_NAME = '--dashboard-top-full-banner-timeline'

const DASHBOARD_TOP_BANNER_STYLE_TEXT = `
@media (min-width: 768px) {
  :root[data-dashboard-top-full-banner="1"] [data-dashboard-sidebar-sticky-root] {
    margin-top: calc(-1 * var(--dashboard-top-promo-total-height, 0px));
  }

  :root[data-dashboard-top-full-banner="1"][data-dashboard-top-full-banner-mode="fallback"] [data-sidebar-logo],
  :root[data-dashboard-top-full-banner="1"][data-dashboard-top-full-banner-mode="fallback"] [data-global-floating-blocks] {
    transform: translate3d(0, var(--dashboard-top-promo-visible-height, 0px), 0);
    will-change: transform;
  }

  @supports (animation-timeline: auto) and (view-timeline-name: --dashboard-top-full-banner-timeline) and (timeline-scope: --dashboard-top-full-banner-timeline) and (animation-range: entry 0% exit 100%) {
    :root[data-dashboard-top-full-banner="1"][data-dashboard-top-full-banner-mode="timeline"] {
      timeline-scope: --dashboard-top-full-banner-timeline;
    }

    :root[data-dashboard-top-full-banner="1"][data-dashboard-top-full-banner-mode="timeline"] [data-dashboard-top-full-banner-source="1"] {
      view-timeline-name: --dashboard-top-full-banner-timeline;
      view-timeline-axis: block;
    }

    :root[data-dashboard-top-full-banner="1"][data-dashboard-top-full-banner-mode="timeline"] [data-sidebar-logo],
    :root[data-dashboard-top-full-banner="1"][data-dashboard-top-full-banner-mode="timeline"] [data-global-floating-blocks] {
      animation-duration: 1s;
      animation-fill-mode: both;
      animation-name: dashboard-top-full-banner-follow;
      animation-range: exit 0% exit 100%;
      animation-timeline: --dashboard-top-full-banner-timeline;
      animation-timing-function: linear;
      will-change: transform;
    }
  }
}

@keyframes dashboard-top-full-banner-follow {
  0% {
    transform: translate3d(0, var(--dashboard-top-promo-total-height, 0px), 0);
  }

  100% {
    transform: translate3d(0, 0, 0);
  }
}
`

const ownerStack: string[] = []
const tokenElementMap = new Map<string, HTMLElement | null>()

let animationFrameId: null | number = null
let hasBoundListeners = false
let lastInteractionTs = 0
let lastTotalHeight = -1
let lastVisibleHeight = -1
let resolvedMode: DashboardTopBannerMode | null = null
let timelineObservedElement: HTMLElement | null = null
let timelineResizeObserver: null | ResizeObserver = null
let activeSourceElement: HTMLElement | null = null
let scrollContainerOverride: HTMLElement | null = null

registerHotModuleReset()

export function registerDashboardTopBannerOwner(token: string): void {
  if (!token || ownerStack.includes(token)) {
    return
  }

  ownerStack.push(token)
  ensureListeners()
  markInteraction()
  startLoop()
}

export function setDashboardTopBannerOwnerElement(
  token: string,
  element: HTMLElement | null,
): void {
  if (!token || !ownerStack.includes(token)) {
    return
  }

  tokenElementMap.set(token, element)

  if (getActiveToken() === token) {
    markInteraction()
    startLoop()
  }
}

export function setDashboardTopBannerScrollContainer(element: HTMLElement | null): void {
  if (scrollContainerOverride === element) {
    return
  }

  if (hasBoundListeners && getMode() === 'fallback') {
    const oldTarget: EventTarget = scrollContainerOverride ?? window
    oldTarget.removeEventListener('scroll', handleActivity)
    const newTarget: EventTarget = element ?? window
    newTarget.addEventListener('scroll', handleActivity, { passive: true })
  }

  scrollContainerOverride = element
}

export function unregisterDashboardTopBannerOwner(token: string): void {
  if (!token) {
    return
  }

  const existingIndex = ownerStack.indexOf(token)
  if (existingIndex === -1) {
    return
  }

  ownerStack.splice(existingIndex, 1)
  tokenElementMap.delete(token)

  if (ownerStack.length === 0) {
    teardownController()
    return
  }

  markInteraction()
  startLoop()
}

function clearGlobalStyle() {
  const root = document.documentElement
  root.removeAttribute(DASHBOARD_TOP_BANNER_ROOT_ATTR)
  root.removeAttribute(DASHBOARD_TOP_BANNER_MODE_ATTR)
  document.getElementById(DASHBOARD_TOP_BANNER_STYLE_ID)?.remove()
  root.style.removeProperty(DASHBOARD_TOP_BANNER_VISIBLE_HEIGHT_VAR)
  root.style.removeProperty(DASHBOARD_TOP_BANNER_TOTAL_HEIGHT_VAR)
  lastVisibleHeight = -1
  lastTotalHeight = -1
}

function ensureGlobalStyle() {
  const root = document.documentElement
  root.setAttribute(DASHBOARD_TOP_BANNER_ROOT_ATTR, '1')
  root.setAttribute(DASHBOARD_TOP_BANNER_MODE_ATTR, getMode())
  ensureStyleElement()
}

function ensureListeners() {
  if (hasBoundListeners || typeof window === 'undefined') {
    return
  }

  window.addEventListener('resize', handleActivity)
  if (getMode() === 'fallback') {
    const scrollTarget: EventTarget = scrollContainerOverride ?? window
    scrollTarget.addEventListener('scroll', handleActivity, { passive: true })
  }
  hasBoundListeners = true
}

function ensureStyleElement() {
  const existingStyle = document.getElementById(DASHBOARD_TOP_BANNER_STYLE_ID)
  if (existingStyle instanceof HTMLStyleElement) {
    return existingStyle
  }

  const styleElement = document.createElement('style')
  styleElement.id = DASHBOARD_TOP_BANNER_STYLE_ID
  styleElement.textContent = DASHBOARD_TOP_BANNER_STYLE_TEXT
  document.head.appendChild(styleElement)
  return styleElement
}

function getActiveElement(): HTMLElement | null {
  const activeToken = getActiveToken()
  if (!activeToken) {
    return null
  }

  const activeElement = tokenElementMap.get(activeToken) ?? null
  if (!activeElement?.isConnected) {
    return null
  }

  return activeElement
}

function getActiveToken(): null | string {
  return ownerStack.length > 0 ? ownerStack[ownerStack.length - 1] : null
}

function getMode(): DashboardTopBannerMode {
  if (resolvedMode) {
    return resolvedMode
  }

  if (typeof window === 'undefined') {
    resolvedMode = 'fallback'
    return resolvedMode
  }

  resolvedMode = supportsTimelineMode() ? 'timeline' : 'fallback'
  return resolvedMode
}

function handleActivity() {
  markInteraction()

  if (getMode() === 'fallback') {
    syncFallbackImmediatelyIfNeeded()
  }

  startLoop()
}

function markInteraction() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    lastInteractionTs = performance.now()
    return
  }

  lastInteractionTs = Date.now()
}

function measureLayout(element: HTMLElement | null): {
  totalHeight: number
  visibleHeight: number
} {
  if (!element) {
    return { totalHeight: 0, visibleHeight: 0 }
  }

  const rect = element.getBoundingClientRect()
  const totalHeight = Math.max(0, Math.round(rect.height))
  const visibleHeight = Math.max(
    0,
    Math.round(Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)),
  )

  return { totalHeight, visibleHeight }
}

function registerHotModuleReset() {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
    return
  }

  const maybeModule =
    typeof module === 'undefined' ? undefined : (module as unknown as HotModuleLike)
  maybeModule?.hot?.dispose(() => {
    resetControllerState()
  })
}

function removeListeners() {
  if (!hasBoundListeners || typeof window === 'undefined') {
    return
  }

  window.removeEventListener('resize', handleActivity)
  const scrollTarget: EventTarget = scrollContainerOverride ?? window
  scrollTarget.removeEventListener('scroll', handleActivity)
  hasBoundListeners = false
}

function resetControllerState() {
  teardownController()
  ownerStack.length = 0
  tokenElementMap.clear()
  hasBoundListeners = false
  lastInteractionTs = 0
  lastVisibleHeight = -1
  lastTotalHeight = -1
  resolvedMode = null
  scrollContainerOverride = null
}

function setActiveSourceElement(element: HTMLElement | null) {
  if (activeSourceElement === element) {
    return
  }

  if (activeSourceElement) {
    activeSourceElement.removeAttribute(DASHBOARD_TOP_BANNER_SOURCE_ATTR)
  }

  activeSourceElement = element
  if (activeSourceElement) {
    activeSourceElement.setAttribute(DASHBOARD_TOP_BANNER_SOURCE_ATTR, '1')
  }
}

function setVarsIfChanged(visibleHeight: number, totalHeight: number) {
  if (visibleHeight === lastVisibleHeight && totalHeight === lastTotalHeight) {
    return
  }

  lastVisibleHeight = visibleHeight
  lastTotalHeight = totalHeight

  const root = document.documentElement
  root.style.setProperty(DASHBOARD_TOP_BANNER_VISIBLE_HEIGHT_VAR, `${visibleHeight}px`)
  root.style.setProperty(DASHBOARD_TOP_BANNER_TOTAL_HEIGHT_VAR, `${totalHeight}px`)
}

function startLoop() {
  if (animationFrameId != null || typeof window === 'undefined') {
    return
  }

  if (lastInteractionTs <= 0) {
    markInteraction()
  }

  animationFrameId = window.requestAnimationFrame(syncLoop)
}

function stopTimelineResizeObserver() {
  if (timelineResizeObserver && timelineObservedElement) {
    timelineResizeObserver.unobserve(timelineObservedElement)
  }
  timelineObservedElement = null

  if (!timelineResizeObserver) {
    return
  }

  timelineResizeObserver.disconnect()
  timelineResizeObserver = null
}

function supportsTimelineMode() {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return false
  }

  return (
    CSS.supports('animation-timeline: auto') &&
    CSS.supports(`view-timeline-name: ${DASHBOARD_TOP_BANNER_TIMELINE_NAME}`) &&
    CSS.supports(`timeline-scope: ${DASHBOARD_TOP_BANNER_TIMELINE_NAME}`) &&
    CSS.supports('animation-range: exit 0% exit 100%')
  )
}

function syncFallbackImmediatelyIfNeeded() {
  if (!getActiveToken()) {
    return
  }

  syncFallbackLayout()
}

function syncFallbackLayout() {
  ensureGlobalStyle()
  setActiveSourceElement(null)
  stopTimelineResizeObserver()

  const activeElement = getActiveElement()
  const { totalHeight, visibleHeight } = measureLayout(activeElement)
  setVarsIfChanged(visibleHeight, totalHeight)
}

function syncLoop(timestamp: number) {
  animationFrameId = null

  if (!getActiveToken()) {
    teardownController()
    return
  }

  if (getMode() === 'timeline') {
    syncTimelineLayout()
    return
  }

  syncFallbackLayout()

  if (timestamp - lastInteractionTs < DASHBOARD_TOP_BANNER_IDLE_MS) {
    animationFrameId = window.requestAnimationFrame(syncLoop)
  }
}

function syncTimelineLayout() {
  ensureGlobalStyle()

  const activeElement = getActiveElement()
  setActiveSourceElement(activeElement)
  updateTimelineResizeObserver(activeElement)

  const { totalHeight } = measureLayout(activeElement)
  setVarsIfChanged(0, totalHeight)
}

function teardownController() {
  if (animationFrameId != null) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  removeListeners()
  stopTimelineResizeObserver()
  setActiveSourceElement(null)
  clearGlobalStyle()
}

function updateTimelineResizeObserver(element: HTMLElement | null) {
  if (getMode() !== 'timeline') {
    stopTimelineResizeObserver()
    return
  }

  if (typeof ResizeObserver === 'undefined') {
    stopTimelineResizeObserver()
    return
  }

  if (timelineObservedElement === element) {
    return
  }

  if (!timelineResizeObserver) {
    timelineResizeObserver = new ResizeObserver(() => {
      markInteraction()
      startLoop()
    })
  }

  if (timelineObservedElement) {
    timelineResizeObserver.unobserve(timelineObservedElement)
  }

  timelineObservedElement = element
  if (timelineObservedElement) {
    timelineResizeObserver.observe(timelineObservedElement)
  }
}
