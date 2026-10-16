import { type CameraStyle, sanitizeCameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import {
  resolveMusicRequest,
  sanitizeMusicRequest,
} from '@reelmakeeasy/common/long-take/music-craft'
import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { countWords } from '@reelmakeeasy/common/utils/text'
import {
  LongTakeScriptGeneratorPath,
  LongTakeScriptPreviewResponse,
} from '@shared/types/api/long-take'
import { Attachment } from '@shared/types/assets/attachment'
import { toast } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cameraStyleAtom,
  musicRequestAtom,
  videoModelChoiceAtom,
  videoQualityAtom,
} from '@/atom/home'
import { getActiveAttachments } from '@/components/markdown-editor/md-utils'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import { useRefCallback } from '@/hooks/use-ref-callback'
import type { useApi } from '@/hooks/useApi'
import { useModels } from '@/hooks/useModels'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'
import { getErrorMessage } from '@/util/error-message'

import { resolveAnchorAssetsFromAttachments } from './anchor-assets/anchor-assets.utils'
import {
  getIsSendingAtom,
  getLongTakeTargetDurationSecondsAtom,
} from './state/atoms/domain/runtime'
import type { ChatBoxState } from './state/chatbox-state'
import type { AnchorAssetPromptItem } from './anchor-assets'
import type { AsyncStatus, ScriptPreviewSource } from './omni-chat-box.types'
import {
  isStoryModeAudioAttachment,
  normalizeLongTakeScript,
  STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE,
  STORY_MODE_SCRIPT_PREVIEW_RETRY_MESSAGE,
} from './omni-chat-box-helpers'
import { videoGenerationParams } from './video-choices'

export interface ScriptPreviewDeps {
  attachments: Attachment[]
  autoSaveCurrentStoryStyle: () => Promise<void>
  buildStoryModeStartStyleOptions: (hasAudioAttachment: boolean) => {
    customStyle: boolean
    isSavedStyle: boolean
    savedStyleId?: string
    styleName?: string
    styleText: string
    styleThumbnailUrl?: string
    voiceId?: string
  }
  ensureStoryModeAttachments: (params: {
    projectId?: null | string
    referencedImages: Attachment[]
    styleImageFile: File | null
    userPrompt: string
  }) => Promise<void>
  ensureStoryModeProject: (params: {
    audioAttachment?: Attachment
    normalizedScript: string
    referencedImages: Attachment[]
    styleImageFile: File | null
    transcriptProjectText: string
    userPrompt: string
  }) => Promise<{ audioUri?: string; projectId?: string }>
  fetchApiDomain: ReturnType<typeof useApi>['fetchApiDomain']
  getLongTakeAudioAttachment: (msg: string) => Attachment | undefined
  imageUrisRef: React.MutableRefObject<Map<string, string>>
  isStoryModeAudioReady: boolean
  isStoryModeAudioTranscriptError: boolean
  isStoryModeAudioTranscriptReady: boolean
  isStoryModeAudioUploadError: boolean
  isStoryModeRoute: boolean
  isStyleCopy?: boolean
  longTakeEnabled: boolean
  longTakeStyleImageFile: File | null
  longTakeStyleInputMode: 'image' | 'none' | 'text'
  remixProjectId?: string
  resetEditorState: (opts?: { keepStoryModeContext?: boolean }) => void
  resolveStoryModeReferencedImagesOrNotify: (userPrompt: string) => Attachment[] | null
  router: { prefetch: (route: string) => Promise<void>; push: (url: string) => void }
  selectedRatio: AspectRatio
  startLongTakeAsync: (params: {
    audioUri?: string
    bgmEnabled?: boolean
    bgmNote?: null | string
    cameraStyle?: CameraStyle
    createUseCase?: CreateUseCaseKey
    customStyle?: boolean
    generationResolution?: { videoResolution?: string }
    isSavedStyle?: boolean
    isStyleCopy?: boolean
    perfectLoop?: boolean
    projectId?: string
    prompt?: string
    ratio?: AspectRatio
    remixProjectId?: string
    savedStyleId?: string
    script: string
    scriptGeneratorPath?: LongTakeScriptGeneratorPath
    styleName?: string
    styleText?: string
    styleThumbnailUrl?: string
    targetDurationSeconds?: number
    /** The clip model picked in the composer (Gemini); absent means the provider's default. */
    transitionVideoModel?: string
    userPrompt: string
    voiceId?: string
  }) => Promise<{ projectId: string; videoId: string }>
  startStoryModeAudioTranscriptPreview: (params: {
    attachmentId: string
    audioDuration?: number
    audioUri: string
  }) => void
  state: ChatBoxState
  storyModeAudioDurationSeconds: null | number
  storyModeAudioTranscriptError: string
  storyModeAudioTranscriptStatus: AsyncStatus
  storyModeAudioTranscriptText: string
  storyModeAudioUploadStatus: AsyncStatus
  uploadStoryModeAudioToTemp: (
    file: File,
    attachmentId: string,
    audioDuration?: number,
  ) => Promise<string>
  // Story Mode project type chosen at creation; forwarded to the
  // long-take create request so the no-audio/no-reference path persists it.
  useCaseKey?: CreateUseCaseKey
}

