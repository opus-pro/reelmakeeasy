import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'

import { getMaxFileSizeForEditor } from '@/constants/file'
import { useProjectId } from '@/contexts/ProjectContext'
import { useMediaUpload } from '@/hooks/useMediaUpload'
import { encodeCdnUrlName } from '@/util/cdn-utils'
import { getVideoMetadata, validateVideoMetadata } from '@/util/media'
import { sanitizeUploadFileName } from '@/util/upload-filename'

export type GenerateParams = {
  duration?: number
  projectId: string
  prompt: string
  ratio?: AspectRatio
  referenceUrl?: string
}

export type GenerateResult = {
  cdnUrl: string
  fileUri: string
}

export type MediaType = 'image' | 'text' | 'video'

export type UploadResult = {
  cdnUrl: string
  previewCdnUrl?: string
  thumbnailCdnUrl?: string
}

export function useAssetUpload() {
  const { projectId } = useProjectId()
  const { uploadUserFile } = useMediaUpload()
  const uploadCacheRef = useRef<Map<string, UploadResult>>(new Map())

  const uploadMutation = useMutation<
    UploadResult,
    Error,
    { file: File; maxDuration?: number; mediaType: MediaType }
  >({
    mutationFn: async ({ file, maxDuration, mediaType }) => {
      if (!projectId) {
        throw new Error('Project ID is required')
      }

      const safeName = sanitizeUploadFileName(file.name)
      const safeFile =
        safeName === file.name
          ? file
          : new File([file], safeName, { type: file.type, lastModified: file.lastModified })

      const cached = uploadCacheRef.current.get(safeFile.name)
      if (cached) {
        return cached
      }

      const { maxSizeBytes, maxSizeMB } = getMaxFileSizeForEditor(safeFile)
      if (safeFile.size > maxSizeBytes) {
        throw new Error(`File size exceeds ${maxSizeMB}MB`)
      }

      if (mediaType === 'video') {
        const result = await getVideoMetadata(safeFile)
        validateVideoMetadata(result, safeFile, maxDuration)
      }

      const uploadResult = await uploadUserFile(safeFile, {
        projectId,
        uploadToCdn: true,
        generateVideoPreview: mediaType === 'video',
        thumbnailPreset: 'editor',
      })

      const result: UploadResult = {
        cdnUrl: encodeCdnUrlName(uploadResult.cdnUrl || ''),
        thumbnailCdnUrl: uploadResult.thumbnailCdnUrl
          ? encodeCdnUrlName(uploadResult.thumbnailCdnUrl)
          : undefined,
        previewCdnUrl: uploadResult.previewCdnUrl
          ? encodeCdnUrlName(uploadResult.previewCdnUrl)
          : undefined,
      }

      uploadCacheRef.current.set(safeFile.name, result)
      return result
    },
  })

  return {
    uploadMutation,
    isUploading: uploadMutation.isPending,
  }
}
