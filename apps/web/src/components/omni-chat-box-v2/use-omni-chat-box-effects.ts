import { Attachment } from '@shared/types/assets/attachment'
import { useEffect, useImperativeHandle, useRef } from 'react'

import type { ApplyLongTakeTemplatePayload, ApplyQuickStartTemplatePayload } from '@/atom/home'
import { useRefCallback } from '@/hooks/use-ref-callback'

import type { ChatBoxState } from './state/chatbox-state'
import type { OmniChatBoxRef } from './omni-chat-box.types'

export interface EffectsDeps {
  disabled: boolean
  longTakeEnabled: boolean
  message: string
  newMobileView?: boolean
  processFiles: (files: File[]) => Promise<void>
  projectId: null | string
  selectedRatio: string
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  setIsAddAssetsDialogOpen: (v: boolean) => void
  setSelectedRatio: (v: string) => void
  storyModeLayoutEnabled: boolean
}

export interface ImperativeHandleDeps {
  applyLongTakeTemplate: (payload: ApplyLongTakeTemplatePayload) => void
  applyQuickStartTemplate: (payload: ApplyQuickStartTemplatePayload) => void
  focusEditor: () => void
  openSettingsEntry: (type: import('./settings').SettingsEntry['type']) => void
  ref: React.ForwardedRef<OmniChatBoxRef>
  setAspectRatio: OmniChatBoxRef['setAspectRatio']
  setShowCaptions: OmniChatBoxRef['setShowCaptions']
  state: ChatBoxState
  submit: () => void
}

export function useEffects(deps: EffectsDeps) {
  const {
    disabled,
    longTakeEnabled,
    message,
    processFiles,
    projectId,
    selectedRatio,
    setAttachments,
    setIsAddAssetsDialogOpen,
    setSelectedRatio,
    storyModeLayoutEnabled,
  } = deps

  const prevLongTakeEnabledRef = useRef(longTakeEnabled)
  const hasFiredPromptFilledRef = useRef(false)

  // Reset state when longTake is first enabled
  useEffect(() => {
    const wasLongTakeEnabled = prevLongTakeEnabledRef.current
    prevLongTakeEnabledRef.current = longTakeEnabled
    if (!longTakeEnabled || wasLongTakeEnabled) {
      return
    }
    setAttachments([])
  }, [longTakeEnabled, setAttachments])

  // Close add-assets dialog when story mode layout is disabled
  useEffect(() => {
    if (storyModeLayoutEnabled) {
      return
    }
    setIsAddAssetsDialogOpen(false)
  }, [storyModeLayoutEnabled, setIsAddAssetsDialogOpen])

  // Track prompt-filled event for story mode
  useEffect(() => {
    if (!longTakeEnabled) {
      return
    }
    if (message.length > 0 && !hasFiredPromptFilledRef.current) {
      hasFiredPromptFilledRef.current = true
    } else if (message.length === 0) {
      hasFiredPromptFilledRef.current = false
    }
  }, [message, longTakeEnabled])

  // Reset selectedRatio to default when not in story mode.
  // Use storyModeLayoutEnabled (= longTakeEnabled || isStoryModeRoute) so that the ratio is
  // preserved during the script-preview dialog: submit calls resetEditorState() which sets
  // longTakeEnabled=false before the dialog opens, but isStoryModeRoute remains true.
  useEffect(() => {
    if (!storyModeLayoutEnabled && selectedRatio !== '9:16') {
      setSelectedRatio('9:16')
    }
  }, [storyModeLayoutEnabled, selectedRatio, setSelectedRatio])

  // Global event listeners (mousedown/keydown)
  useEffect(() => {
    const h = () => undefined
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('keydown', h)
    }
  }, [])

  // Paste handler for file uploads
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (disabled || longTakeEnabled) {
        return
      }
      if (e.defaultPrevented) {
        return
      }
      const items = Array.from(e.clipboardData?.items || [])
      const files = items
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f)
      if (files.length === 0) {
        return
      }
      e.preventDefault()
      await processFiles(files)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [disabled, longTakeEnabled, projectId, processFiles])

  return { hasFiredPromptFilledRef, prevLongTakeEnabledRef }
}

export function useImperativeHandleSetup(deps: ImperativeHandleDeps) {
  const { ref, state } = deps
  // Callers pass inline callbacks. Keep the handle's identity tied to `state`
  // only: a new handle on every render makes React detach and re-attach the
  // parent's ref callback each commit, and DashboardV2's ref callback sets
  // state on both, which loops until "Maximum update depth exceeded".
  const applyLongTakeTemplate = useRefCallback(deps.applyLongTakeTemplate)
  const applyQuickStartTemplate = useRefCallback(deps.applyQuickStartTemplate)
  const focusEditor = useRefCallback(deps.focusEditor)
  const openSettingsEntry = useRefCallback(deps.openSettingsEntry)
  const setAspectRatio = useRefCallback(deps.setAspectRatio)
  const setShowCaptions = useRefCallback(deps.setShowCaptions)
  const submit = useRefCallback(deps.submit)

  useImperativeHandle(
    ref,
    () => ({
      applyLongTakeTemplate,
      applyQuickStartTemplate,
      focusEditor,
      getState: () => state,
      openSettingsEntry,
      setAspectRatio,
      setShowCaptions,
      submit,
    }),
    [
      applyLongTakeTemplate,
      applyQuickStartTemplate,
      focusEditor,
      openSettingsEntry,
      setAspectRatio,
      setShowCaptions,
      state,
      submit,
    ],
  )
}
