'use client'

import { type Atom, useAtomValue } from 'jotai'
import { memo } from 'react'

import StoryPlayerOverlay from '../LongTakeViewer/StorySequencer/StoryPlayerOverlay'

/** The editor preview's player controls, reading the engine's playhead itself so only
 *  they re-render on every frame. */
export const EnginePlayerOverlay = memo(function EnginePlayerOverlay({
  currentTimeAtom,
  ...props
}: Omit<React.ComponentProps<typeof StoryPlayerOverlay>, 'currentSec'> & {
  /** The engine store's `currentTime` (ms). */
  currentTimeAtom: Atom<number>
}) {
  const currentMs = useAtomValue(currentTimeAtom)
  return <StoryPlayerOverlay {...props} currentSec={currentMs / 1000} />
})
