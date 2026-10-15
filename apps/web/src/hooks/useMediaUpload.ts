import { useCallback } from 'react'

import { useApi } from './useApi'
import { useSignedUpload } from './useSignedUpload'

export interface BackgroundUploadOptions {
  projectId: string
}

export interface MediaUploadOptions {
  generateVideoPreview?: boolean
  projectId: string
  thumbnailPreset?: 'editor' | 'preview'
  uploadToCdn?: boolean
}

export interface MediaUploadResult {
  cdnUrl?: string
  fileName: string
  id?: string
  path: string
  previewCdnUrl?: string
  success: boolean
  thumbnailCdnUrl?: string
}

export interface OverrideUploadOptions {
  path: string
  projectId: string
}

/**
 * Hook for Media module file uploads using Signed URLs
 *
 * This hook provides specialized upload functions for different media upload scenarios:
 * - User uploaded files (for editor/chat)
 * - Background images
 * - Override files
 *
 * @example
 * ```tsx
 * const { uploadUserFile, uploadBackground, isUploading, progress, error } = useMediaUpload()
 *
 * // Upload user file
 * const result = await uploadUserFile(file, {
 *   projectId: 'project-123',
 *   generateVideoPreview: true,
 *   uploadToCdn: true
 * })
 * ```
 */
export function useMediaUpload() {
  const { fetchApiDomain } = useApi()
  const { uploadFile, isUploading, progress, error } = useSignedUpload({
    module: 'media',
  })

  /**
   * Upload user file (for editor/chat attachments)
   */
  const uploadUserFile = useCallback(
    async (file: File, options: MediaUploadOptions): Promise<MediaUploadResult> => {
      const {
        projectId,
        generateVideoPreview = false,
        uploadToCdn = false,
        thumbnailPreset,
      } = options

      // Step 1 & 2: Upload to storage using signed URL
      const { fileUri } = await uploadFile(file, {
        projectId,
        mediaPurpose: 'user_uploaded',
      })

      // Step 3: Call business API with store path
      const response = await fetchApiDomain<MediaUploadResult>(`/api/media/upload/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: {
          fileUri: fileUri,
          fileContentType: file.type,
          fileName: file.name,
          generateVideoPreview,
          ...(thumbnailPreset ? { thumbnailPreset } : {}),
          uploadToCdn,
        },
      })

      if (!response.ok) {
        throw new Error(response.error || 'Upload failed')
      }

      return response.data
    },
    [uploadFile, fetchApiDomain],
  )

  /**
   * Upload background image
   */
  const uploadBackground = useCallback(
    async (file: File, options: BackgroundUploadOptions): Promise<MediaUploadResult> => {
      const { projectId } = options

      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Only image files are allowed for background')
      }

      // Step 1 & 2: Upload to storage using signed URL
      const { fileUri } = await uploadFile(file, {
        projectId,
        mediaPurpose: 'background',
      })

      // Step 3: Call business API with store path
      const response = await fetchApiDomain<MediaUploadResult>(
        `/api/media/upload-background/${projectId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: {
            fileUri: fileUri,
            fileContentType: file.type,
          },
        },
      )

      if (!response.ok) {
        throw new Error(response.error || 'Background upload failed')
      }

      return response.data
    },
    [uploadFile, fetchApiDomain],
  )

  /**
   * Upload override file (style file)
   */
  const uploadOverride = useCallback(
    async (file: File, options: OverrideUploadOptions): Promise<MediaUploadResult> => {
      const { projectId, path: targetPath } = options

      // Validate path
      if (targetPath !== 'storyboard') {
        throw new Error('Invalid path for override upload')
      }

      // Step 1 & 2: Upload to storage using signed URL
      const { fileUri } = await uploadFile(file, {
        projectId,
        mediaPurpose: 'override',
      })

      // Step 3: Call business API with store path
      const response = await fetchApiDomain<MediaUploadResult>(
        `/api/media/upload-override/${projectId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: {
            fileUri: fileUri,
            fileContentType: file.type,
            path: targetPath,
          },
        },
      )

      if (!response.ok) {
        throw new Error(response.error || 'Override upload failed')
      }

      return response.data
    },
    [uploadFile, fetchApiDomain],
  )

  return {
    uploadUserFile,
    uploadBackground,
    uploadOverride,
    isUploading,
    progress,
    error,
  }
}
