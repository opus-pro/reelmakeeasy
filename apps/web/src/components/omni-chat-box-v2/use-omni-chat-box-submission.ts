import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Attachment } from '@shared/types/assets/attachment'
import { toast } from '@shared/ui'
import { useSetAtom } from 'jotai'
import { useCallback } from 'react'

import type { ApplyLongTakeTemplatePayload, ApplyQuickStartTemplatePayload } from '@/atom/home'
import { musicEnabledAtom, pendingRemixBgmAtom, pendingSourceVoiceAtom } from '@/atom/home'
import {
  extractActiveResourceIds,
  getActiveAttachments,
} from '@/components/markdown-editor/md-utils'
import {
  convertVoiceOptionToApiFormat,
  type VoiceOption,
} from '@/components/voice/components/voice-over-selection'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import { useRefCallback } from '@/hooks/use-ref-callback'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import type { UserSavedStyleInputMode } from '@/hooks/useUserSavedStyles'
import { whenNonNullable } from '@/lib/jotai-atom-utils'
import { getErrorMessage } from '@/util/error-message'

import type { MarkdownEditorHandle } from '../markdown-editor/EditorContainer'

import {
  getDisposersAtom,
  getIsSendingAtom,
  getMarkdownEditorAtom,
  getMessageAtom,
} from './state/atoms/domain/runtime'
import type { ChatBoxState } from './state/chatbox-state'
import { findExistingStyleMatch } from './style/style-match-utils'
import { seedRemixBgmCarry } from './bgm-creation-payload'
import type { CommittedCustomStoryStyle } from './omni-chat-box.types'
import {
  createAutoSavedStyleBaseName,
  isStoryModeAudioAttachment,
  normalizeLongTakeScript,
  type ResolveReferencedImagesFn,
  STORY_MODE_EMPTY_STYLE_ID,
} from './omni-chat-box-helpers'
import { STORY_MODE_CUSTOM_STYLE_ID } from './omni-chat-box-render-helpers'

const nsLogger = Logger.get('omni-chat-box')

export interface SubmissionDeps {
  activeStoryModeAudioAttachment: Attachment | null
  allPanelStyleOptions: StoryModeStyleOption[]
  attachments: Attachment[]
  autoSaveCurrentStoryStyle: () => Promise<void>
  checkBeforeSend: (msg: string) => boolean
  clearRemixAttribution?: () => void
  committedStoryModeStyle: null | {
    customStyle: boolean
    generationStyleText?: null | string
    isSavedStyle: boolean
    /** Set only for a real saved style; used to link it to the project. */
    savedStyleId?: string
    shortDescription?: string
    styleInputMode: string
    styleName?: string
    styleText: string
    styleThumbnailUrl?: string
  }
  defaultVoiceId: string
  ensureStoryModeAudioUploaded: (attachment: Attachment | null) => Promise<string | undefined>
  geEditor: () => MarkdownEditorHandle | null
  isScriptPreviewSubmitting: boolean
  isSending: boolean
  isStyleCopy?: boolean
  longTakeEnabled: boolean
  message: string
  newMobileView?: boolean
  onBeforeSubmit?: () => void
  projectOps: {
    createLongTakeProjectForAudio: (
      normalizedScript: string,
      audioAttachment: Attachment,
      userPrompt: string,
      normalize: (s: string) => string,
    ) => Promise<undefined | { audioUri?: string; projectId?: string }>
    createLongTakeProjectForTranscript: (
      normalizedScript: string,
      userPrompt: string,
      normalize: (s: string) => string,
      transcriptProjectText: string,
    ) => Promise<string | undefined>
    handleCreateNormalProject: (...args: never[]) => Promise<void>
    uploadLongTakeStyleImage: (projectId: string, file: File) => Promise<void>
    uploadStoryModeReferencedImages: (
      projectId: string,
      userPrompt: string,
      resolveReferencedImages: ResolveReferencedImagesFn,
    ) => Promise<void>
  }
  remixProjectId?: string
  resetEditorState: (opts?: { keepStoryModeContext?: boolean }) => void
  resetScriptPreviewState: () => void
  resolveReferencedImages: ResolveReferencedImagesFn
  router: { push: (url: string) => void }
  scriptPreviewAudioAttachmentId: null | string
  scriptPreviewSource: string
  scriptPreviewStatus: string
  scriptPreviewText: string
  scriptPreviewUserPromptRef: React.MutableRefObject<null | string>
  selectedRatio: AspectRatio
  selectedVoice: null | VoiceOption
  setAppliedCustomStoryStyle: (v: CommittedCustomStoryStyle | null) => void
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  setIsScriptPreviewSubmitting: (v: boolean) => void
  setIsStyleCopy?: (v: boolean | undefined) => void
  setLongTakeEnabled: (v: boolean) => void
  setMessage: (v: string) => void
  setRemixedSavedStyleThumbnailFallback: (
    v: null | { savedStyleId: string; thumbnailUrl: string },
  ) => void
  setRemixProjectId?: (v: string | undefined) => void
  setSelectedRatio?: (ratio: AspectRatio) => void
  setStoryModeAudioTranscriptStatus: (v: string) => void
  setStoryModeAudioTranscriptText: (v: string) => void
  setStoryModeStyleId: (v: string) => void
  showCaptions: boolean
  startLongTakeAsync: (params: Record<string, unknown>) => Promise<{ projectId: string }>
  startScriptPreview: (msg: string) => Promise<void>
  startScriptPreviewFromAudio: (params: {
    audioAttachmentId: string
    transcriptScript: string
    userPrompt: string
  }) => void
  state: ChatBoxState
  storyModeAudioTranscriptText: string
  storyModeLayoutEnabled: boolean
  // Fires style_reused if a saved custom style is applied at story-mode submit.
  /**
   * Home omnibox use-case chip active at submit time. 'song-to-video'
   * submissions with an uploaded audio attachment send `is_music: true` on
   * session create so the backend takes the music route.
   */
  useCaseKey?: CreateUseCaseKey
}

