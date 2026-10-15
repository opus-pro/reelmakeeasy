import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'
import { Fetcher } from '@reelmakeeasy/common/utils/fetcher'
import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { countWords } from '@reelmakeeasy/common/utils/text'
import { toast } from '@shared/ui'

import {
  getApiAtom,
  getLatestScriptReviewSaveFetcherAtom,
  getRenderStateAtom,
} from '../atoms/planner'
import {
  getScriptTranscriptDraftTextAtom,
  getScriptTranscriptLastSuccessfulSavedTextAtom,
  getScriptTranscriptSavedTextAtom,
} from '../atoms/script-transcript'
import type { PlannerState } from '../planner-state'
import type { TranscriptEditScope } from '../script-transcript-state'

const getScriptReviewSaveQueueByPlanner = createWeakMapFn(
  (_state: PlannerState) => new CoalescingQueue<boolean>(),
)

const getPendingScriptSaveByPlanner = createWeakMapFn((_state: PlannerState) => ({
  script: undefined as string | undefined,
}))

const getLastSaveAttemptByPlanner = createWeakMapFn((_state: PlannerState) => ({
  blockText: '',
  script: undefined as string | undefined,
}))

export function enqueueScriptReviewSave(params: {
  plannerState: PlannerState
  script: string
}): Fetcher<boolean> {
  const { plannerState, script } = params
  getPendingScriptSaveByPlanner(plannerState).script = script
  const queue = getScriptReviewSaveQueueByPlanner(plannerState)
  const fetcher = new Fetcher<boolean>(() =>
    queue.push(() => flushLatestScriptReviewSave(plannerState)),
  )
  plannerState.set(getLatestScriptReviewSaveFetcherAtom, fetcher)
  return fetcher
}

/**
 * Flush pending transcript edits to the backend.
 *
 * Returns `true` when:
 *   - there was nothing to save (draft is null or matches baseline), or
 *   - the save API call succeeded.
 *
 * Returns `false` when the API call failed (e.g. word-limit 400). Callers
 * MUST abort any downstream action (Create video, send message) on `false`
 * so a rejected save never silently advances the session.
 */
export async function flushScriptTranscriptDraftBeforeAction(
  plannerState: PlannerState,
): Promise<boolean> {
  const pendingFetcherBeforeFlush = plannerState.get(getLatestScriptReviewSaveFetcherAtom)
  const draftText = plannerState.get(getScriptTranscriptDraftTextAtom)
  if (draftText !== null) {
    const saved = await saveScriptTranscriptEdits({
      blockText: plannerState.get(getRenderStateAtom).latest.script?.text ?? '',
      plannerState,
      scriptTranscriptState: plannerState,
    })
    if (!saved) {
      return false
    }
    const pendingFetcherAfterFlush = plannerState.get(getLatestScriptReviewSaveFetcherAtom)
    const pendingFetcher = pendingFetcherAfterFlush ?? pendingFetcherBeforeFlush
    return pendingFetcher ? pendingFetcher.toPromise() : true
  }

  if (!pendingFetcherBeforeFlush) {
    return true
  }
  return pendingFetcherBeforeFlush.toPromise()
}

export function retryScriptTranscriptSave(plannerState: PlannerState): void {
  const { script, blockText } = getLastSaveAttemptByPlanner(plannerState)
  if (script === undefined) {
    return
  }
  plannerState.set(getScriptTranscriptDraftTextAtom, script)
  void saveScriptTranscriptEdits({ blockText, plannerState, scriptTranscriptState: plannerState })
}

export function saveScriptTranscriptEdits(params: {
  blockText: string
  plannerState: PlannerState
  scriptTranscriptState: TranscriptEditScope
}): Promise<boolean> {
  const { plannerState, scriptTranscriptState } = params
  const draftText = scriptTranscriptState.get(getScriptTranscriptDraftTextAtom)
  const savedText = scriptTranscriptState.get(getScriptTranscriptSavedTextAtom)
  const baselineText = savedText ?? params.blockText

  // A blank transcript is never a valid script: the backend stores it, but the session then
  // presents as if the script step never completed. Reject it here -- the last guard before the
  // API -- and keep the draft so the user's editor state is not silently reverted. Returning
  // false aborts any downstream action (Create video, send message) the same way an API
  // rejection does.
  if (draftText !== null && draftText !== baselineText && countWords(draftText) === 0) {
    toast.error('Script cannot be empty.')
    return Promise.resolve(false)
  }

  // No pending edits - nothing to do, caller may proceed.
  let savePromise: Promise<boolean> = Promise.resolve(true)

  if (draftText !== null && draftText !== baselineText) {
    const nextSavedText = draftText
    const lastAttempt = getLastSaveAttemptByPlanner(plannerState)
    lastAttempt.blockText = params.blockText
    lastAttempt.script = nextSavedText
    scriptTranscriptState.set(getScriptTranscriptSavedTextAtom, nextSavedText)
    const fetcher = enqueueScriptReviewSave({
      plannerState,
      script: nextSavedText,
    })

    const commitSaveResult = (isSuccess: boolean) => {
      if (isSuccess) {
        scriptTranscriptState.set(getScriptTranscriptLastSuccessfulSavedTextAtom, nextSavedText)
        scriptTranscriptState.set(getScriptTranscriptSavedTextAtom, nextSavedText)
        return
      }

      // Only rollback when this failed save is still the latest visible value.
      // If a newer save is pending/succeeded, keep the newer value.
      if (scriptTranscriptState.get(getScriptTranscriptSavedTextAtom) !== nextSavedText) {
        return
      }

      const lastSuccessfulSavedText = scriptTranscriptState.get(
        getScriptTranscriptLastSuccessfulSavedTextAtom,
      )
      scriptTranscriptState.set(getScriptTranscriptSavedTextAtom, lastSuccessfulSavedText ?? null)
    }

    const initialData = fetcher.data
    if (initialData.state === 'resolved') {
      commitSaveResult(initialData.value)
      savePromise = Promise.resolve(initialData.value)
    } else if (initialData.state === 'rejected') {
      commitSaveResult(false)
      savePromise = Promise.resolve(false)
    } else {
      savePromise = new Promise<boolean>((resolve) => {
        const unsubscribe = fetcher.onDataChange((data) => {
          if (data.state === 'pending') {
            return
          }
          unsubscribe()
          const ok = data.state === 'resolved' ? data.value : false
          commitSaveResult(ok)
          resolve(ok)
        })
      })
    }
  }

  scriptTranscriptState.set(getScriptTranscriptDraftTextAtom, null)

  return savePromise
}

async function flushLatestScriptReviewSave(state: PlannerState): Promise<boolean> {
  const pending = getPendingScriptSaveByPlanner(state)
  const script = pending.script
  if (typeof script !== 'string') {
    return false
  }
  pending.script = undefined

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  try {
    await api.saveScriptDraft(script)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to save script review'
    toast.error(errorMessage)
    return false
  }
}
