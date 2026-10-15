import { atom } from 'jotai'

// True while the mobile voiceover settings sheet (UIP) is open. The planner is a
// full-screen dialog whose close button is portaled above the sheet; it reads this
// so it can hide while the sheet owns the top-left control (close / back).
export const voiceoverSheetOpenAtom = atom(false)
voiceoverSheetOpenAtom.debugLabel = 'voiceover.sheetOpen'
