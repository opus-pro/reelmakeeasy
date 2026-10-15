'use client'

import { useAtom } from 'jotai'
import { useEffect, useRef } from 'react'

import {
  dashboardChatBoxStateAtom,
  dashboardSelectedUseCaseKeyAtom,
} from '@/app/dashboard-v2/state/dashboard-v2-atoms'
import { getUploadedStoryModeAnchorAssetsAtom } from '@/components/omni-chat-box-v2/state/atoms/derived/anchor-assets'
import { getActiveStoryModeAudioAttachmentAtom } from '@/components/omni-chat-box-v2/state/atoms/derived/attachments'
import {
  getIsAddAssetsDialogOpenAtom,
  getIsAudioVoiceoverDialogOpenAtom,
  getIsSendingAtom,
} from '@/components/omni-chat-box-v2/state/atoms/domain/runtime'
import type { ChatBoxState } from '@/components/omni-chat-box-v2/state/chatbox-state'
import { type CreateUseCaseKey } from '@/constants/create-use-cases'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useFalsyAtomValue } from '@/lib/jotai-atom-utils'

type PendingDialog = null | { fromStateId: number; type: PendingDialogType }
type PendingDialogType = 'add-assets' | 'voice-dialog'

export function useUseCaseSelect() {
  const [selectedUseCaseKey, setSelectedUseCaseKey] = useAtom(dashboardSelectedUseCaseKeyAtom)
  const [chatBoxState] = useAtom(dashboardChatBoxStateAtom)
  const pendingDialogRef = useRef<PendingDialog>(null)
  const isUseCaseSwitchDisabled =
    useFalsyAtomValue(chatBoxState && getIsSendingAtom(chatBoxState)) ?? false

  // Requirement:
  // 1) Select "Animation-style ad": open add-assets only when no story-mode anchor assets exist.
  // 2) Select "Audio to video": open story-mode voice dialog when no audio attachment exists.
  // Dialog should open on the new chatbox state after use-case switch.
  useEffect(() => {
    const pendingDialog = pendingDialogRef.current
    if (!pendingDialog || !chatBoxState) {
      return
    }

    if (pendingDialog.fromStateId >= 0 && chatBoxState.id === pendingDialog.fromStateId) {
      return
    }

    try {
      if (pendingDialog.type === 'add-assets' && hasUploadedStoryModeAnchorAssets(chatBoxState)) {
        return
      }

      if (
        pendingDialog.type === 'voice-dialog' &&
        hasActiveStoryModeAudioAttachment(chatBoxState)
      ) {
        return
      }

      openDialogByType(chatBoxState, pendingDialog.type)
    } finally {
      pendingDialogRef.current = null
    }
  }, [chatBoxState, selectedUseCaseKey])

  const handleUseCaseSelect = useRefCallback((nextUseCaseKey: CreateUseCaseKey) => {
    if (isUseCaseSwitchDisabled) {
      return
    }

    const pendingType = resolvePendingDialogType(nextUseCaseKey, chatBoxState)

    // Support repeated clicks on the active button to re-trigger dialog behaviors.
    if (nextUseCaseKey === selectedUseCaseKey) {
      if (pendingType && chatBoxState) {
        openDialogByType(chatBoxState, pendingType)
      }
      return
    }

    pendingDialogRef.current = buildPendingDialog(chatBoxState, pendingType)
    setSelectedUseCaseKey(nextUseCaseKey)
  })

  return { handleUseCaseSelect, isUseCaseSwitchDisabled, selectedUseCaseKey }
}

function buildPendingDialog(
  chatBoxState: ChatBoxState | undefined,
  pendingType: null | PendingDialogType,
): PendingDialog {
  if (!pendingType) {
    return null
  }
  // Always use the current chatBoxState id so the effect waits for the new
  // instance after remount before opening the dialog.
  return {
    fromStateId: chatBoxState?.id ?? -1,
    type: pendingType,
  }
}

function hasActiveStoryModeAudioAttachment(chatBoxState?: ChatBoxState) {
  return Boolean(chatBoxState?.get(getActiveStoryModeAudioAttachmentAtom))
}

function hasUploadedStoryModeAnchorAssets(chatBoxState?: ChatBoxState) {
  return (chatBoxState?.get(getUploadedStoryModeAnchorAssetsAtom).length || 0) > 0
}

function openDialogByType(chatBoxState: ChatBoxState, type: PendingDialogType) {
  if (type === 'add-assets') {
    chatBoxState.set(getIsAddAssetsDialogOpenAtom, true)
    return
  }
  // open dialog
  chatBoxState.set(getIsAudioVoiceoverDialogOpenAtom, true)
  // click upload audio
  // const audioInputRefAtom = getAudioInputRefAtom(chatBoxState)
  // const triggerUploadFileAtom = getTriggerUploadFileAtom(chatBoxState)
  // const a = createTriggerUploadAudioAtom(audioInputRefAtom, triggerUploadFileAtom)
  // return whenNonNullable(chatBoxState.store, a, (fn) => fn())
}

function resolvePendingDialogType(
  useCaseKey: CreateUseCaseKey,
  chatBoxState: ChatBoxState | undefined,
): null | PendingDialogType {
  if (useCaseKey === 'animation-style-ad' && !hasUploadedStoryModeAnchorAssets(chatBoxState)) {
    return 'add-assets'
  }
  if (useCaseKey === 'audio-to-video' && !hasActiveStoryModeAudioAttachment(chatBoxState)) {
    return 'voice-dialog'
  }
  return null
}
