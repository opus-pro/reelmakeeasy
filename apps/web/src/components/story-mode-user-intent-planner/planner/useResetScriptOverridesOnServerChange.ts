import { useEffect } from 'react'

import {
  getScriptTranscriptDraftTextAtom,
  getScriptTranscriptLastSuccessfulSavedTextAtom,
  getScriptTranscriptSavedTextAtom,
} from '../state/atoms/script-transcript'
import type { TranscriptEditScope } from '../state/script-transcript-state'

/**
 * Drop the optimistic transcript overrides (draft + savedText + lastSuccessfulSavedText)
 * once the server has confirmed the user's saved text -- i.e. when the server's latest script
 * (`serverText`) matches `savedText`.
 *
 * The editor renders `draft ?? savedText ?? blockText`. A manual save sets savedText (and often
 * draft) to the user's text; within script_review nothing cleared it, so a *later* server version
 * (e.g. the agent rewriting after the manual edit) was masked -- blockText moved on but the stale
 * override still won the `??`. Once `serverText === savedText` the save is confirmed and the
 * override is redundant, so clearing it lets subsequent server versions render through blockText.
 *
 * Keyed on the exact-match (not any change) so a stale/racing server re-sync of *different* text
 * cannot clobber the user's just-saved edit: while `serverText !== savedText` the override is kept,
 * which is the in-flight optimistic protection the save flow relies on.
 *
 * Skipped while a diverging in-progress `draft` exists (`draft !== savedText`): if the user starts a
 * second edit before the first save's server-confirm arrives, that confirm must not wipe the live
 * unsaved edit and snap the textarea back to the confirmed text. Only stale overrides with no active
 * edit are cleared. (`saveScriptTranscriptEdits` nulls `draft` after each save, so at confirm time
 * `draft` is normally null and this is a no-op.)
 */
export function useResetScriptOverridesOnServerChange(
  editScope: TranscriptEditScope,
  serverText: string,
  savedText: null | string,
  draft: null | string,
): void {
  useEffect(() => {
    if (savedText === null || serverText !== savedText) {
      return
    }
    if (draft !== null && draft !== savedText) {
      return
    }
    editScope.set(getScriptTranscriptDraftTextAtom, null)
    editScope.set(getScriptTranscriptSavedTextAtom, null)
    editScope.set(getScriptTranscriptLastSuccessfulSavedTextAtom, null)
  }, [editScope, serverText, savedText, draft])
}
