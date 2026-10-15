'use client'

import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'

import { useFetcherData } from '@/lib/jotai-fetcher-adapter'

import { getLatestScriptReviewSaveFetcherAtom } from '../state/atoms/planner'
import type { PlannerState } from '../state/planner-state'

/**
 * Transient state of the latest transcript save, for surfaces that confirm a save to the user:
 * the editor's status line (timeline / canvas Script section) and the Edit modal's Save button.
 * 'saved' holds for 3s after a success, then falls back to 'idle'; 'failed' sticks so the retry
 * affordance stays reachable.
 *
 * Lives outside ScriptTranscriptBlockItem so a caller can read save state without pulling in the
 * editor's module (and its import chain).
 */
export function useTranscriptSaveDisplay(
  plannerState: PlannerState,
): 'failed' | 'idle' | 'saved' | 'saving' {
  const saveFetcher = useAtomValue(getLatestScriptReviewSaveFetcherAtom(plannerState))
  const saveData = useFetcherData(saveFetcher)
  const saveState = saveData?.state ?? 'idle'
  const saveOk = saveData?.state === 'resolved' ? saveData.value : undefined

  const [display, setDisplay] = useState<'failed' | 'idle' | 'saved' | 'saving'>('idle')

  useEffect(() => {
    if (saveState === 'pending') {
      setDisplay('saving')
      return
    }
    if (saveState === 'resolved' && saveOk === true) {
      setDisplay('saved')
      const timer = window.setTimeout(() => setDisplay('idle'), 3000)
      return () => window.clearTimeout(timer)
    }
    if (saveState === 'rejected' || saveOk === false) {
      setDisplay('failed')
    }
  }, [saveState, saveOk])

  return display
}
