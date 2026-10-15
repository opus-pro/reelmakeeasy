import { Logger } from '@reelmakeeasy/common/utils/logger'
import type { LongTakeAudioScriptPreviewResponse } from '@shared/types/api/long-take'
import { Attachment } from '@shared/types/assets/attachment'
import { toast } from '@shared/ui'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'
import type { useApi } from '@/hooks/useApi'
import { useSignedUpload } from '@/hooks/useSignedUpload'
import { getErrorMessage } from '@/util/error-message'

import type { AsyncStatus } from './omni-chat-box.types'
import {
  STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE,
  STORY_MODE_AUDIO_TRANSCRIPT_TIMEOUT_ERROR_MESSAGE,
} from './omni-chat-box-helpers'
import { isStoreUri } from '@reelmakeeasy/common/storage/address'

const nsLogger = Logger.get('omni-chat-box')

// Any 5xx (gateway 504, Cloudflare 520-524), 408 / 425 / 429, and status 0
// (network or client-side timeout) mean the ASR is still running past the
// edge, not that the audio lacks a script.
const STORY_MODE_AUDIO_TRANSCRIPT_RETRYABLE_STATUSES = new Set([0, 408, 425, 429])

export interface AudioStateDeps {
  activeStoryModeAudioAttachment: Attachment | null
  fetchApiDomain: ReturnType<typeof useApi>['fetchApiDomain']
  hasStoryModeAudioAttachment: boolean
  longTakeEnabled: boolean
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  wordCount: number
}

