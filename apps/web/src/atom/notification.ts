import { atom } from 'jotai'

// True while the config-driven GlobalPopup dialog is on screen. Other floating
// surfaces (e.g. the AI-model discovery tooltip) must hold themselves hidden
// while this is set so two popups never overlap.
export const isGlobalPopupOpenAtom = atom(false)

// True while an inpaint editing session is open. The takeover owns the viewer
// and the coachmark is rendered through a portal, so the takeover's chrome
// hiding cannot reach it -- the viewer tour reads this to retire its
// remaining steps instead of floating over the editor.
export const isInpaintSessionActiveAtom = atom(false)

// The submission box's two action slots each publish their own overlay state.
// A single shared boolean was last-writer-wins: closing one slot's menu while
// the other still had one open flipped it back to false and let the discovery
// tours paint under the open surface.
export const chatBoxLeftOverlayOpenAtom = atom(false)
export const chatBoxRightOverlayOpenAtom = atom(false)

// True while anything the submission box owns covers it -- a menu (quality /
// aspect ratio / settings) or a dialog one of them opened.
// They all land on the chat box, so the discovery tours read this to hold
// themselves hidden rather than floating on top of an open surface.
export const isChatBoxOverlayOpenAtom = atom(
  (get) => get(chatBoxLeftOverlayOpenAtom) || get(chatBoxRightOverlayOpenAtom),
)
