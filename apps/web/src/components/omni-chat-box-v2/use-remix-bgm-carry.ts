'use client'

import { useAtom, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { musicEnabledAtom, pendingRemixBgmAtom } from '@/atom/home'

interface UseRemixBgmCarryOptions {
  /**
   * The composer's ACTIVE remix source (component-local state from
   * use-omni-chat-box-state). Pending intent is consumed only while it still
   * matches; any composer that did not apply the remix reads undefined and
   * clears stale intent instead of acting on it.
   */
  activeRemixProjectId?: string
  /**
   * False outside the story layout, where no BGM UI exists. The reconciler
   * then holds WITHOUT consuming -- a StrictMode/layout remount must not eat
   * a carry that the story layout would have honored a commit later.
   */
  enabled: boolean
}

/**
 * Resolves carried remix BGM intent. Background music is off, so a
 * carry is always consumed silently -- creation omits the field anyway -- and
 * the submission-box toggle is never seeded.
 */
export function useRemixBgmCarry({ activeRemixProjectId, enabled }: UseRemixBgmCarryOptions): void {
  const [pending, setPending] = useAtom(pendingRemixBgmAtom)
  const setMusicEnabled = useSetAtom(musicEnabledAtom)

  // A composition that is not a remix must not inherit a previous remix's
  // carried value: the override is app-global and in-memory, so without this it
  // pins the toggle for the rest of the SPA session. Runs only once
  // nothing is pending, so it can never eat a carry that is still being
  // resolved; writing the same null twice is a no-op in the store.
  useEffect(() => {
    if (!enabled || activeRemixProjectId || pending !== null) {
      return
    }
    setMusicEnabled(null)
  }, [activeRemixProjectId, enabled, pending, setMusicEnabled])

  useEffect(() => {
    if (pending === null) {
      return
    }
    // Source binding: stale intent (composer remounted, mobile-sheet apply,
    // navigation away mid-hold) must die, never fire on an unrelated
    // composition. Otherwise the story layout consumes it silently.
    if (pending.sourceProjectId !== activeRemixProjectId || enabled) {
      setPending(null)
    }
  }, [activeRemixProjectId, enabled, pending, setPending])
}
