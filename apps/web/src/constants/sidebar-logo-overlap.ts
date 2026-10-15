import type { OverlapAvoidSelector } from '@/hooks/useSelectorOverlap'

export type SidebarLogoOverlapHandlingMode = 'hide-logo' | 'hide-other-object' | 'none'

// Global switch for sidebar/logo collision handling.
export const SIDEBAR_LOGO_OVERLAP_HANDLING_MODE = 'hide-logo' as SidebarLogoOverlapHandlingMode

export const SIDEBAR_LOGO_SELECTOR = '[data-sidebar-logo]'
export const SIDEBAR_LOGO_OVERLAP_MARKER_ATTR = 'data-sidebar-logo-overlap-marker'
export const SIDEBAR_LOGO_OVERLAP_MARKER_SELECTOR = `[${SIDEBAR_LOGO_OVERLAP_MARKER_ATTR}]`
export const SIDEBAR_LOGO_OVERLAP_MARKER = 'dashboard-v2-template-list-header'
export const SIDEBAR_LOGO_OVERLAP_MARKER_SELECTORS = [SIDEBAR_LOGO_OVERLAP_MARKER_SELECTOR]

export const HEADER_OVERLAP_AVOID_SELECTORS: OverlapAvoidSelector[] = [
  { direction: 'right', selector: SIDEBAR_LOGO_SELECTOR },
]

export const IS_SIDEBAR_LOGO_OVERLAP_LOGO_SIDE = SIDEBAR_LOGO_OVERLAP_HANDLING_MODE === 'hide-logo'

export const IS_SIDEBAR_LOGO_OVERLAP_OTHER_SIDE =
  SIDEBAR_LOGO_OVERLAP_HANDLING_MODE === 'hide-other-object'
