import { Logger } from '@reelmakeeasy/common/utils/logger'
import { toast } from '@shared/ui'
import { useCallback, useRef, useState } from 'react'

import { useSignedUpload } from '@/hooks/useSignedUpload'

import { normalizeStoryModeImageFile } from '../omni-chat-box-shared/anchor-asset-formats'

import type { AnchorAssetCategory } from './anchor-assets/anchor-assets.types'

const nsLogger = Logger.get('omni-chat-box')

// Map<attachmentId, fileUri>. Module-scoped so the post-login upload state
// survives OmniChatBox remount on workflow switch; attachment ids stay stable
// across remounts via IDB-backed draft persistence.
const imageUrisSharedMap = new Map<string, string>()

export function useImageUpload() {
  const { uploadFile: uploadImageFile } = useSignedUpload({
    module: 'media-temp',
    onError: (error) => {
      nsLogger.error('Image upload error:', error)
    },
  })
  const imageUrisRef = useRef<Map<string, string>>(imageUrisSharedMap)
  const [imageUploadingCount, setImageUploadingCount] = useState(0)
  // Attachment ids whose LAST upload attempt failed. A failed upload deletes
  // its fileUri entry but leaves the @img mention in the composer text, so
  // without this signal submit re-enables and the project ships a dangling
  // reference the backend silently drops -- the agent then claims it used an
  // image it never saw. Send-state gates on it the same way the
  // audio uploader's error status gates submit. Deliberately React state (not
  // module-scoped like the map): a remount auto-retries failed attachments,
  // so the failure marker should reset with the retry.
  const [failedImageAttachmentIds, setFailedImageAttachmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const uploadImageAttachment = useCallback(
    async (file: File, attachmentId: string, imageCategory?: AnchorAssetCategory) => {
      if (imageUrisRef.current.has(attachmentId)) {
        return
      }
      // Optimistically mark as in-flight before the first await to prevent concurrent
      // calls from both passing the guard above and uploading the same file twice.
      imageUrisRef.current.set(attachmentId, '')
      setFailedImageAttachmentIds((prev) => {
        if (!prev.has(attachmentId)) {
          return prev
        }
        const next = new Set(prev)
        next.delete(attachmentId)
        return next
      })
      setImageUploadingCount((c) => c + 1)
      try {
        const uploadFile = normalizeStoryModeImageFile(file)
        const { fileUri } = await uploadImageFile(uploadFile, { tempScope: 'story-mode-images' })
        imageUrisRef.current.set(attachmentId, fileUri)
      } catch (err) {
        imageUrisRef.current.delete(attachmentId)
        setFailedImageAttachmentIds((prev) => new Set(prev).add(attachmentId))
        nsLogger.error('Failed to upload image:', err)
        toast.error('Image upload failed. Please re-attach the image.')
      } finally {
        setImageUploadingCount((c) => c - 1)
      }
    },
    [uploadImageFile],
  )

  return { failedImageAttachmentIds, imageUrisRef, imageUploadingCount, uploadImageAttachment }
}
