import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import type { MarkdownEditorHandle } from '@/components/markdown-editor/EditorContainer'
import type { PlannerState } from '@/components/story-mode-user-intent-planner/state/planner-state'
import { Disposers } from '@/lib/disposers'
import { createAtom, createNullableAtom } from '@/lib/jotai-atom-utils'

export const getIsSendingAtom = createWeakMapFn(() =>
  createAtom(false, 'chatBoxV2/domain/isSending'),
)

export const getMessageAtom = createWeakMapFn(() => createAtom('', 'chatBoxV2/domain/message'))

export const getMarkdownEditorAtom = createWeakMapFn(() =>
  createNullableAtom<MarkdownEditorHandle>('chatBoxV2/domain/markdownEditor'),
)

export const getIsAddAssetsDialogOpenAtom = createWeakMapFn(() =>
  createAtom(false, 'chatBoxV2/domain/isAddAssetsDialogOpen'),
)

export const getIsVoiceSelectionDialogOpenAtom = createWeakMapFn(() =>
  createAtom(false, 'chatBoxV2/domain/isVoiceSelectionDialogOpen'),
)

export const getIsAudioVoiceoverDialogOpenAtom = createWeakMapFn(() =>
  createAtom(false, 'chatBoxV2/domain/isAudioVoiceoverDialogOpen'),
)

export const getIsChooseStylePopupOpenAtom = createWeakMapFn(() =>
  createAtom(false, 'chatBoxV2/domain/isChooseStylePopupOpen'),
)

export const getPlannerDialogOpenAtom = createWeakMapFn(() =>
  createAtom(false, 'chatBoxV2/domain/plannerDialogOpen'),
)

export const getPlannerStateAtom = createWeakMapFn(() =>
  createNullableAtom<PlannerState>('chatBoxV2/domain/plannerState'),
)

export const getDisposersAtom = createWeakMapFn(() =>
  createAtom(new Disposers(), 'chatBoxV2/domain/disposers'),
)

export const getLongTakeTargetDurationSecondsAtom = createWeakMapFn(() =>
  createNullableAtom<number>('chatBoxV2/domain/longTakeTargetDurationSeconds'),
)
