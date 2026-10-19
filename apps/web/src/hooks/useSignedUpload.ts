import { useCallback, useState } from 'react'

import { useApi } from './useApi'

export interface SignedUploadOptions {
  module: 'media' | 'media-temp' | 'playground-pmg' | 'styles' | 'templates'
  onError?: (error: Error) => void
  onProgress?: (progress: number) => void
  onSuccess?: (fileUri: string) => void
}

export interface SignedUploadResult {
  fileUri: string
  index?: number
}

export interface SignedUrlResponse {
  expiresAt: string
  fileUri: string
  index?: number
  signedUrl: string
}

interface MultipleFileUploadParams {
  fileTypes?: Array<'background' | 'font' | 'reference'>
  projectId?: string
  styleId?: string
}

interface SingleFileUploadParams {
  fileType?: 'background' | 'font' | 'reference'
  mediaPurpose?: 'background' | 'override' | 'user_uploaded'
  projectId?: string
  purpose?: 'codegen'
  styleId?: string
  tempScope?:
    | 'inpaint-references'
    | 'music-track'
    | 'ranking'
    | 'story-mode-audio'
    | 'story-mode-images'
    | 'style-video'
    | 'video-to-prompt'
}

/**
 * Hook for uploading files using storage Signed URLs
 *
 * This hook provides a unified interface for uploading files across different modules.
 * It handles the 3-step upload flow:
 * 1. Get signed URL from backend
 * 2. Upload file directly to storage
 * 3. Return store path for business logic
 *
 * @example
 * ```tsx
 * const { uploadFile, uploadFiles, isUploading, error, progress } = useSignedUpload({
 *   module: 'templates',
 *   onSuccess: (fileUri) => console.log('Uploaded:', fileUri),
 *   onError: (error) => console.error('Error:', error)
 * })
 *
 * // Single file upload
 * const result = await uploadFile(file, { purpose: 'codegen' })
 *
 * // Multiple files upload
 * const results = await uploadFiles(files)
 * ```
 */
