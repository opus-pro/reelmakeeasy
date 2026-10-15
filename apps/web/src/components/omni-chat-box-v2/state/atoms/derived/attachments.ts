import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { atom } from 'jotai'

import { longTakeEnabledAtom } from '@/atom/home'
import { attachmentsAtom } from '@/atom/inputBox'
import { getActiveAttachments } from '@/components/markdown-editor/md-utils'

import { isStoryModeAudioAttachment } from '../../../omni-chat-box-helpers'
import { getMessageAtom } from '../domain/runtime'

export const getActiveMessageAttachmentsAtom = createWeakMapFn((scope) => {
  const a = atom((get) => getActiveAttachments(get(getMessageAtom(scope)), get(attachmentsAtom)))
  a.debugLabel = 'chatBoxV2/derived/activeMessageAttachments'
  return a
})

export const getActiveStoryModeAudioAttachmentAtom = createWeakMapFn((scope) => {
  const a = atom((get) => {
    if (!get(longTakeEnabledAtom)) {
      return null
    }
    return (
      get(getActiveMessageAttachmentsAtom(scope)).find((att) => isStoryModeAudioAttachment(att)) ??
      null
    )
  })
  a.debugLabel = 'chatBoxV2/derived/activeStoryModeAudioAttachment'
  return a
})
