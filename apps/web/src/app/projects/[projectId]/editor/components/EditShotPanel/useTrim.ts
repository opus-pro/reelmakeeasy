import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { Shot } from '@shared/types/api'
import { toast } from '@shared/ui'
import { useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'
import { formatVideoMetadataError, getVideoMetadata } from '@/util/media'

import { trimVideoFile } from '../../utils/trim-video'

type UploadMutation = {
  mutateAsync: (params: {
    file: File
    maxDuration?: number
    mediaType: 'image' | 'text' | 'video'
  }) => Promise<{ cdnUrl: string; previewCdnUrl?: string; thumbnailCdnUrl?: string }>
}

type UseTrimOptions = {
  currentShot: null | Shot
  onUploadSuccess: (result: {
    cdnUrl: string
    previewCdnUrl?: string
    thumbnailCdnUrl?: string
  }) => Promise<void>
  projectId?: string
  shotDuration?: number
  uploadMutation: UploadMutation
}

export function useTrim({
  currentShot,
  onUploadSuccess,
  projectId,
  shotDuration,
  uploadMutation,
}: UseTrimOptions) {
  const [trimDialogOpen, setTrimDialogOpen] = useState(false)
  const [pendingVideoFile, setPendingVideoFile] = useState<File | null>(null)
  const [videoDurationSec, setVideoDurationSec] = useState(0)
  const [isTrimProcessing, setIsTrimProcessing] = useState(false)

  const resetTrimState = useRefCallback(() => {
    setPendingVideoFile(null)
    setTrimDialogOpen(false)
    setVideoDurationSec(0)
  })

  const openTrimForFile = useRefCallback(async (file: File): Promise<boolean> => {
    if (!projectId || !currentShot || isTrimProcessing) {
      return false
    }

    const metadataResult = await getVideoMetadata(file)
    if (metadataResult.error || !metadataResult.metadata) {
      const message = metadataResult.error
        ? formatVideoMetadataError(metadataResult.error, file)
        : 'Failed to load video metadata.'
      toast.warning(message)
      return false
    }

    setVideoDurationSec(metadataResult.metadata.duration)
    setPendingVideoFile(file)
    setTrimDialogOpen(true)
    return true
  })

  const handleTrimCancel = useRefCallback(() => {
    if (isTrimProcessing) {
      return
    }
    resetTrimState()
  })

  const handleTrimConfirm = useRefCallback(
    async ({ endSec, startSec }: { endSec: number; startSec: number }) => {
      if (!projectId || !currentShot || !pendingVideoFile || isTrimProcessing) {
        return
      }

      setIsTrimProcessing(true)

      try {
        const trimmedBlob = await trimVideoFile(pendingVideoFile, startSec, endSec)
        const baseName = pendingVideoFile.name.replace(/\.[^/.]+$/, '')
        const type = trimmedBlob.type || 'video/webm'
        const extension = type.includes('mp4') ? 'mp4' : 'webm'
        const trimmedFile = new File(
          [trimmedBlob],
          `${baseName}-trim-${startSec.toFixed(2)}_${endSec.toFixed(2)}.${extension}`,
          {
            type,
          },
        )

        const result = await uploadMutation.mutateAsync({
          file: trimmedFile,
          mediaType: 'video',
          maxDuration: shotDuration,
        })

        await onUploadSuccess(result)
        resetTrimState()
        toast.success('Shot updated successfully')
      } catch (error) {
        const err = ensureError(error)
        toast.warning(err.message || 'Failed to trim video')
      } finally {
        setIsTrimProcessing(false)
      }
    },
  )

  return {
    // State
    isTrimProcessing,
    pendingVideoFile,
    trimDialogOpen,
    videoDurationSec,
    // Actions
    handleTrimCancel,
    handleTrimConfirm,
    openTrimForFile,
  }
}
