'use client'

import { useAtom } from 'jotai'
import { useCallback } from 'react'

import { recentProcessingCompletionsAtom } from './processing-notification-store'

/**
 * Card-side view of the "finished while you were away" marker:
 * `hasCompletion` is true while the project has a processing completion the
 * user has not opened yet. `acknowledge` clears it and is a no-op (no state
 * churn) otherwise.
 *
 * Surface-agnostic on purpose: Design replaced the red dot this was written for
 * with the project-card status pill, so the reader decides how to
 * render the marker -- this hook only owns "is there an unopened completion for
 * this project".
 */
export function useProcessingCompletion(projectId: string): {
  acknowledge: () => void
  hasCompletion: boolean
} {
  const [recentCompletions, setRecentCompletions] = useAtom(recentProcessingCompletionsAtom)
  const hasCompletion = recentCompletions.some((entry) => entry.projectId === projectId)
  const acknowledge = useCallback(() => {
    setRecentCompletions((entries) =>
      entries.some((entry) => entry.projectId === projectId)
        ? entries.filter((entry) => entry.projectId !== projectId)
        : entries,
    )
  }, [projectId, setRecentCompletions])
  return { acknowledge, hasCompletion }
}
