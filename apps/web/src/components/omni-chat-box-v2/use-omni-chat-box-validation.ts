import { Attachment } from '@shared/types/assets/attachment'
import { toast } from '@shared/ui'
import { useCallback } from 'react'

import {
  findAttachmentsWithMissingContent,
  findUnlinkedMetaIds,
  getActiveAttachments,
} from '@/components/markdown-editor/md-utils'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { getIsChooseStylePopupOpenAtom } from './state/atoms/domain/runtime'
import { ChatBoxState } from './state/chatbox-state'
import {
  isStoryModeAudioAttachment,
  normalizeLongTakeScript,
  STORY_MODE_MAX_IMAGE_ATTACHMENTS,
} from './omni-chat-box-helpers'
import { resolveStoryModeReferencedImages } from './omni-chat-box-story-mode-images'

export function useValidation(
  state: ChatBoxState,
  attachments: Attachment[],
  longTakeEnabled: boolean,
  hasLongTakeStyle: boolean,
) {
  const resolveReferencedImages = useCallback(
    (promptText: string) => resolveStoryModeReferencedImages(promptText, attachments),
    [attachments],
  )

  const validateLinkedAttachments = useCallback((msg: string, activeAtts: Attachment[]) => {
    const unlinked = findUnlinkedMetaIds(msg, activeAtts)
    if (unlinked.length > 0) {
      toast.warning(
        "Your message mentions files that aren't attached or failed to upload — please re-upload them or remove the @ mentions for those files.",
      )
      return false
    }
    const missingContent = findAttachmentsWithMissingContent(activeAtts)
    if (missingContent.length > 0) {
      const names = missingContent.map((a) => a.name).join(', ')
      toast.error(`Missing file content for: ${names}. Please re-upload these files.`)
      return false
    }
    return true
  }, [])

  const validateStandardFlow = useCallback(
    (msg: string, activeAtts: Attachment[]) => {
      if (!msg.length) {
        toast.warning('Please enter a message')
        return false
      }
      return validateLinkedAttachments(msg, activeAtts)
    },
    [validateLinkedAttachments],
  )

  const validateLongTakeWithAudio = useCallback(
    (msg: string, activeAtts: Attachment[], longTakeScript: string) => {
      if (!validateLinkedAttachments(msg, activeAtts)) {
        return false
      }
      const { referencedImages, unresolvedReferences } = resolveReferencedImages(msg)
      if (unresolvedReferences.length > 0) {
        toast.warning(`Missing referenced images: ${unresolvedReferences.slice(0, 3).join(', ')}`)
        return false
      }
      if (referencedImages.length > STORY_MODE_MAX_IMAGE_ATTACHMENTS) {
        toast.warning(`Only ${STORY_MODE_MAX_IMAGE_ATTACHMENTS} images are supported in Story Mode`)
        return false
      }
      const audioAttachments = activeAtts.filter((att) => isStoryModeAudioAttachment(att))
      const unsupportedAttachments = activeAtts.filter(
        (att) => !isStoryModeAudioAttachment(att) && !att.type.startsWith('image/'),
      )
      if (unsupportedAttachments.length > 0) {
        toast.warning('Story Mode only supports image, video, and audio attachments')
        return false
      }
      if (audioAttachments.length > 1) {
        toast.warning('Only one audio or video file is supported in Story Mode')
        return false
      }
      if (!longTakeScript.length && audioAttachments.length === 0) {
        toast.warning('Please enter your prompt or upload an audio file')
        return false
      }
      return true
    },
    [resolveReferencedImages, validateLinkedAttachments],
  )

  const validateLongTakeFlow = useRefCallback((msg: string, activeAtts: Attachment[]) => {
    if (!hasLongTakeStyle) {
      toast.warning('Please select a style to continue')
      state.set(getIsChooseStylePopupOpenAtom, true)
      return false
    }
    return validateLongTakeWithAudio(msg, activeAtts, normalizeLongTakeScript(msg))
  })

  const checkBeforeSend = useCallback(
    (msg: string): boolean => {
      const activeAtts = getActiveAttachments(msg, attachments)
      if (longTakeEnabled) {
        return validateLongTakeFlow(msg, activeAtts)
      }
      return validateStandardFlow(msg, activeAtts)
    },
    [longTakeEnabled, attachments, validateLongTakeFlow, validateStandardFlow],
  )

  return {
    checkBeforeSend,
    resolveReferencedImages,
  }
}
