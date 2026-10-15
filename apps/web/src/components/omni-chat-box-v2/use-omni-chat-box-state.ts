/** Consolidates all hook calls for OmniChatBoxImpl into a single hook. */
import { countWords } from '@reelmakeeasy/common/utils/text'
import { toast } from '@shared/ui'
import { useAtom, useAtomValue, useStore } from 'jotai'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import React from 'react'

import { chatBoxModeAtom, longTakeEnabledAtom, selectedRatioAtom } from '@/atom/home'
import { attachmentsAtom } from '@/atom/inputBox'
import {
  useDefaultVoiceId,
  usePresetVoiceOptions,
  useUserVoiceClones,
  VoiceOption,
} from '@/components/voice/components/voice-over-selection'
import { useProjectId } from '@/contexts/ProjectContext'
import { useFileUrl } from '@/hooks/use-file-url'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { useSignedUpload } from '@/hooks/useSignedUpload'
import { useStartLongTakeWorkflow } from '@/hooks/useStartLongTakeWorkflow'
import {
  type StoryModeStyleOption,
  useStoryModeStyleOptions,
  useStylePreviewBaseImage,
} from '@/hooks/useStoryModeConfig'
import {
  latestScenePreviewUrls,
  useGenerateStylePreview,
  useUserSavedStyles,
} from '@/hooks/useUserSavedStyles'

import type { MarkdownEditorHandle } from '../markdown-editor/EditorContainer'

import { getUploadedStoryModeAnchorAssetsAtom } from './state/atoms/derived/anchor-assets'
import { getActiveMessageAttachmentsAtom } from './state/atoms/derived/attachments'
import {
  getDisposersAtom,
  getIsAddAssetsDialogOpenAtom,
  getIsAudioVoiceoverDialogOpenAtom,
  getIsSendingAtom,
  getIsVoiceSelectionDialogOpenAtom,
  getLongTakeTargetDurationSecondsAtom,
  getMarkdownEditorAtom,
  getMessageAtom,
  getPlannerDialogOpenAtom,
  getPlannerStateAtom,
} from './state/atoms/domain/runtime'
import { createChatBoxState } from './state/chatbox-state'
import type { AnchorAssetPromptItem } from './anchor-assets'
import type { OmniChatBoxProps, OmniChatBoxRef } from './omni-chat-box.types'
import {
  isStoryModeAudioAttachment,
  normalizeLongTakeScript,
  STORY_MODE_EMPTY_STYLE_ID,
} from './omni-chat-box-helpers'
import { useCleanupAttachmentBlobUrls } from './use-cleanup-attachment-blob-urls'
import { useAudioState } from './use-omni-chat-box-audio'
import { useEffects } from './use-omni-chat-box-effects'
import { useEnhancerHandlers } from './use-omni-chat-box-enhancer'
import { useFileProcessing } from './use-omni-chat-box-file-processing'
import { useImageUpload } from './use-omni-chat-box-image-upload'
import { useProjectOperations } from './use-omni-chat-box-projects'
import { useScriptPreview } from './use-omni-chat-box-script-preview'
import { useSendState } from './use-omni-chat-box-send-state'
import { useStyleDraftState } from './use-omni-chat-box-style-draft'
import { useStyleManagement } from './use-omni-chat-box-style-management'
import { useSubmission } from './use-omni-chat-box-submission'
import { useValidation } from './use-omni-chat-box-validation'
import { resolveDisplayVoiceOption } from './voice-display.utils'

