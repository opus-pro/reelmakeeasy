import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { toast } from '@shared/ui'
import React, { useCallback, useRef } from 'react'

import { useApi } from '@/hooks/useApi'
import { useGenerateStylePreview } from '@/hooks/useUserSavedStyles'
import { isApiError } from '@/lib/api-error'
import { getErrorMessage } from '@/util/error-message'

import { readFileAsDataUrl } from './omni-chat-box-helpers'
import {
  canSendUncompressedStoryModeStyleImage,
  CLOUDFLARE_SAFE_BLOB_BYTES,
  compressImageForApiRequest,
  isSupportedStoryModeStyleImage,
  STORY_MODE_STYLE_IMAGE_ERROR_MESSAGE,
  type StoryModeImageCompressionFailureReason,
} from './story-mode-style-image'

export interface StyleImageDeps {
  clearStyleImage: () => void
  generateStylePreviewMutation: ReturnType<typeof useGenerateStylePreview>
  setIsLongTakeStyleImageProcessing: (v: boolean) => void
  setLongTakeCustomStyle: (v: string) => void
  setLongTakeStyleImageError: (v: null | string) => void
  setLongTakeStyleImageFile: (v: File | null) => void
  setLongTakeStyleImagePreviewUrl: (v: null | string) => void
  setLongTakeStyleInputMode: (v: 'image' | 'none' | 'text') => void
  setLongTakeStyleName: (v: string) => void
  setPromptDirtySincePreview: (v: boolean) => void
  setStylePreviewImageUrl: (v: null | string) => void
  stylePreviewBaseImageUrl: string
  stylePreviewGenCounterRef: React.MutableRefObject<number>
}

export function useStyleImageProcessing(deps: StyleImageDeps) {
  const {
    clearStyleImage,
    generateStylePreviewMutation,
    setIsLongTakeStyleImageProcessing,
    setLongTakeCustomStyle,
    setLongTakeStyleImageError,
    setLongTakeStyleImageFile,
    setLongTakeStyleImagePreviewUrl,
    setLongTakeStyleInputMode,
    setLongTakeStyleName,
    setPromptDirtySincePreview,
    setStylePreviewImageUrl,
    stylePreviewBaseImageUrl,
    stylePreviewGenCounterRef,
  } = deps

  const { fetchApiDomain } = useApi()
  const styleImageSelectCounterRef = useRef(0)

  const runStyleImageCompression = useCallback(
    async (
      file: File,
    ): Promise<
      | {
          blob: Blob
          compressedSize: number
          compressionFallback: 'unsupported' | null
          compressionRan: boolean
        }
      | { failed: true; reason: StoryModeImageCompressionFailureReason }
    > => {
      if (file.size <= CLOUDFLARE_SAFE_BLOB_BYTES) {
        return {
          blob: file,
          compressionFallback: null,
          compressionRan: false,
          compressedSize: file.size,
        }
      }
      const result = await compressImageForApiRequest(file)
      if (result.ok) {
        return {
          blob: result.blob,
          compressionFallback: null,
          compressionRan: true,
          compressedSize: result.blob.size,
        }
      }
      if (result.reason === 'unsupported' && canSendUncompressedStoryModeStyleImage(file.size)) {
        return {
          blob: file,
          compressionFallback: 'unsupported',
          compressionRan: true,
          compressedSize: file.size,
        }
      }
      return { failed: true, reason: result.reason }
    },
    [canSendUncompressedStoryModeStyleImage],
  )

  const handleLongTakeStyleImageSelect = useCallback(
    async (file: File) => {
      if (!isSupportedStoryModeStyleImage(file)) {
        toast.warning('Only PNG, JPG, or WebP images are supported for style')
        return
      }

      styleImageSelectCounterRef.current += 1
      const selectId = styleImageSelectCounterRef.current
      clearStyleImage()
      setLongTakeCustomStyle('')
      setLongTakeStyleInputMode('image')
      setLongTakeStyleImageError(null)

      const previewUrl = URL.createObjectURL(file)
      setLongTakeStyleImageFile(file)
      setLongTakeStyleImagePreviewUrl(previewUrl)
      setIsLongTakeStyleImageProcessing(true)

      try {
        const compression = await runStyleImageCompression(file)
        if ('failed' in compression && compression.failed) {
          setLongTakeStyleImageError(STORY_MODE_STYLE_IMAGE_ERROR_MESSAGE)
          return
        }

        type Success = {
          blob: Blob
          compressedSize: number
          compressionFallback: 'unsupported' | null
          compressionRan: boolean
        }
        const success = compression as Success
        const imageDataUrl = await readFileAsDataUrl(success.blob)
        const response = await fetchApiDomain<{ styleName: string; styleText: string }>(
          '/api/media/generate-style-text',
          {
            data: { imageDataUrl },
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          },
        )
        if (!response.ok) {
          throw new Error(response.error || 'Failed to generate style text')
        }
        if (selectId !== styleImageSelectCounterRef.current) {
          return
        }
        const styleText = response.data?.styleText?.trim() || ''
        if (!styleText) {
          throw new Error('Generated style text is empty')
        }
        const styleName = response.data?.styleName?.trim() ?? ''
        // Generate preview first, then set name + prompt + preview together
        stylePreviewGenCounterRef.current += 1
        const previewGenId = stylePreviewGenCounterRef.current
        try {
          const previewResult = await generateStylePreviewMutation.mutateAsync({
            baseImageUrl: stylePreviewBaseImageUrl,
            styleText,
          })
          if (
            selectId !== styleImageSelectCounterRef.current ||
            previewGenId !== stylePreviewGenCounterRef.current
          ) {
            return
          }
          const previewDataUrl = `data:image/png;base64,${previewResult.previewImageBase64}`
          setLongTakeStyleName(styleName)
          setLongTakeCustomStyle(styleText)
          setStylePreviewImageUrl(previewDataUrl)
          setPromptDirtySincePreview(false)
        } catch {
          if (
            selectId !== styleImageSelectCounterRef.current ||
            previewGenId !== stylePreviewGenCounterRef.current
          ) {
            return
          }
          setLongTakeStyleName(styleName)
          setLongTakeCustomStyle(styleText)
          setStylePreviewImageUrl(null)
          setPromptDirtySincePreview(true)
        }
      } catch (err) {
        if (selectId !== styleImageSelectCounterRef.current) {
          return
        }
        const error = ensureError(err)
        if (isApiError(error) && error.status === 413) {
          setLongTakeStyleImageError(STORY_MODE_STYLE_IMAGE_ERROR_MESSAGE)
          return
        }
        const errorMessage = getErrorMessage(error, 'Failed to generate style text')
        setLongTakeStyleImageError(errorMessage)
        toast.error(errorMessage)
      } finally {
        if (selectId === styleImageSelectCounterRef.current) {
          setIsLongTakeStyleImageProcessing(false)
        }
      }
    },
    [
      clearStyleImage,
      fetchApiDomain,
      generateStylePreviewMutation,
      runStyleImageCompression,
      setLongTakeCustomStyle,
      setLongTakeStyleImageError,
      setLongTakeStyleImageFile,
      setLongTakeStyleImagePreviewUrl,
      setLongTakeStyleInputMode,
      setLongTakeStyleName,
      setPromptDirtySincePreview,
      setStylePreviewImageUrl,
      stylePreviewBaseImageUrl,
      stylePreviewGenCounterRef,
    ],
  )

  return {
    handleLongTakeStyleImageSelect,
    styleImageSelectCounterRef,
  }
}