/**
 * Like syncChatBoxMessage, but for template-apply callers that need to write a
 * prompt into the editor. If the Lexical editor hasn't registered yet (common
 * during the OmniChatBox mount cycle), we defer the initWithValue call until it
 * does, identical to the deferred-sync pattern in state/flows/message.ts.
 * The stale-check on getMessageAtom ensures a racing syncChatBoxMessage('', ...)
 * that fires before the editor registers cannot overwrite a valid prompt.
 */
export function useSubmission(deps: SubmissionDeps) {
  const setPendingSourceVoice = useSetAtom(pendingSourceVoiceAtom)
  // Remix BGM carry: a remix apply resets the toggle and arms a
  // source-bound intent that useRemixBgmCarry resolves.
  const setMusicEnabled = useSetAtom(musicEnabledAtom)
  const setPendingRemixBgm = useSetAtom(pendingRemixBgmAtom)
  const {
    activeStoryModeAudioAttachment,
    attachments,
    checkBeforeSend,
    committedStoryModeStyle,
    defaultVoiceId,
    geEditor,
    isSending,
    longTakeEnabled,
    message,
    projectOps,
    resetEditorState,
    resolveReferencedImages,
    router,
    selectedVoice,
    setAppliedCustomStoryStyle,
    setAttachments,
    setLongTakeEnabled,
    setMessage,
    setRemixedSavedStyleThumbnailFallback,
    setStoryModeAudioTranscriptStatus,
    setStoryModeAudioTranscriptText,
    setStoryModeStyleId,
    startScriptPreview,
    startScriptPreviewFromAudio,
    state,
    storyModeAudioTranscriptText,
  } = deps

  const buildStoryModeStartStyleOptions = (hasAudioAttachment: boolean) => {
    const styleText = committedStoryModeStyle?.styleText?.trim() || ''
    const customStyle = Boolean(committedStoryModeStyle?.customStyle)
    const isSavedStyle = committedStoryModeStyle?.isSavedStyle ?? false
    const styleInputMode = (committedStoryModeStyle?.styleInputMode ??
      'text') as UserSavedStyleInputMode
    const styleName =
      committedStoryModeStyle?.styleName?.trim() ||
      (customStyle ? createAutoSavedStyleBaseName(styleText, styleInputMode) : undefined)
    const styleThumbnailUrl = committedStoryModeStyle?.styleThumbnailUrl?.trim()
    // A saved image style's picture guides every frame; the server looks it up by id.
    const savedStyleId = isSavedStyle
      ? committedStoryModeStyle?.savedStyleId?.trim() || undefined
      : undefined
    const voice =
      !hasAudioAttachment && selectedVoice
        ? convertVoiceOptionToApiFormat(selectedVoice, defaultVoiceId)
        : undefined
    const voiceId = voice?.voiceId
    return {
      customStyle,
      isSavedStyle,
      savedStyleId,
      styleName,
      styleText,
      styleThumbnailUrl,
      voice,
      voiceId,
    }
  }

  const resolveStoryModeReferencedImagesOrNotify = (userPrompt: string): Attachment[] | null => {
    const { unresolvedReferences } = resolveReferencedImages(userPrompt)
    if (unresolvedReferences.length > 0) {
      toast.warning(`Missing referenced images: ${unresolvedReferences.slice(0, 3).join(', ')}`)
      return null
    }
    return attachments.filter((att) => att.type.startsWith('image/'))
  }

  const ensureStoryModeProject = async (params: {
    audioAttachment?: Attachment
    normalizedScript: string
    referencedImages: Attachment[]
    styleImageFile: File | null
    transcriptProjectText: string
    userPrompt: string
  }): Promise<{ audioUri?: string; projectId?: string }> => {
    const {
      audioAttachment,
      normalizedScript,
      referencedImages,
      styleImageFile,
      transcriptProjectText,
      userPrompt,
    } = params
    let pid: string | undefined
    let audioUri: string | undefined
    if (audioAttachment) {
      const audioProjectPayload = await projectOps.createLongTakeProjectForAudio(
        normalizedScript,
        audioAttachment,
        userPrompt,
        normalizeLongTakeScript,
      )
      pid = audioProjectPayload?.projectId
      audioUri = audioProjectPayload?.audioUri
      if (!audioUri || !pid) {
        throw new Error('Failed to upload audio file')
      }
    }
    const needsTranscriptProject = !pid && (Boolean(styleImageFile) || referencedImages.length > 0)
    if (needsTranscriptProject) {
      pid = await projectOps.createLongTakeProjectForTranscript(
        normalizedScript,
        userPrompt,
        normalizeLongTakeScript,
        transcriptProjectText,
      )
    }
    return { audioUri, projectId: pid }
  }

  const ensureStoryModeAttachments = async (params: {
    projectId?: null | string
    referencedImages: Attachment[]
    styleImageFile: File | null
    userPrompt: string
  }) => {
    const { projectId: pid, referencedImages, styleImageFile, userPrompt } = params
    if (styleImageFile && pid) {
      await projectOps.uploadLongTakeStyleImage(pid, styleImageFile)
    }
    if (pid && referencedImages.length > 0) {
      const { shortnameByAttachmentId } = resolveReferencedImages(userPrompt)
      await projectOps.uploadStoryModeReferencedImages(pid, userPrompt, () => ({
        referencedImages,
        shortnameByAttachmentId,
        unresolvedReferences: [],
      }))
    }
  }

  const getLongTakeAudioAttachment = useCallback(
    (msg: string) => {
      const activeAtts = getActiveAttachments(msg, attachments)
      return activeAtts.find((att) => isStoryModeAudioAttachment(att))
    },
    [attachments],
  )

  const openScriptPreview = useCallback(
    async (messageToSend: string, hasStoryModeAudio: boolean) => {
      if (hasStoryModeAudio) {
        const transcriptScript = storyModeAudioTranscriptText
        if (!activeStoryModeAudioAttachment?.id) {
          toast.warning('Audio file is still syncing. Please wait and try again.')
          return
        }
        startScriptPreviewFromAudio({
          audioAttachmentId: activeStoryModeAudioAttachment.id,
          transcriptScript,
          userPrompt: messageToSend,
        })
        return
      }
      await startScriptPreview(messageToSend)
    },
    [
      activeStoryModeAudioAttachment?.id,
      startScriptPreview,
      startScriptPreviewFromAudio,
      storyModeAudioTranscriptText,
    ],
  )

  /**
   * Validates the submission for its resolved workflow, then commits exactly one
   * direct or legacy creation path.
   */
  const handleSubmit = useRefCallback(async () => {
    if (isSending) {
      return
    }
    const messageToSend = message.trim()
    if (!checkBeforeSend(messageToSend)) {
      return
    }
    const attachmentsToSend = [...attachments]
    const longTakeSubmit = longTakeEnabled
    const hasStoryModeAudio = longTakeSubmit && Boolean(activeStoryModeAudioAttachment)
    state.set(getIsSendingAtom, true)
    try {
      // Fire after all synchronous validation so early returns (isSending, checkBeforeSend)
      // don't trigger a draft clear. Callers should treat this as "submit committed",
      // not "submit succeeded" -- the catch below restores in-memory state on failure
      // but persisted storage (localStorage / IDB) is not restored.
      deps.onBeforeSubmit?.()
      if (longTakeEnabled) {
        resetEditorState({ keepStoryModeContext: true })
        await openScriptPreview(messageToSend, hasStoryModeAudio)
      } else {
        resetEditorState()
        await (projectOps.handleCreateNormalProject as never as Function)(messageToSend, router)
      }
    } catch (err) {
      setMessage(messageToSend)
      setAttachments(attachmentsToSend)
      handleSubmissionError(err)
    } finally {
      state.set(getIsSendingAtom, false)
    }
  })

  const applyStyleFromTemplatePayload = useRefCallback(
    (input: {
      previewUrl?: string
      styleName?: string
      styleText?: string
      styleThumbnailUrl?: string
    }) => {
      const { previewUrl, styleName, styleText, styleThumbnailUrl } = input
      const trimmedStyleText = styleText?.trim()
      if (!trimmedStyleText) {
        setAppliedCustomStoryStyle(null)
        setStoryModeStyleId(STORY_MODE_EMPTY_STYLE_ID)
        return
      }
      const payloadThumb = styleThumbnailUrl?.trim() || previewUrl?.trim()
      const existingMatch = findExistingStyleMatch(trimmedStyleText, deps.allPanelStyleOptions)
      if (existingMatch) {
        setAppliedCustomStoryStyle(null)
        setStoryModeStyleId(existingMatch.id)
        // If the matched saved style has no thumbnail but the demo payload
        // does, stash the demo's thumbnail as a render-time fallback so the
        // chip preview doesn't go blank.
        if (!existingMatch.thumbnailUrl?.trim() && payloadThumb) {
          setRemixedSavedStyleThumbnailFallback({
            savedStyleId: existingMatch.id,
            thumbnailUrl: payloadThumb,
          })
        }
        return
      }
      setAppliedCustomStoryStyle({
        previewUrl: payloadThumb || undefined,
        styleInputMode: 'text',
        styleName: styleName?.trim() || undefined,
        styleText: trimmedStyleText,
      })
      setStoryModeStyleId(STORY_MODE_CUSTOM_STYLE_ID)
    },
  )

  const applyLongTakeTemplate = useRefCallback((payload: ApplyLongTakeTemplatePayload) => {
    const {
      aspectRatio,
      attachments: templateAttachments,
      audioUrl,
      isStyleCopy: payloadIsStyleCopy,
      previewUrl,
      remixProjectId: payloadRemixProjectId,
      sourceVoice,
      styleName,
      styleText,
      styleThumbnailUrl,
    } = payload
    // A remixed source video arrives as a video/* attachment + an @video tag,
    // but the planner's initialAssets are image-only, so a carried @video never
    // reaches the planner as an asset. Route the source video through the audio
    // path instead (its audio drives the output), mirroring the voice-over
    // video path.
    //
    // Detect with isStoryModeAudioAttachment, NOT a bare `video/` prefix: the
    // chat box accepts containers the audio pipeline can't extract (.webm/.wmv/
    // .flv/.3gp -- GPT_VIDEO_TYPES is wider than STORY_MODE_AUDIO_VIDEO_EXTENSIONS).
    // A bare prefix would route those to audio, where the submit-time
    // isStoryModeAudioAttachment check rejects them -> never uploaded, and (being
    // excluded from visuals below) silently lost behind a phantom @audio pill.
    // Only the first audio-capable video is used (single audio slot); an explicit
    // source audioUrl wins over a carried video.
    const carriedVideoAttachment = (templateAttachments ?? []).find((att) =>
      isStoryModeAudioAttachment(att),
    )
    const effectiveAudioUrl = audioUrl ?? carriedVideoAttachment?.url
    setLongTakeEnabled(true)
    // Carry the source ratio so a remix reproduces the original instead of
    // defaulting to 9:16. Set after enabling long
    // take so the ratio-reset effect sees storyModeLayoutEnabled.
    if (aspectRatio) {
      deps.setSelectedRatio?.(aspectRatio)
    }
    // When audio drives voice at runtime (an explicit audioUrl OR a carried
    // source video routed as audio), skip sourceVoice resolution to avoid
    // overwriting the user's pinned default with whatever is in voiceOverJson
    // (which Story Mode doesn't reconcile).
    setPendingSourceVoice(effectiveAudioUrl ? null : (sourceVoice ?? null))
    deps.setRemixProjectId?.(payloadRemixProjectId)
    deps.setIsStyleCopy?.(payloadIsStyleCopy)
    // Remix BGM carry: reset the toggle + arm source-bound intent
    // for the reconciler (useRemixBgmCarry). See seedRemixBgmCarry for why the
    // decision cannot happen at apply time.
    seedRemixBgmCarry(payload, setMusicEnabled, setPendingRemixBgm)
    applyStyleFromTemplatePayload({
      previewUrl,
      styleName,
      styleText,
      styleThumbnailUrl,
    })

    // Always reset prior chatbox state so a previous remix's assets/prompt/audio
    // don't leak into a new template application (e.g. switching from a remix
    // with assets to a style-only "Use This Style" action).
    setAttachments([])
    setMessage('')
    geEditor()?.initWithValue('', { scrollToTop: true })
    setStoryModeAudioTranscriptStatus('idle')
    setStoryModeAudioTranscriptText('')
    // The showcase feature is off, so a template applies only its style: the
    // source prompt, assets and audio are not carried into the composer.
  })

  const applyQuickStartTemplate = useRefCallback((payload: ApplyQuickStartTemplatePayload) => {
    const { prompt, attachments: templateAttachments } = payload
    if (templateAttachments) {
      setAttachments(templateAttachments)
    }
    setMessage(prompt ?? '')
    applyEditorContent(state, prompt ?? '', geEditor)
    const editor = geEditor()
    if (editor) {
      const existingIds = extractActiveResourceIds(prompt)
      templateAttachments?.forEach((att) => {
        if (!existingIds.has(att.id) && !existingIds.has(att.url || '')) {
          editor.insertMetaTag(att.id, att.name, att.type, att.url)
        }
      })
    }
  })

  return {
    applyLongTakeTemplate,
    applyQuickStartTemplate,
    buildStoryModeStartStyleOptions,
    ensureStoryModeAttachments,
    ensureStoryModeProject,
    getLongTakeAudioAttachment,
    handleSubmit,
    resolveStoryModeReferencedImagesOrNotify,
  }
}

// Song-to-video entry: declare the uploaded audio as music so the backend
// pins is_music on the session and skips genre detection. Only meaningful
// when the submission actually carries audio.
function applyEditorContent(
  state: ChatBoxState,
  editorContent: string,
  geEditor: () => MarkdownEditorHandle | null,
) {
  const editor = geEditor()
  if (editor) {
    editor.initWithValue(editorContent, { scrollToTop: true })
    return
  }
  const dispose = whenNonNullable(state.store, getMarkdownEditorAtom(state), (nextEditor) => {
    if (state.get(getMessageAtom) !== editorContent) {
      return
    }
    nextEditor.initWithValue(editorContent, { scrollToTop: true })
  })
  dispose && state.get(getDisposersAtom).add(dispose)
}

function handleSubmissionError(err: unknown) {
  nsLogger.error(err)
  toast.error(getErrorMessage(err, 'Failed to start project. Please try again.'))
}