export function useOmniChatBoxState(
  props: OmniChatBoxProps,
  ref: React.ForwardedRef<OmniChatBoxRef>,
) {
  const {
    disabled = false,
    defaultMessage = '',
    onBeforeSubmit,
    onSettingsChange,
    pageType,
    useCaseKey,
  } = props
  const isStoryModeRoute = pageType === 'story-mode'

  // --- a. Basic state ---
  const store = useStore()
  const state = useMemo(() => createChatBoxState(store), [store])
  const [attachments, setAttachments] = useAtom(attachmentsAtom)
  useEffect(() => () => state.get(getDisposersAtom).clear(), [])

  const storyModeStyleOptions = useStoryModeStyleOptions(
    useCaseKey === 'song-to-video' ? 'song' : undefined,
  )
  const { styles: userSavedStyles } = useUserSavedStyles()
  const generateStylePreviewMutation = useGenerateStylePreview()
  const stylePreviewBaseImageUrl = useStylePreviewBaseImage()
  const userStoryModeStyleOptions = useMemo<StoryModeStyleOption[]>(
    () =>
      userSavedStyles.map((s) => ({
        id: s.id,
        label: s.name,
        // Rendered scene previews (latest snapshot) are the card's front image;
        // `thumbnailUrl` (the uploaded reference) is only the legacy fallback.
        scenePreviewUrls: latestScenePreviewUrls(s),
        styleText: s.styleText,
        thumbnailUrl: s.thumbnailUrl || '',
      })),
    [userSavedStyles],
  )
  const allPanelStyleOptions = useMemo(
    () => [...userStoryModeStyleOptions, ...storyModeStyleOptions],
    [storyModeStyleOptions, userStoryModeStyleOptions],
  )
  const userSavedStylesById = useMemo(
    () => new Map(userSavedStyles.map((s) => [s.id, s])),
    [userSavedStyles],
  )
  const defaultVoiceId = useDefaultVoiceId()
  useCleanupAttachmentBlobUrls(attachments)

  const [message, setMessage] = useAtom(getMessageAtom(state))
  const [longTakeTargetDurationSeconds, setLongTakeTargetDurationSeconds] = useAtom(
    getLongTakeTargetDurationSecondsAtom(state),
  )
  const geEditor = useRefCallback(() => state.get(getMarkdownEditorAtom))
  const editorRef = useMemo<React.RefObject<MarkdownEditorHandle | null>>(
    () => ({
      get current() {
        return state.get(getMarkdownEditorAtom)
      },
    }),
    [state],
  )
  const handleEditorRef = useRefCallback((editor: MarkdownEditorHandle | null) => {
    state.set(getMarkdownEditorAtom, editor)
  })
  const hasHydratedDefaultMessageRef = useRef(false)
  useEffect(() => {
    if (hasHydratedDefaultMessageRef.current) {
      return
    }
    hasHydratedDefaultMessageRef.current = true
    setMessage(defaultMessage)
    if (defaultMessage) {
      geEditor()?.initWithValue(defaultMessage)
    }
  }, [defaultMessage, geEditor, setMessage])

  const { options: presetVoiceOptions } = usePresetVoiceOptions()
  const { userVoices: voiceCloneOptions } = useUserVoiceClones()
  const voiceOptions = useMemo(
    () => [...voiceCloneOptions, ...presetVoiceOptions],
    [voiceCloneOptions, presetVoiceOptions],
  )
  const [selectedVoice, setSelectedVoice] = useState<null | VoiceOption>(null)
  const previewSelectedVoice = useMemo(
    () => resolveDisplayVoiceOption({ defaultVoiceId, selectedVoice, voiceOptions }),
    [defaultVoiceId, selectedVoice, voiceOptions],
  )

  // --- b. Style draft state ---
  const sd = useStyleDraftState({
    allPanelStyleOptions,
    generateStylePreviewMutation,
    state,
    stylePreviewBaseImageUrl,
    userSavedStyles,
    userSavedStylesById,
  })

  // --- c. Remaining state ---
  const [isAddAssetsDialogOpen, setIsAddAssetsDialogOpen] = useAtom(
    getIsAddAssetsDialogOpenAtom(state),
  )
  const [isVoiceSelectionDialogOpen, setIsVoiceSelectionDialogOpen] = useAtom(
    getIsVoiceSelectionDialogOpenAtom(state),
  )
  const [isAudioVoiceoverDialogOpen, setIsAudioVoiceoverDialogOpen] = useAtom(
    getIsAudioVoiceoverDialogOpenAtom(state),
  )
  const [showCaptions, setShowCaptions] = useState(false)
  // Persisted atom (not useState) so a 16:9 pick survives an OmniChatBox
  // remount (key={selectedUseCaseKey} on use-case switch, guest->login).
  const [selectedRatio, setSelectedRatio] = useAtom(selectedRatioAtom)
  const [longTakeEnabled, setLongTakeEnabled] = useAtom(longTakeEnabledAtom)
  // Dashboard-v2 owns long-take state via the page route (pageType is set per
  // selectedWorkflow). When pageType is provided we derive from the route so
  // an OmniChatBox remount on workflow change carries the correct state
  // without depending on the longTakeEnabled atom, which can become stale
  // across mode switches.
  const effectiveLongTakeEnabled = pageType ? isStoryModeRoute : longTakeEnabled
  useEffect(() => {
    if (effectiveLongTakeEnabled) {
      setShowCaptions(true)
    }
  }, [effectiveLongTakeEnabled])
  const activeMessageAttachments = useAtomValue(getActiveMessageAttachmentsAtom(state))
  const hasActiveAttachmentsInMessage = activeMessageAttachments.length > 0
  const uploadedStoryModeAnchorAssets = useAtomValue(getUploadedStoryModeAnchorAssetsAtom(state))
  const activeStoryModeAudioAttachment = useMemo(
    () =>
      effectiveLongTakeEnabled
        ? (activeMessageAttachments.find((att) => isStoryModeAudioAttachment(att)) ?? null)
        : null,
    [activeMessageAttachments, effectiveLongTakeEnabled],
  )
  const hasStoryModeAudioAttachment = Boolean(activeStoryModeAudioAttachment)
  const [plannerDialogOpen, setPlannerDialogOpen] = useAtom(getPlannerDialogOpenAtom(state))
  const [plannerState, setPlannerState] = useAtom(getPlannerStateAtom(state))

  // --- d. Audio state ---
  const wordCount = countWords(
    effectiveLongTakeEnabled ? normalizeLongTakeScript(message) : message.trim(),
  )
  const audio = useAudioState({
    activeStoryModeAudioAttachment,
    fetchApiDomain: useApi().fetchApiDomain,
    hasStoryModeAudioAttachment,
    longTakeEnabled: effectiveLongTakeEnabled,
    setAttachments,
    wordCount,
  })

  // --- e. Image upload ---
  const { failedImageAttachmentIds, imageUrisRef, imageUploadingCount, uploadImageAttachment } =
    useImageUpload()
  // Scoped to attachments still referenced in the message text: removing the
  // failed image (or its mention) lifts the gate, mirroring how the audio
  // error gate keys off the ACTIVE audio attachment.
  const hasFailedImageAttachment = useMemo(
    () =>
      activeMessageAttachments.some(
        (att) => att.type.startsWith('image/') && failedImageAttachmentIds.has(att.id),
      ),
    [activeMessageAttachments, failedImageAttachmentIds],
  )

  // --- f. Debug atoms, mode, enhancer ---
  const { projectId } = useProjectId()
  const { parseUrl } = useFileUrl()
  const storyModeLayoutEnabled = effectiveLongTakeEnabled || isStoryModeRoute
  const router = useRouter()
  const { fetchApiDomain: fetchWithProjectId, fetchApiDomain } = useApi()
  const { startLongTakeAsync } = useStartLongTakeWorkflow()
  const { uploadFile } = useSignedUpload({ module: 'media', onError: () => undefined })
  const isSending = useAtomValue(getIsSendingAtom(state))
  const [chatBoxMode, setChatBoxMode] = useAtom(chatBoxModeAtom)
  const enhancer = useEnhancerHandlers(message, editorRef, setChatBoxMode)
  const { isEnhancing } = enhancer

  // --- g. Project operations ---
  const projectOps = useProjectOperations({
    attachments,
    defaultVoiceId,
    fetchWithProjectId,
    imageUrisRef,
    parseUrl,
    selectedRatio,
    selectedVoice,
    showCaptions,
    uploadFile,
    useCaseKey,
  })

  // --- h. Style management ---
  const styleMgmt = useStyleManagement(
    sd.committedStoryModeStyle,
    sd.appliedCustomStoryStyle?.imageDataUrl,
    sd.isLongTakeStyleImageProcessing,
    userSavedStyles,
    userSavedStylesById,
    sd.storyModeStyleId,
    sd.handleStoryModeStyleClear,
  )

  // --- i. Validation + prompt computations ---
  const normalizedPrompt = useMemo(
    () => (effectiveLongTakeEnabled ? normalizeLongTakeScript(message) : message.trim()),
    [effectiveLongTakeEnabled, message],
  )
  const isPromptValid = normalizedPrompt.length > 0
  const characterCount = normalizedPrompt.length
  const { checkBeforeSend, resolveReferencedImages } = useValidation(
    state,
    attachments,
    effectiveLongTakeEnabled,
    sd.hasLongTakeStyle,
  )
  // --- j. Send state ---
  const sendState = useSendState({
    activeStoryModeAudioAttachment,
    activeStoryModeAudioId: audio.activeStoryModeAudioId,
    attachments,
    disabled,
    hasFailedImageAttachment,
    imageUploadingCount,
    isEnhancing,
    isLongTakeStyleImageProcessing: sd.isLongTakeStyleImageProcessing,
    isPromptValid,
    isSending,
    longTakeCustomStyle: sd.longTakeCustomStyle,
    longTakeEnabled: effectiveLongTakeEnabled,
    longTakeStyleInputMode: sd.longTakeStyleInputMode,
    storyModeAudioTranscriptError: audio.storyModeAudioTranscriptError,
    storyModeAudioTranscriptStatus: audio.storyModeAudioTranscriptStatus,
    storyModeAudioTranscriptText: audio.storyModeAudioTranscriptText,
    storyModeAudioUploadId: audio.storyModeAudioUploadId as never,
    storyModeAudioUploadStatus: audio.storyModeAudioUploadStatus,
  })

  // --- k. File processing + anchor handlers ---
  // Pre-upload confirmation for video-as-audio sources. Promise-bridge owned
  // here so every caller of processFiles (voice-over dialog picker,
  // drag-and-drop, generic file input) hits the same gate.
  const [pendingVideoAudioFile, setPendingVideoAudioFile] = useState<File | null>(null)
  const pendingVideoAudioResolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const confirmVideoAudioSource = useRefCallback(
    (file: File) =>
      new Promise<boolean>((resolve) => {
        // Evict any prior pending resolver so a stale processFiles iteration
        // doesn't hang if a second file comes in before the first resolves.
        pendingVideoAudioResolverRef.current?.(false)
        pendingVideoAudioResolverRef.current = resolve
        setPendingVideoAudioFile(file)
      }),
  )

  const handleVideoAudioConfirm = useRefCallback(() => {
    pendingVideoAudioResolverRef.current?.(true)
    pendingVideoAudioResolverRef.current = null
    setPendingVideoAudioFile(null)
    // Close the voice-over dialog on confirm to match the audio-file flow
    // (which closes in AudioVoiceoverDialog.handleAudioInputChange's
    // finally block). On cancel we intentionally leave it open so the
    // user returns to the picker.
    setIsAudioVoiceoverDialogOpen(false)
  })

  const handleVideoAudioCancel = useRefCallback(() => {
    pendingVideoAudioResolverRef.current?.(false)
    pendingVideoAudioResolverRef.current = null
    setPendingVideoAudioFile(null)
  })

  // Unmount cleanup so an awaiting processFiles doesn't stall past teardown.
  useEffect(() => {
    return () => {
      pendingVideoAudioResolverRef.current?.(false)
      pendingVideoAudioResolverRef.current = null
    }
  }, [])

  const { handleFileChange, handleAnchorAssetUpload, processFiles } = useFileProcessing(
    attachments,
    effectiveLongTakeEnabled,
    effectiveLongTakeEnabled,
    message,
    editorRef,
    setMessage,
    setAttachments,
    audio.uploadStoryModeAudioToTemp,
    uploadImageAttachment,
    confirmVideoAudioSource,
  )
  const handleAnchorAssetRemove = useRefCallback((asset: AnchorAssetPromptItem) => {
    setAttachments((prev) => prev.filter((a) => a.id !== asset.attachment.id))
  })
  const handleAnchorAssetSelect = useRefCallback((asset: AnchorAssetPromptItem) => {
    const rid = asset.attachment.id || asset.attachment.url || asset.resourceId
    if (!rid) {
      return
    }
    geEditor()?.insertMetaTag(rid, asset.displayName, asset.attachment.type, asset.previewUrl)
    setIsAddAssetsDialogOpen(false)
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const handleFileUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])
  const handleTextareaFocus = useCallback(() => undefined, [])

  // --- l. resetEditorState ---
  // keepStoryModeContext: when true, this is a no-op so the script-preview / planner
  // dialog can keep reading every piece of state set up in the chatbox: message text,
  // attachments, longTakeEnabled, audio upload/transcript, and style/preset. Clearing
  // even just `message` would detach the audio attachment, since active attachments
  // derive from getActiveAttachments(message, attachments) and an empty message
  // returns no active resources. The full reset still runs once the dialog completes
  // (see use-omni-chat-box-script-preview post-confirm path).
  const resetEditorState = useCallback(
    (opts: { keepStoryModeContext?: boolean } = {}) => {
      if (opts.keepStoryModeContext) {
        return
      }
      geEditor()?.clear()
      setMessage('')
      setAttachments([])
      imageUrisRef.current.clear()
      setLongTakeEnabled(false)
      sd.setStoryModeStyleId(STORY_MODE_EMPTY_STYLE_ID)
      sd.setAppliedCustomStoryStyle(null)
      sd.setRemixProjectId(undefined)
      sd.setIsStyleCopy(undefined)
      sd.clearStyleImage()
      sd.resetLongTakeStyleDraft()
      audio.setStoryModeAudioUploadId(null)
      audio.setStoryModeAudioUploadStatus('idle' as never)
    },
    [
      sd.clearStyleImage,
      sd.resetLongTakeStyleDraft,
      sd.setAppliedCustomStoryStyle,
      sd.setStoryModeStyleId,
      audio.setStoryModeAudioUploadId,
      audio.setStoryModeAudioUploadStatus,
      setAttachments,
      setLongTakeEnabled,
      setMessage,
    ],
  )

  // --- m. Submission (uses refs to bridge circular dep with script preview) ---
  const spStartRef = useRef<(msg: string) => Promise<void>>(async () => undefined)
  const spStartFromAudioRef = useRef<
    (p: { audioAttachmentId: string; transcriptScript: string; userPrompt: string }) => void
  >(() => undefined)

  const sub = useSubmission({
    activeStoryModeAudioAttachment,
    allPanelStyleOptions,
    attachments,
    autoSaveCurrentStoryStyle: styleMgmt.autoSaveCurrentStoryStyle,
    checkBeforeSend,
    onBeforeSubmit,
    clearRemixAttribution: sd.clearRemixAttribution,
    committedStoryModeStyle: sd.committedStoryModeStyle,
    defaultVoiceId,
    ensureStoryModeAudioUploaded: audio.ensureStoryModeAudioUploaded,
    geEditor,
    isScriptPreviewSubmitting: false,
    isSending,
    longTakeEnabled: effectiveLongTakeEnabled,
    isStyleCopy: sd.isStyleCopy,
    message,
    newMobileView: true,
    projectOps: projectOps as never,
    remixProjectId: sd.remixProjectId,
    resetEditorState,
    resetScriptPreviewState: () => undefined,
    resolveReferencedImages,
    router,
    scriptPreviewAudioAttachmentId: null,
    scriptPreviewSource: 'prompt_generated',
    scriptPreviewStatus: 'idle',
    scriptPreviewText: '',
    scriptPreviewUserPromptRef: { current: null } as never,
    selectedRatio,
    selectedVoice,
    showCaptions,
    setAppliedCustomStoryStyle: sd.setAppliedCustomStoryStyle,
    setAttachments,
    setIsScriptPreviewSubmitting: () => undefined,
    setIsStyleCopy: sd.setIsStyleCopy,
    setLongTakeEnabled,
    setMessage,
    setRemixedSavedStyleThumbnailFallback: sd.setRemixedSavedStyleThumbnailFallback,
    setRemixProjectId: sd.setRemixProjectId,
    setSelectedRatio,
    setStoryModeAudioTranscriptStatus: audio.setStoryModeAudioTranscriptStatus as never,
    setStoryModeAudioTranscriptText: audio.setStoryModeAudioTranscriptText,
    setStoryModeStyleId: sd.setStoryModeStyleId,
    startLongTakeAsync: startLongTakeAsync as never,
    startScriptPreview: ((msg: string) => spStartRef.current(msg)) as never,
    startScriptPreviewFromAudio: ((params: Record<string, unknown>) =>
      spStartFromAudioRef.current(params as never)) as never,
    state,
    storyModeAudioTranscriptText: audio.storyModeAudioTranscriptText,
    storyModeLayoutEnabled,
    useCaseKey,
  })

  // --- n. Script preview ---
  const sp = useScriptPreview({
    attachments,
    autoSaveCurrentStoryStyle: styleMgmt.autoSaveCurrentStoryStyle,
    buildStoryModeStartStyleOptions: sub.buildStoryModeStartStyleOptions,
    ensureStoryModeAttachments: sub.ensureStoryModeAttachments as never,
    ensureStoryModeProject: sub.ensureStoryModeProject as never,
    fetchApiDomain,
    getLongTakeAudioAttachment: sub.getLongTakeAudioAttachment,
    imageUrisRef,
    isStoryModeAudioReady: sendState.isStoryModeAudioReady,
    isStoryModeAudioTranscriptError: sendState.isStoryModeAudioTranscriptError,
    isStoryModeAudioTranscriptReady: sendState.isStoryModeAudioTranscriptReady,
    isStoryModeAudioUploadError: sendState.isStoryModeAudioUploadError,
    isStyleCopy: sd.isStyleCopy,
    isStoryModeRoute,
    longTakeEnabled: effectiveLongTakeEnabled,
    longTakeStyleImageFile: sd.longTakeStyleImageFile,
    longTakeStyleInputMode: sd.longTakeStyleInputMode,
    remixProjectId: sd.remixProjectId,
    resetEditorState,
    resolveStoryModeReferencedImagesOrNotify: sub.resolveStoryModeReferencedImagesOrNotify,
    router: router as never,
    selectedRatio,
    startLongTakeAsync: startLongTakeAsync as never,
    startStoryModeAudioTranscriptPreview: audio.startStoryModeAudioTranscriptPreview as never,
    state,
    storyModeAudioDurationSeconds: audio.storyModeAudioDurationSeconds,
    storyModeAudioTranscriptError: audio.storyModeAudioTranscriptError,
    storyModeAudioTranscriptStatus: audio.storyModeAudioTranscriptStatus,
    storyModeAudioTranscriptText: audio.storyModeAudioTranscriptText,
    storyModeAudioUploadStatus: audio.storyModeAudioUploadStatus,
    uploadStoryModeAudioToTemp: audio.uploadStoryModeAudioToTemp,
    useCaseKey,
  })
  // Wire real sp functions only after this render commits. Updating these
  // bridges during render can leak callbacks from discarded concurrent work.
  useLayoutEffect(() => {
    spStartRef.current = sp.startScriptPreview
    spStartFromAudioRef.current = sp.startScriptPreviewFromAudio
  }, [sp.startScriptPreview, sp.startScriptPreviewFromAudio])

  const guardedSubmit = useRefCallback(async () => {
    if (sendState.disableSend) {
      // Every gate a user can tap through to resolves a reason, so this branch
      // always tells them something. The mobile Generate button is a sibling of
      // the composer and cannot read `disableSend`, so this toast is its only
      // feedback channel.
      const reason = sendState.submitDisabledReason
      if (reason) {
        toast.warning(reason.message)
      }
      return
    }
    await sub.handleSubmit()
  })

  const guardedSub = useMemo(() => ({ ...sub, handleSubmit: guardedSubmit }), [guardedSubmit, sub])

  // --- o. Effects + imperative handle ---
  useEffects({
    disabled,
    longTakeEnabled: effectiveLongTakeEnabled,
    message,
    newMobileView: true,
    processFiles,
    projectId,
    selectedRatio,
    setAttachments,
    setIsAddAssetsDialogOpen,
    setSelectedRatio: setSelectedRatio as never,
    storyModeLayoutEnabled,
  })
  useEffect(() => {
    if (!onSettingsChange) {
      return
    }
    onSettingsChange({
      aspectRatio: selectedRatio,
      isStoryModeLayout: storyModeLayoutEnabled,
      selectedVoiceId: selectedVoice?.value ?? null,
      showCaptions,
      storyModeStyleId: sd.storyModeStyleId,
    })
  }, [
    onSettingsChange,
    storyModeLayoutEnabled,
    selectedRatio,
    selectedVoice,
    showCaptions,
    sd.storyModeStyleId,
  ])

  return {
    // Props passthrough
    disabled,
    // State
    state,
    attachments,
    setAttachments,
    message,
    setMessage,
    geEditor,
    editorRef,
    handleEditorRef,
    voiceOptions,
    selectedVoice,
    setSelectedVoice,
    previewSelectedVoice,
    sd, // style draft
    isAddAssetsDialogOpen,
    setIsAddAssetsDialogOpen,
    isVoiceSelectionDialogOpen,
    setIsVoiceSelectionDialogOpen,
    isAudioVoiceoverDialogOpen,
    setIsAudioVoiceoverDialogOpen,
    pendingVideoAudioFile,
    handleVideoAudioConfirm,
    handleVideoAudioCancel,
    longTakeTargetDurationSeconds,
    setLongTakeTargetDurationSeconds,
    showCaptions,
    setShowCaptions,
    selectedRatio,
    setSelectedRatio,
    longTakeEnabled: effectiveLongTakeEnabled,
    setLongTakeEnabled,
    hasActiveAttachmentsInMessage,
    uploadedStoryModeAnchorAssets,
    activeStoryModeAudioAttachment,
    hasStoryModeAudioAttachment,
    // Audio
    audio,
    wordCount,
    // Image upload
    imageUrisRef,
    imageUploadingCount,
    uploadImageAttachment,
    // Route/mode
    isStoryModeRoute,
    storyModeLayoutEnabled,
    router,
    isSending,
    chatBoxMode,
    setChatBoxMode,
    enhancer,
    isEnhancing,
    // Project ops
    projectOps,
    // Style management
    styleMgmt,
    // Validation
    normalizedPrompt,
    isPromptValid,
    characterCount,
    checkBeforeSend,
    resolveReferencedImages,
    // Send state
    sendState,
    // File processing
    handleFileChange,
    handleAnchorAssetUpload,
    processFiles,
    handleAnchorAssetRemove,
    handleAnchorAssetSelect,
    deleteLastChar: () => geEditor()?.deleteLastChar(),
    dismissMentionMenu: () => geEditor()?.dismissMentionMenu(),
    insertText: (text: string) => geEditor()?.insertText(text),
    fileInputRef,
    handleFileUploadClick,
    handleTextareaFocus,
    // Submission + script preview
    sub: guardedSub,
    sp,
    plannerDialogOpen,
    setPlannerDialogOpen,
    plannerState,
    setPlannerState,
    storyModeStyleOptions,
    userStoryModeStyleOptions,
    defaultVoiceId,
  }
}