export function useSignedUpload(options: SignedUploadOptions) {
  const { module, onProgress, onSuccess, onError } = options
  const { fetchApiDomain } = useApi()

  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  /**
   * Upload a single file using signed URL
   */
  const uploadFile = useCallback(
    async (file: File, params?: SingleFileUploadParams): Promise<SignedUploadResult> => {
      setIsUploading(true)
      setProgress(0)
      setError(null)

      try {
        // Step 1: Get signed URL from backend
        onProgress?.(10)
        setProgress(10)

        const signedUrlEndpoint = getSignedUrlEndpoint(module, params)
        const signedUrlBody = getSignedUrlBody(module, file, params)

        const signedUrlResponse = await fetchApiDomain<SignedUrlResponse>(signedUrlEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: signedUrlBody,
        })

        if (!signedUrlResponse.ok) {
          throw new Error(signedUrlResponse.error || 'Failed to get signed URL')
        }

        const { signedUrl, fileUri } = signedUrlResponse.data

        // Step 2: Upload file directly to storage
        onProgress?.(30)
        setProgress(30)

        const uploadResponse = await fetch(signedUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': resolveUploadContentType(file),
          },
        })

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload file to storage: ${uploadResponse.statusText}`)
        }

        // Step 3: Success
        onProgress?.(100)
        setProgress(100)
        onSuccess?.(fileUri)

        return { fileUri }
      } catch (err) {
        const uploadError = err instanceof Error ? err : new Error('Upload failed')
        setError(uploadError)
        onError?.(uploadError)
        throw uploadError
      } finally {
        setIsUploading(false)
      }
    },
    [module, fetchApiDomain, onProgress, onSuccess, onError],
  )

  /**
   * Upload multiple files using signed URLs
   */
  const uploadFiles = useCallback(
    async (
      files: File[],
      params?: {
        fileTypes?: Array<'background' | 'font' | 'reference'>

        // Avatars module - no extra params needed

        // Common
        projectId?: string
        // Styles module
        styleId?: string
      },
    ): Promise<SignedUploadResult[]> => {
      setIsUploading(true)
      setProgress(0)
      setError(null)

      try {
        // Step 1: Get signed URLs for all files
        onProgress?.(10)
        setProgress(10)

        const signedUrlEndpoint = getSignedUrlEndpoint(module, params)
        const signedUrlBody = getMultipleSignedUrlBody(module, files, params)

        const signedUrlResponse = await fetchApiDomain<{ uploads: SignedUrlResponse[] }>(
          signedUrlEndpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            data: signedUrlBody,
          },
        )

        if (!signedUrlResponse.ok) {
          throw new Error(signedUrlResponse.error || 'Failed to get signed URLs')
        }

        const { uploads } = signedUrlResponse.data

        // Step 2: Upload all files to storage in parallel
        onProgress?.(30)
        setProgress(30)

        const uploadPromises = uploads.map(async (upload, index) => {
          const file = files[upload.index ?? index]

          const uploadResponse = await fetch(upload.signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
              'Content-Type': resolveUploadContentType(file),
            },
          })

          if (!uploadResponse.ok) {
            throw new Error(
              `Failed to upload ${file.name} to storage: ${uploadResponse.statusText}`,
            )
          }

          return {
            fileUri: upload.fileUri,
            index: upload.index ?? index,
          }
        })

        const results = await Promise.all(uploadPromises)

        // Step 3: Success
        onProgress?.(100)
        setProgress(100)

        // Call onSuccess for each file
        results.forEach((result) => onSuccess?.(result.fileUri))

        return results
      } catch (err) {
        const uploadError = err instanceof Error ? err : new Error('Upload failed')
        setError(uploadError)
        onError?.(uploadError)
        throw uploadError
      } finally {
        setIsUploading(false)
      }
    },
    [module, fetchApiDomain, onProgress, onSuccess, onError],
  )

  return {
    uploadFile,
    uploadFiles,
    isUploading,
    progress,
    error,
  }
}

/**
 * Helper function to get the correct signed URL endpoint
 */
function getSignedUrlEndpoint(
  module: SignedUploadOptions['module'],
  params?: MultipleFileUploadParams | SingleFileUploadParams,
): string {
  switch (module) {
    case 'media': {
      return `/api/media/generate-upload-url/${params?.projectId}`
    }
    case 'media-temp': {
      return '/api/media/generate-temp-upload-url'
    }
    case 'playground-pmg': {
      return '/api/playground/poster-motion-graph/generate-upload-urls'
    }
    case 'styles': {
      return '/api/styles/generate-upload-url'
    }
    case 'templates': {
      return '/api/templates/generate-upload-url'
    }
    default: {
      throw new Error(`Unknown module: ${module}`)
    }
  }
}

// A browser reports an empty `File.type` for files it can't map to a MIME type (an unusual or
// missing extension, or formats like some .m4a / .opus). The signed-URL backend rejects an empty
// contentType with a 400 ("Missing file name or content type"), which the UI surfaces as
// "Audio upload failed. Please remove and upload again." -- and retrying the same file never helps.
// Fall back to a generic type so the signed-URL request succeeds; using this for BOTH the request
// body and the PUT header keeps the signed contentType and the uploaded Content-Type in sync.
// Mirrors the existing story-mode audio upload path in planner-api-factory.ts.
function resolveUploadContentType(file: File): string {
  return file.type || 'application/octet-stream'
}

/**
 * Helper function to construct signed URL request body for single file
 */
function getSignedUrlBody(
  module: SignedUploadOptions['module'],
  file: File,
  params?: SingleFileUploadParams,
): Record<string, unknown> {
  switch (module) {
    case 'media': {
      return {
        fileName: file.name,
        contentType: resolveUploadContentType(file),
        purpose: params?.mediaPurpose || 'user_uploaded',
      }
    }
    case 'media-temp': {
      return {
        fileName: file.name,
        contentType: resolveUploadContentType(file),
        scope: params?.tempScope || 'story-mode-audio',
      }
    }
    case 'templates': {
      return {
        fileName: file.name,
        contentType: resolveUploadContentType(file),
        purpose: params?.purpose || 'codegen',
      }
    }
    default: {
      throw new Error(`Single file upload not supported for module: ${module}`)
    }
  }
}

/**
 * Helper function to construct signed URL request body for multiple files
 */
function getMultipleSignedUrlBody(
  module: SignedUploadOptions['module'],
  files: File[],
  params?: MultipleFileUploadParams,
): Record<string, unknown> {
  switch (module) {
    case 'playground-pmg': {
      return {
        files: files.map((file, index) => ({
          fileName: file.name,
          contentType: resolveUploadContentType(file),
          index,
        })),
      }
    }
    case 'styles': {
      return {
        files: files.map((file, index) => ({
          fileName: file.name,
          contentType: resolveUploadContentType(file),
          fileType: params?.fileTypes?.[index] || 'reference',
        })),
        styleId: params?.styleId,
      }
    }
    default: {
      throw new Error(`Multiple file upload not supported for module: ${module}`)
    }
  }
}