export function useAudioState(deps: AudioStateDeps) {
  const {
    activeStoryModeAudioAttachment,
    fetchApiDomain,
    hasStoryModeAudioAttachment,
    longTakeEnabled,
    setAttachments,
    wordCount,
  } = deps

  const [storyModeAudioUploadId, setStoryModeAudioUploadId] = useState<null | string>(null)
  const [storyModeAudioUploadStatus, setStoryModeAudioUploadStatus] = useState<AsyncStatus>('idle')
  const [storyModeAudioTranscriptStatus, setStoryModeAudioTranscriptStatus] =
    useState<AsyncStatus>('idle')
  const [storyModeAudioTranscriptText, setStoryModeAudioTranscriptText] = useState('')
  const [storyModeAudioTranscriptError, setStoryModeAudioTranscriptError] = useState('')
  const [storyModeAudioDurationSeconds, setStoryModeAudioDurationSeconds] = useState<null | number>(
    null,
  )
  const storyModeAudioTranscriptRequestIdRef = useRef(0)
  const storyModeAudioTranscriptAttachmentIdRef = useRef<null | string>(null)
  const inFlightAudioUploadsRef = useRef<Map<string, Promise<string>>>(new Map())
  const autoStartedAudioIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!longTakeEnabled || !activeStoryModeAudioAttachment) {
      storyModeAudioTranscriptRequestIdRef.current += 1
      storyModeAudioTranscriptAttachmentIdRef.current = null
      autoStartedAudioIdsRef.current.clear()
      setStoryModeAudioTranscriptStatus('idle')
      setStoryModeAudioTranscriptText('')
      setStoryModeAudioTranscriptError('')
      setStoryModeAudioDurationSeconds(null)
      return
    }
    const activeAudioId = activeStoryModeAudioAttachment.id
    if (
      storyModeAudioTranscriptAttachmentIdRef.current &&
      storyModeAudioTranscriptAttachmentIdRef.current !== activeAudioId
    ) {
      storyModeAudioTranscriptRequestIdRef.current += 1
      storyModeAudioTranscriptAttachmentIdRef.current = null
      autoStartedAudioIdsRef.current.clear()
      setStoryModeAudioTranscriptStatus('idle')
      setStoryModeAudioTranscriptText('')
      setStoryModeAudioTranscriptError('')
      setStoryModeAudioDurationSeconds(null)
    }
  }, [activeStoryModeAudioAttachment, longTakeEnabled])

  const { uploadFile: uploadTempAudioFile, progress: tempAudioProgress } = useSignedUpload({
    module: 'media-temp',
    onError: (error) => {
      nsLogger.error('Temp audio upload error:', error)
    },
  })

  const activeStoryModeAudioId = activeStoryModeAudioAttachment?.id

  const storyModeAudioCounter = useMemo(() => {
    if (!hasStoryModeAudioAttachment) {
      return wordCount
    }
    if (!Number.isFinite(storyModeAudioDurationSeconds)) {
      return null
    }
    return Math.max(0, Math.round(storyModeAudioDurationSeconds || 0))
  }, [hasStoryModeAudioAttachment, storyModeAudioDurationSeconds, wordCount])

  const storyModeAudioStatusLine = useMemo(() => {
    if (!longTakeEnabled || !activeStoryModeAudioAttachment) {
      return null
    }
    if (storyModeAudioUploadId !== activeStoryModeAudioAttachment.id) {
      return null
    }
    if (storyModeAudioUploadStatus === 'pending') {
      const progress = Math.min(100, Math.max(0, Math.round(tempAudioProgress)))
      return React.createElement(
        'div',
        { className: 'flex items-center gap-2 text-xs text-secondary' },
        React.createElement('span', { className: 'animate-pulse' }, 'Uploading audio...'),
        React.createElement('span', null, `${progress}%`),
      )
    }
    if (storyModeAudioUploadStatus === 'error') {
      return React.createElement(
        'div',
        { className: 'text-xs text-secondary' },
        'Audio upload failed. Please remove and upload again.',
      )
    }
    return null
  }, [
    activeStoryModeAudioAttachment,
    longTakeEnabled,
    storyModeAudioUploadId,
    storyModeAudioUploadStatus,
    tempAudioProgress,
  ])

  const resetStoryModeAudioTranscriptState = useRefCallback(() => {
    storyModeAudioTranscriptRequestIdRef.current += 1
    storyModeAudioTranscriptAttachmentIdRef.current = null
    setStoryModeAudioTranscriptStatus('idle')
    setStoryModeAudioTranscriptText('')
    setStoryModeAudioTranscriptError('')
    setStoryModeAudioDurationSeconds(null)
  })

  const startStoryModeAudioTranscriptPreview = useRefCallback(
    async ({
      attachmentId,
      audioDuration,
      audioUri,
    }: {
      attachmentId: string
      audioDuration?: number
      audioUri: string
    }) => {
      const requestId = storyModeAudioTranscriptRequestIdRef.current + 1
      storyModeAudioTranscriptRequestIdRef.current = requestId
      storyModeAudioTranscriptAttachmentIdRef.current = attachmentId
      setStoryModeAudioTranscriptStatus('pending')
      setStoryModeAudioTranscriptText('')
      setStoryModeAudioTranscriptError('')
      setStoryModeAudioDurationSeconds(
        Number.isFinite(audioDuration) ? Math.max(0, Math.round(audioDuration || 0)) : null,
      )
      try {
        const response = await fetchApiDomain<LongTakeAudioScriptPreviewResponse>(
          '/api/long-take-videos/audio-script-preview',
          { method: 'POST', data: { audioUri } },
        )
        const isCurrentRequest =
          storyModeAudioTranscriptRequestIdRef.current === requestId &&
          storyModeAudioTranscriptAttachmentIdRef.current === attachmentId
        if (!isCurrentRequest) {
          return
        }
        if (!response.ok) {
          throw new Error(
            isStoryModeAudioTranscriptTimeout(response.status)
              ? STORY_MODE_AUDIO_TRANSCRIPT_TIMEOUT_ERROR_MESSAGE
              : response.error || STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE,
          )
        }
        const script = response.data.script?.trim() || ''
        if (!script) {
          throw new Error(STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE)
        }
        setStoryModeAudioTranscriptText(script)
        setStoryModeAudioTranscriptStatus('ready')
      } catch (error) {
        const isCurrentRequest =
          storyModeAudioTranscriptRequestIdRef.current === requestId &&
          storyModeAudioTranscriptAttachmentIdRef.current === attachmentId
        if (!isCurrentRequest) {
          return
        }
        const msg = getErrorMessage(error, STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE)
        setStoryModeAudioTranscriptError(msg)
        setStoryModeAudioTranscriptStatus('error')
      }
    },
  )

  const attachmentsSection = storyModeAudioStatusLine
    ? React.createElement('div', { className: 'px-3 pb-2' }, storyModeAudioStatusLine)
    : null

  const uploadStoryModeAudioToTemp = useRefCallback(
    async (file: File, attachmentId: string, audioDuration?: number) => {
      const existingUpload = inFlightAudioUploadsRef.current.get(attachmentId)
      if (existingUpload) {
        return existingUpload
      }

      const uploadPromise = (async () => {
        setStoryModeAudioUploadId(attachmentId)
        setStoryModeAudioUploadStatus('pending')
        try {
          const { fileUri } = await uploadTempAudioFile(file, { tempScope: 'story-mode-audio' })
          setStoryModeAudioUploadStatus('ready')
          setAttachments((prev) =>
            prev.map((att) =>
              att.id === attachmentId ? { ...att, file: undefined, url: fileUri } : att,
            ),
          )
          startStoryModeAudioTranscriptPreview({
            attachmentId,
            audioDuration,
            audioUri: fileUri,
          })
          return fileUri
        } catch (error) {
          const msg = getErrorMessage(error, 'Failed to upload audio file')
          resetStoryModeAudioTranscriptState()
          setStoryModeAudioUploadStatus('error')
          toast.error(msg)
          throw error
        }
      })().finally(() => {
        const current = inFlightAudioUploadsRef.current.get(attachmentId)
        if (current === uploadPromise) {
          inFlightAudioUploadsRef.current.delete(attachmentId)
        }
      })

      inFlightAudioUploadsRef.current.set(attachmentId, uploadPromise)
      return uploadPromise
    },
  )

  // Reconciles an attachment toward a transcript instead of only firing one as
  // an upload side effect. Covers reload/restored-draft (store:// url, never
  // uploaded again) and login (guest attaches audio, then authenticates).
  // Fires at most once per attachment id (autoStartedAudioIdsRef) so a
  // persistent upload failure -- which resets transcript status back to
  // 'idle' -- cannot retry-storm; the id is cleared when the active
  // attachment changes, in the reset effect above.
  useEffect(() => {
    if (!longTakeEnabled || !activeStoryModeAudioAttachment) {
      return
    }
    if (storyModeAudioTranscriptStatus !== 'idle') {
      return
    }
    const attachmentId = activeStoryModeAudioAttachment.id
    if (autoStartedAudioIdsRef.current.has(attachmentId)) {
      return
    }
    if (inFlightAudioUploadsRef.current.has(attachmentId)) {
      return
    }
    const url = activeStoryModeAudioAttachment.url?.trim()
    const audioDuration = activeStoryModeAudioAttachment.duration
    if (isStoreUri(url)) {
      autoStartedAudioIdsRef.current.add(attachmentId)
      startStoryModeAudioTranscriptPreview({ attachmentId, audioDuration, audioUri: url })
    } else if (activeStoryModeAudioAttachment.file) {
      autoStartedAudioIdsRef.current.add(attachmentId)
      // Failure is already reported via toast + state inside; this call
      // site does not await the result, so swallow the rejection here.
      uploadStoryModeAudioToTemp(
        activeStoryModeAudioAttachment.file,
        attachmentId,
        audioDuration,
      ).catch(() => undefined)
    }
  }, [activeStoryModeAudioAttachment, longTakeEnabled, storyModeAudioTranscriptStatus])

  const ensureStoryModeAudioUploaded = useRefCallback(async (attachment: Attachment | null) => {
    if (!attachment) {
      return undefined
    }
    const currentUrl = attachment.url?.trim()
    if (isStoreUri(currentUrl)) {
      return currentUrl
    }

    if (!attachment.id) {
      throw new Error('Audio file is still syncing. Please wait and try again.')
    }

    const inFlight = inFlightAudioUploadsRef.current.get(attachment.id)
    if (inFlight) {
      return await inFlight
    }

    if (!attachment.file) {
      throw new Error('Audio file is still syncing. Please wait and try again.')
    }

    return await uploadStoryModeAudioToTemp(attachment.file, attachment.id, attachment.duration)
  })

  return {
    activeStoryModeAudioId,
    attachmentsSection,
    resetStoryModeAudioTranscriptState,
    setStoryModeAudioTranscriptStatus,
    setStoryModeAudioTranscriptText,
    setStoryModeAudioUploadId,
    setStoryModeAudioUploadStatus,
    startStoryModeAudioTranscriptPreview,
    storyModeAudioCounter,
    storyModeAudioDurationSeconds,
    storyModeAudioStatusLine,
    storyModeAudioTranscriptError,
    storyModeAudioTranscriptStatus,
    storyModeAudioTranscriptText,
    storyModeAudioUploadId,
    storyModeAudioUploadStatus,
    ensureStoryModeAudioUploaded,
    uploadStoryModeAudioToTemp,
  }
}

function isStoryModeAudioTranscriptTimeout(status: number): boolean {
  return (
    STORY_MODE_AUDIO_TRANSCRIPT_RETRYABLE_STATUSES.has(status) || (status >= 500 && status < 600)
  )
}
