import { atom } from 'jotai'

import { atomWithPersistence } from './common'

// Sidebar width atom with localStorage persistence
// Default to 30% sidebar width
export const sidebarWidthAtom = atomWithPersistence<number>('ui:sidebar-width-percent', 0)

// Mobile menu overlay visibility (revamp nav only)
export const mobileMenuOpenAtom = atom(false)
mobileMenuOpenAtom.debugLabel = 'mobile-menu-open-atom'

// Set true when the mobile Create tab is tapped while already on /create. The
// route does not change in that case, so navigation alone cannot bring the user
// back to the use-case grid. The create page consumes this flag and resets it.
export const resetMobileCreateGridAtom = atom(false)
resetMobileCreateGridAtom.debugLabel = 'reset-mobile-create-grid-atom'

// True while the mobile create use-case grid is visible. Used to hide the
// bottom tab bar so it doesn't overlap the grid.
export const mobileCreateUseCaseGridVisibleAtom = atom(false)
mobileCreateUseCaseGridVisibleAtom.debugLabel = 'mobile-create-use-case-grid-visible-atom'

export type EnterPromptCtaState = 'collapsed' | 'expanded' | 'not-present'

// Mobile revamp CTA state. The bottom tab bar owns the shared backdrop and uses
// this to extend its blur/gradient behind the floating prompt CTA when present.
export const enterPromptCtaStateAtom = atom<EnterPromptCtaState>('not-present')
enterPromptCtaStateAtom.debugLabel = 'enter-prompt-cta-state-atom'

// Mute state for the QuickStartTemplateDialog video player, isolated from the
// gallery so opening the dialog never triggers gallery card re-renders.
// Starts unmuted: the user explicitly clicked to watch.
export const dialogVideoMutedAtom = atom(false)
dialogVideoMutedAtom.debugLabel = 'dialog-video-muted-atom'

// Shared volume level for template video cards (0-1); default full volume
export const videoCardVolumeAtom = atom(1)
videoCardVolumeAtom.debugLabel = 'video-card-volume-atom'

// A stack of hide requests for the global floating notification slot.
// If at least one request exists, the slot should be hidden.
const globalFloatingNotificationSlotHideStackAtom = atom<string[]>([])
globalFloatingNotificationSlotHideStackAtom.debugLabel =
  'global-floating-notification-slot-hide-stack-atom'

export const isGlobalFloatingNotificationSlotHiddenAtom = atom(
  (get) => get(globalFloatingNotificationSlotHideStackAtom).length > 0,
)
isGlobalFloatingNotificationSlotHiddenAtom.debugLabel =
  'is-global-floating-notification-slot-hidden-atom'

export const pushGlobalFloatingNotificationSlotHideTokenAtom = atom(
  null,
  (get, set, token: string) => {
    if (!token) {
      return
    }
    const currentStack = get(globalFloatingNotificationSlotHideStackAtom)
    if (currentStack.includes(token)) {
      return
    }
    set(globalFloatingNotificationSlotHideStackAtom, [...currentStack, token])
  },
)
pushGlobalFloatingNotificationSlotHideTokenAtom.debugLabel =
  'push-global-floating-notification-slot-hide-token-atom'

export const popGlobalFloatingNotificationSlotHideTokenAtom = atom(
  null,
  (get, set, token: string) => {
    if (!token) {
      return
    }
    const currentStack = get(globalFloatingNotificationSlotHideStackAtom)
    if (currentStack.length === 0) {
      return
    }
    const nextStack = currentStack.filter((item) => item !== token)
    if (nextStack.length === currentStack.length) {
      return
    }
    set(globalFloatingNotificationSlotHideStackAtom, nextStack)
  },
)
popGlobalFloatingNotificationSlotHideTokenAtom.debugLabel =
  'pop-global-floating-notification-slot-hide-token-atom'
