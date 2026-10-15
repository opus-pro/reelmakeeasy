import { createMapFn, createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { countWords } from '@reelmakeeasy/common/utils/text'
import { atom } from 'jotai'

import {
  getScriptTranscriptDraftTextAtom,
  getScriptTranscriptSavedTextAtom,
} from '../atoms/script-transcript'
import type { TranscriptEditScope } from '../script-transcript-state'

export const getScriptTranscriptBaselineTextByBlockTextAtom = createWeakMapFn(
  (scope: TranscriptEditScope) =>
    createMapFn((blockText: string) => {
      const a = atom((get): string => {
        const savedTextOverride = get(getScriptTranscriptSavedTextAtom(scope))
        return savedTextOverride ?? blockText
      })
      a.debugLabel = 'storyModeUip/scriptTranscript/computed/baselineText'
      return a
    }),
)

export const getScriptTranscriptDraftTextByBlockTextAtom = createWeakMapFn(
  (scope: TranscriptEditScope) =>
    createMapFn((blockText: string) => {
      const a = atom((get): string => {
        const draftTextOverride = get(getScriptTranscriptDraftTextAtom(scope))
        if (draftTextOverride !== null) {
          return draftTextOverride
        }
        return get(getScriptTranscriptBaselineTextByBlockTextAtom(scope)(blockText))
      })
      a.debugLabel = 'storyModeUip/scriptTranscript/computed/draftTextByBlockText'
      return a
    }),
)

export const getScriptTranscriptHasTextChangeAtom = createWeakMapFn((scope: TranscriptEditScope) =>
  createMapFn((blockText: string) => {
    const a = atom((get): boolean => {
      const draftTextOverride = get(getScriptTranscriptDraftTextAtom(scope))
      if (draftTextOverride === null) {
        return false
      }
      const baselineText = get(getScriptTranscriptBaselineTextByBlockTextAtom(scope)(blockText))
      return draftTextOverride !== baselineText
    })
    a.debugLabel = 'storyModeUip/scriptTranscript/computed/hasTextChange'
    return a
  }),
)

/**
 * Whether a changed draft may be committed. An empty (or whitespace-only) transcript is
 * rejected here as well as over-limit text: the backend accepts a blank script but the
 * session then reads as if the script step never completed, so the user is left stuck.
 * Shared by the Save button, the blur-save, saveScriptTranscriptEdits, and the voiceover
 * Regenerate gate so they cannot drift. `maxWords` is undefined where a surface
 * carries no word budget, leaving only the emptiness half of the rule.
 */
export function isScriptTranscriptDraftSavable(
  draftText: string,
  maxWords: number | undefined,
): boolean {
  return isScriptTranscriptWordCountSavable(countWords(draftText), maxWords)
}

/**
 * The rule itself, for a caller that already holds the count. The voiceover editor takes a
 * `wordCount` prop precisely so the surface's own count wins over a recount of the raw text --
 * emotion tags and pronunciation markers live in that text -- so it must not re-derive one.
 */
export function isScriptTranscriptWordCountSavable(
  wordCount: number,
  maxWords: number | undefined,
): boolean {
  return wordCount > 0 && (maxWords === undefined || wordCount <= maxWords)
}

export const getCanSubmitScriptTranscriptDraftAtom = createWeakMapFn((scope: TranscriptEditScope) =>
  createMapFn((blockText: string) =>
    createMapFn((maxWords: number) => {
      const a = atom((get): boolean => {
        const draftTextOverride = get(getScriptTranscriptDraftTextAtom(scope))
        if (draftTextOverride === null) {
          return true
        }
        const baselineText = get(getScriptTranscriptBaselineTextByBlockTextAtom(scope)(blockText))
        if (draftTextOverride === baselineText) {
          return true
        }
        return isScriptTranscriptDraftSavable(draftTextOverride, maxWords)
      })
      a.debugLabel = 'storyModeUip/scriptTranscript/computed/canSubmitDraft'
      return a
    }),
  ),
)
