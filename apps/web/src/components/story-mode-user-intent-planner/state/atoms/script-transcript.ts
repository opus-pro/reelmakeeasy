import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { createAtom } from '@/lib/jotai-atom-utils'

import type { TranscriptEditScope } from '../script-transcript-state'

export const getScriptTranscriptDraftTextAtom = createWeakMapFn((_scope: TranscriptEditScope) =>
  createAtom<null | string>(null, 'storyModeUip/scriptTranscript/atom/draftText'),
)

// The committed history version currently being *viewed* read-only in the Edit
// Script modal. Kept separate from draftText so a preview never enters the editable/commit
// path (draftText is read by the canvas display and flushed on flow actions). null = not
// previewing (the editable current version is shown).
export const getScriptVersionPreviewAtom = createWeakMapFn((_scope: TranscriptEditScope) =>
  createAtom<null | string>(null, 'storyModeUip/scriptTranscript/atom/versionPreview'),
)

export const getScriptTranscriptSavedTextAtom = createWeakMapFn((_scope: TranscriptEditScope) =>
  createAtom<null | string>(null, 'storyModeUip/scriptTranscript/atom/savedText'),
)

export const getScriptTranscriptLastSuccessfulSavedTextAtom = createWeakMapFn(
  (_scope: TranscriptEditScope) =>
    createAtom<null | string>(null, 'storyModeUip/scriptTranscript/atom/lastSuccessfulSavedText'),
)

export const getScriptTranscriptIsFocusedAtom = createWeakMapFn((_scope: TranscriptEditScope) =>
  createAtom(false, 'storyModeUip/scriptTranscript/atom/isFocused'),
)
