'use client'

import { atom } from 'jotai'

// Share id of the project being viewed through a share link. Sent as
// `X-REELMAKEEASY-SHARED-ID` so the API can authorize the read.
export const shareIdAtom = atom<string>('')