export function useScriptPreview(deps: ScriptPreviewDeps) {
  const videoQuality = useAtomValue(videoQualityAtom)
  const videoModelChoice = useAtomValue(videoModelChoiceAtom)
  const { data: modelRegistry } = useModels()
  const cameraStyle = useAtomValue(cameraStyleAtom)
  const musicRequest = useAtomValue(musicRequestAtom)
  const {
    attachments,
    autoSaveCurrentStoryStyle,
    buildStoryModeStartStyleOptions,
    ensureStoryModeAttachments,
    ensureStoryModeProject,
    fetchApiDomain,
    getLongTakeAudioAttachment,
    imageUrisRef,
    isStoryModeAudioReady,
    isStoryModeAudioTranscriptError,
    isStoryModeAudioTranscriptReady,
    isStoryModeAudioUploadError,
    isStoryModeRoute,
    longTakeEnabled,
    longTakeStyleImageFile,
    longTakeStyleInputMode,
    resetEditorState,
    resolveStoryModeReferencedImagesOrNotify,
    router,
    selectedRatio,
    startLongTakeAsync,
    startStoryModeAudioTranscriptPreview,
    state,
    storyModeAudioDurationSeconds,
    storyModeAudioTranscriptError,
    storyModeAudioTranscriptStatus,
    storyModeAudioTranscriptText,
    storyModeAudioUploadStatus,
    uploadStoryModeAudioToTemp,
  } = deps

  // ---------------------------------------------------------------------------
  // Script preview state
  // ---------------------------------------------------------------------------
  const [scriptPreviewOpen, setScriptPreviewOpen] = useState(false)
  const [scriptPreviewStatus, setScriptPreviewStatus] = useState<AsyncStatus>('idle')
  const [scriptPreviewSource, setScriptPreviewSource] =
    useState<ScriptPreviewSource>('prompt_generated')
  const [scriptPreviewAudioAttachmentId, setScriptPreviewAudioAttachmentId] = useState<
    null | string
  >(null)
  const [scriptPreviewText, setScriptPreviewText] = useState('')
  const storyModeUserLimits = useStoryModeUserLimits()
  const [scriptPreviewGeneratorPath, setScriptPreviewGeneratorPath] = useState<
    LongTakeScriptGeneratorPath | undefined
  >(undefined)
  const [scriptPreviewErrorMessage, setScriptPreviewErrorMessage] = useState<null | string>(null)
  const [isScriptPreviewSubmitting, setIsScriptPreviewSubmitting] = useState(false)
  const scriptPreviewRequestIdRef = useRef(0)
  const scriptPreviewPromptRef = useRef<null | string>(null)
  const scriptPreviewUserPromptRef = useRef<null | string>(null)
  const [scriptPreviewAnchorAssets, setScriptPreviewAnchorAssets] = useState<
    AnchorAssetPromptItem[]
  >([])
  const prefetchedScriptPreviewRoutesRef = useRef<Set<string>>(new Set())

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const scriptPreviewWordCount = useMemo(() => countWords(scriptPreviewText), [scriptPreviewText])
  const isScriptPreviewOverLimit =
    scriptPreviewWordCount > storyModeUserLimits.absoluteMaxScriptWords
  const isScriptPreviewAudioSource = scriptPreviewSource === 'audio_transcript'
  const scriptPreviewAudioAttachment = useMemo(() => {
    if (!isScriptPreviewAudioSource || !scriptPreviewAudioAttachmentId) {
      return null
    }
    return (
      attachments.find(
        (attachment) =>
          attachment.id === scriptPreviewAudioAttachmentId &&
          isStoryModeAudioAttachment(attachment),
      ) || null
    )
  }, [attachments, isScriptPreviewAudioSource, scriptPreviewAudioAttachmentId])
  const scriptPreviewAudioAttachmentName =
    scriptPreviewAudioAttachment?.file?.name || scriptPreviewAudioAttachment?.name || null
  const scriptPreviewDurationSeconds = useMemo(() => {
    if (!isScriptPreviewAudioSource) {
      return null
    }
    if (!Number.isFinite(storyModeAudioDurationSeconds)) {
      return null
    }
    return Math.max(0, Math.round(storyModeAudioDurationSeconds || 0))
  }, [isScriptPreviewAudioSource, storyModeAudioDurationSeconds])
  const isScriptPreviewTranscriptPending = storyModeAudioTranscriptStatus === 'pending'
  const scriptPreviewAudioUploadStatus = storyModeAudioUploadStatus

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------
  const collectImageUris = useCallback(
    (userPrompt: string): string[] => {
      const activeAtts = getActiveAttachments(userPrompt, attachments)
      const paths: string[] = []
      for (const att of activeAtts) {
        if (!att.type.startsWith('image/')) {
          continue
        }
        const fileUri = imageUrisRef.current.get(att.id)
        if (fileUri) {
          paths.push(fileUri)
        }
      }
      return paths
    },
    [attachments, imageUrisRef],
  )

  const resetScriptPreviewState = useCallback(() => {
    scriptPreviewRequestIdRef.current += 1
    scriptPreviewPromptRef.current = null
    scriptPreviewUserPromptRef.current = null
    setScriptPreviewSource('prompt_generated')
    setScriptPreviewAudioAttachmentId(null)
    setScriptPreviewOpen(false)
    setScriptPreviewStatus('idle')
    setScriptPreviewText('')
    setScriptPreviewGeneratorPath(undefined)
    setScriptPreviewErrorMessage(null)
    setScriptPreviewAnchorAssets([])
    setIsScriptPreviewSubmitting(false)
  }, [])

  const closeScriptPreview = useRefCallback(() => {
    setScriptPreviewOpen(false)
    state.set(getIsSendingAtom, false)
  })

  const startScriptPreview = useCallback(
    async (msg: string) => {
      const userPrompt = msg.trim()
      const normalizedForCache = normalizeLongTakeScript(msg)
      const imageUris = collectImageUris(userPrompt)
      const targetDurationSeconds = state.get(getLongTakeTargetDurationSecondsAtom)
      const cacheKey = `${normalizedForCache}|${imageUris.sort().join(',')}|${targetDurationSeconds ?? ''}`
      if (
        scriptPreviewPromptRef.current === cacheKey &&
        (scriptPreviewStatus === 'pending' || scriptPreviewStatus === 'ready')
      ) {
        scriptPreviewUserPromptRef.current = userPrompt
        setScriptPreviewSource('prompt_generated')
        setScriptPreviewAudioAttachmentId(null)
        setScriptPreviewAnchorAssets(resolveAnchorAssetsFromAttachments(attachments))
        setScriptPreviewOpen(true)
        return
      }
      const requestId = scriptPreviewRequestIdRef.current + 1
      scriptPreviewRequestIdRef.current = requestId
      scriptPreviewPromptRef.current = cacheKey
      scriptPreviewUserPromptRef.current = userPrompt
      setScriptPreviewSource('prompt_generated')
      setScriptPreviewAudioAttachmentId(null)
      setScriptPreviewText('')
      setScriptPreviewErrorMessage(null)
      setScriptPreviewAnchorAssets(resolveAnchorAssetsFromAttachments(attachments))
      setScriptPreviewStatus('pending')
      setScriptPreviewOpen(true)
      try {
        const response = await fetchApiDomain<LongTakeScriptPreviewResponse>(
          '/api/long-take-videos/script-preview',
          {
            method: 'POST',
            data: {
              prompt: userPrompt,
              ...(imageUris.length > 0 ? { imageUris } : {}),
              ...buildTargetDurationRequestParams(targetDurationSeconds),
            },
          },
        )
        if (scriptPreviewRequestIdRef.current !== requestId) {
          return
        }
        if (!response.ok) {
          throw new Error(response.error || 'Failed to generate script')
        }
        const isScriptGenerated = response.data.finalScriptSource === 'generated'
        if (!isScriptGenerated) {
          setScriptPreviewText('')
          setScriptPreviewErrorMessage(STORY_MODE_SCRIPT_PREVIEW_RETRY_MESSAGE)
          setScriptPreviewStatus('error')
          return
        }
        setScriptPreviewText(response.data.script || '')
        setScriptPreviewGeneratorPath(response.data.scriptGeneratorPath)
        setScriptPreviewErrorMessage(null)
        setScriptPreviewStatus('ready')
      } catch (err) {
        if (scriptPreviewRequestIdRef.current !== requestId) {
          return
        }
        const errorMessage = getErrorMessage(err, 'Failed to generate script')
        toast.error(errorMessage)
        setScriptPreviewErrorMessage(errorMessage)
        setScriptPreviewStatus('error')
      }
    },
    [attachments, collectImageUris, fetchApiDomain, scriptPreviewStatus],
  )

  const startScriptPreviewFromAudio = useCallback(
    ({
      audioAttachmentId,
      transcriptScript,
      userPrompt,
    }: {
      audioAttachmentId: string
      transcriptScript: string
      userPrompt: string
    }) => {
      scriptPreviewRequestIdRef.current += 1
      scriptPreviewPromptRef.current = null
      scriptPreviewUserPromptRef.current = userPrompt
      setScriptPreviewSource('audio_transcript')
      setScriptPreviewAudioAttachmentId(audioAttachmentId)
      setScriptPreviewText(transcriptScript)
      setScriptPreviewErrorMessage(null)
      setScriptPreviewAnchorAssets(resolveAnchorAssetsFromAttachments(attachments))
      setScriptPreviewStatus('pending')
      setScriptPreviewOpen(true)
    },
    [attachments],
  )

  // ---------------------------------------------------------------------------
  // Error / status derivations
  // ---------------------------------------------------------------------------
  const scriptPreviewAudioErrorMessage = useMemo(() => {
    if (!isScriptPreviewAudioSource) {
      return null
    }
    if (isStoryModeAudioUploadError) {
      return 'Audio upload failed. Please re-upload the file.'
    }
    if (isStoryModeAudioTranscriptError) {
      const transcriptError = storyModeAudioTranscriptError.trim()
      return transcriptError || STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE
    }
    return null
  }, [
    isScriptPreviewAudioSource,
    isStoryModeAudioTranscriptError,
    isStoryModeAudioUploadError,
    storyModeAudioTranscriptError,
  ])

  const scriptPreviewDisplayErrorMessage = useMemo(
    () => scriptPreviewAudioErrorMessage || scriptPreviewErrorMessage,
    [scriptPreviewAudioErrorMessage, scriptPreviewErrorMessage],
  )
  const scriptPreviewHasError =
    scriptPreviewStatus === 'error' ||
    (isScriptPreviewAudioSource && (isStoryModeAudioUploadError || isStoryModeAudioTranscriptError))

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Route prefetch effect
  useEffect(() => {
    if (!scriptPreviewOpen) {
      return
    }
    const prefetchRoute =
      longTakeEnabled || isStoryModeRoute ? '/story-mode/placeholder' : '/projects/placeholder'
    if (prefetchedScriptPreviewRoutesRef.current.has(prefetchRoute)) {
      return
    }
    prefetchedScriptPreviewRoutesRef.current.add(prefetchRoute)
    void router.prefetch(prefetchRoute)
  }, [isStoryModeRoute, longTakeEnabled, router, scriptPreviewOpen])

  // Audio sync effect
  useEffect(() => {
    if (!scriptPreviewOpen || !isScriptPreviewAudioSource) {
      return
    }
    if (scriptPreviewAudioErrorMessage) {
      setScriptPreviewErrorMessage(scriptPreviewAudioErrorMessage)
      setScriptPreviewStatus('error')
      return
    }
    if (!isStoryModeAudioReady || !isStoryModeAudioTranscriptReady) {
      setScriptPreviewErrorMessage(null)
      setScriptPreviewStatus('pending')
      return
    }
    setScriptPreviewText(storyModeAudioTranscriptText)
    setScriptPreviewErrorMessage(null)
    setScriptPreviewStatus('ready')
  }, [
    isScriptPreviewAudioSource,
    isStoryModeAudioReady,
    isStoryModeAudioTranscriptReady,
    scriptPreviewAudioErrorMessage,
    scriptPreviewOpen,
    storyModeAudioTranscriptText,
  ])

  // Retry handler
  const handleRetryScriptPreview = useRefCallback(() => {
    if (isScriptPreviewAudioSource) {
      if (!scriptPreviewAudioAttachmentId) {
        toast.warning('Audio file is still syncing. Please wait and try again.')
        return
      }
      const audioDuration = Number.isFinite(storyModeAudioDurationSeconds)
        ? (storyModeAudioDurationSeconds ?? undefined)
        : undefined
      if (isStoryModeAudioUploadError) {
        if (scriptPreviewAudioAttachment?.file) {
          void uploadStoryModeAudioToTemp(
            scriptPreviewAudioAttachment.file,
            scriptPreviewAudioAttachment.id,
            audioDuration,
          )
          return
        }
        toast.warning('Audio upload failed. Please re-upload the file.')
        return
      }
      if (isStoryModeAudioTranscriptError) {
        const audioUri = scriptPreviewAudioAttachment?.url?.trim()
        if (audioUri) {
          startStoryModeAudioTranscriptPreview({
            attachmentId: scriptPreviewAudioAttachmentId,
            audioDuration,
            audioUri,
          })
          return
        }
        toast.warning('Audio file is still syncing. Please wait and try again.')
      }
      return
    }
    const userPrompt = scriptPreviewUserPromptRef.current?.trim()
    if (!userPrompt) {
      toast.warning('Please enter your prompt')
      return
    }
    void startScriptPreview(userPrompt)
  })

  const getScriptPreviewSubmissionContext = useCallback(() => {
    if (isScriptPreviewSubmitting || scriptPreviewStatus !== 'ready') {
      return null
    }

    const script = scriptPreviewText.trim()
    if (!script) {
      return null
    }

    const userPrompt = scriptPreviewUserPromptRef.current?.trim() || script
    const resolvedAudioAttachment =
      scriptPreviewSource === 'audio_transcript'
        ? attachments.find(
            (att) => att.id === scriptPreviewAudioAttachmentId && isStoryModeAudioAttachment(att),
          ) || getLongTakeAudioAttachment(userPrompt)
        : undefined
    const hasAudioAttachment = Boolean(resolvedAudioAttachment)

    if (!hasAudioAttachment) {
      const scriptWordCount2 = countWords(script)
      if (scriptWordCount2 > storyModeUserLimits.absoluteMaxScriptWords) {
        toast.warning(
          `Script is too long. Please keep it under ${storyModeUserLimits.absoluteMaxScriptWords} words.`,
        )
        return null
      }
    }

    return { hasAudioAttachment, resolvedAudioAttachment, script, userPrompt }
  }, [
    attachments,
    getLongTakeAudioAttachment,
    isScriptPreviewSubmitting,
    scriptPreviewAudioAttachmentId,
    scriptPreviewSource,
    scriptPreviewStatus,
    scriptPreviewText,
  ])

  // ---------------------------------------------------------------------------
  // Confirm handler
  // ---------------------------------------------------------------------------
  const handleConfirmScriptPreview = useRefCallback(async () => {
    const submissionContext = getScriptPreviewSubmissionContext()
    if (!submissionContext) {
      return
    }
    const { hasAudioAttachment, resolvedAudioAttachment, script, userPrompt } = submissionContext

    setIsScriptPreviewSubmitting(true)
    state.set(getIsSendingAtom, true)
    try {
      const styleOptions = buildStoryModeStartStyleOptions(hasAudioAttachment)
      const styleImageFile = longTakeStyleInputMode === 'image' ? longTakeStyleImageFile : null
      const referencedImages = resolveStoryModeReferencedImagesOrNotify(userPrompt)
      if (!referencedImages) {
        return
      }
      let redirected = false
      const redirect = (pid: string) => {
        if (redirected) {
          return
        }
        redirected = true
        router.push(`/story-mode/${pid}?firstView=1`)
      }
      const { audioUri, projectId: pid } = await ensureStoryModeProject({
        audioAttachment: resolvedAudioAttachment,
        normalizedScript: script,
        referencedImages,
        styleImageFile,
        transcriptProjectText: userPrompt,
        userPrompt,
      })

      await ensureStoryModeAttachments({
        projectId: pid,
        referencedImages,
        styleImageFile,
        userPrompt,
      })
      const targetDurationSeconds = state.get(getLongTakeTargetDurationSecondsAtom)
      const result = await startLongTakeAsync({
        prompt: script,
        script,
        userPrompt,
        ratio: selectedRatio,
        // Resolution, plus the clip model when the provider offers a choice (Gemini).
        ...videoGenerationParams(modelRegistry, videoModelChoice, videoQuality),
        cameraStyle: sanitizeCameraStyle(cameraStyle),
        // The Music pill: off, the chosen track (by default the library's track for the camera
        // style), or a bed made from a typed wish.
        ...resolveMusicRequest(sanitizeMusicRequest(musicRequest), {
          cameraStyle: sanitizeCameraStyle(cameraStyle),
        }),
        customStyle: styleOptions.customStyle,
        isSavedStyle: styleOptions.isSavedStyle,
        ...(styleOptions.savedStyleId ? { savedStyleId: styleOptions.savedStyleId } : {}),
        ...(styleOptions.styleText ? { styleText: styleOptions.styleText } : {}),
        ...(styleOptions.styleName ? { styleName: styleOptions.styleName } : {}),
        ...(styleOptions.styleThumbnailUrl
          ? { styleThumbnailUrl: styleOptions.styleThumbnailUrl }
          : {}),
        ...(styleOptions.voiceId ? { voiceId: styleOptions.voiceId } : {}),
        ...(audioUri ? { audioUri } : {}),
        ...(pid ? { projectId: pid } : {}),
        ...buildTargetDurationRequestParams(targetDurationSeconds),
        ...(scriptPreviewGeneratorPath ? { scriptGeneratorPath: scriptPreviewGeneratorPath } : {}),
        ...(deps.remixProjectId ? { remixProjectId: deps.remixProjectId } : {}),
        ...(deps.isStyleCopy === undefined ? {} : { isStyleCopy: deps.isStyleCopy }),
        // Story Mode project type chosen at creation; persisted to
        // Project.createUseCase via the long-take create path.
        // Direct assign (undefined is dropped on serialize) avoids adding a
        // branch that would push this function over the complexity limit.
        createUseCase: deps.useCaseKey,
      })
      toast.success('Story Mode started')
      await autoSaveCurrentStoryStyle()
      resetScriptPreviewState()
      resetEditorState()
      redirect(result.projectId)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to start Story Mode'))
    } finally {
      setIsScriptPreviewSubmitting(false)
      state.set(getIsSendingAtom, false)
    }
  })

  return {
    closeScriptPreview,
    collectImageUris,
    handleConfirmScriptPreview,
    handleRetryScriptPreview,
    isScriptPreviewAudioSource,
    isScriptPreviewOverLimit,
    isScriptPreviewSubmitting,
    isScriptPreviewTranscriptPending,
    resetScriptPreviewState,
    scriptPreviewAnchorAssets,
    scriptPreviewAudioAttachment,
    scriptPreviewAudioAttachmentName,
    scriptPreviewAudioUploadStatus,
    scriptPreviewDisplayErrorMessage,
    scriptPreviewDurationSeconds,
    scriptPreviewHasError,
    scriptPreviewOpen,
    scriptPreviewSource,
    scriptPreviewStatus,
    scriptPreviewText,
    scriptPreviewUserPromptRef,
    scriptPreviewWordCount,
    setIsScriptPreviewSubmitting,
    setScriptPreviewOpen,
    setScriptPreviewText,
    startScriptPreview,
    startScriptPreviewFromAudio,
  }
}

function buildTargetDurationRequestParams(targetDurationSeconds: null | number): {
  targetDurationSeconds?: number
} {
  return typeof targetDurationSeconds === 'number' &&
    Number.isFinite(targetDurationSeconds) &&
    targetDurationSeconds > 0
    ? { targetDurationSeconds }
    : {}
}
