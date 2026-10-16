import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { toast } from '@shared/ui'
import { useCallback, useRef } from 'react'

import type { useApi } from '@/hooks/useApi'
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

/** The AI's name and description for a style image (the vision call behind "Write with AI"). */
export interface StyleImageDeps {
  clearStyleImage: () => void
  setIsLongTakeStyleImageProcessing: (v: boolean) => void
  setLongTakeCustomStyle: (v: string) => void
  setLongTakeStyleImageDataUrl: (v: null | string) => void
  setLongTakeStyleImageError: (v: null | string) => void
  setLongTakeStyleImageFile: (v: File | null) => void
  setLongTakeStyleImagePreviewUrl: (v: null | string) => void
  setLongTakeStyleInputMode: (v: 'image' | 'none' | 'text') => void
  setPromptDirtySincePreview: (v: boolean) => void
  setStylePreviewImageUrl: (v: null | string) => void
}

export type StyleTextFromImage = { styleName: string; styleText: string }

export async function requestStyleTextFromImage(
  fetchApiDomain: ReturnType<typeof useApi>['fetchApiDomain'],
  imageDataUrl: string,
): Promise<StyleTextFromImage> {
  const response = await fetchApiDomain<{ styleName: string; styleText: string }>(
    '/api/media/generate-style-text',
    {
      data: { imageDataUrl },
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  if (!response.ok) {
    throw new Error(response.error || 'Failed to describe the style')
  }
  const styleText = response.data?.styleText?.trim() || ''
  if (!styleText) {
    throw new Error('The AI returned an empty description')
  }
  return { styleName: response.data?.styleName?.trim() ?? '', styleText }
}

/**
 * Takes the user's style image: checks the type, shrinks it under the request limit and
 * keeps it as a data URL. The image itself is the style (it is saved and sent to the
 * image model as a reference), so nothing is generated here; the user writes the name and
 * description, or asks the AI for them ("Write with AI", or on Apply when left empty).
 */
export function useStyleImageProcessing(deps: StyleImageDeps) {
  const {
    clearStyleImage,
    setIsLongTakeStyleImageProcessing,
    setLongTakeCustomStyle,
    setLongTakeStyleImageDataUrl,
    setLongTakeStyleImageError,
    setLongTakeStyleImageFile,
    setLongTakeStyleImagePreviewUrl,
    setLongTakeStyleInputMode,
    setPromptDirtySincePreview,
    setStylePreviewImageUrl,
  } = deps

  const styleImageSelectCounterRef = useRef(0)

  const runStyleImageCompression = useCallback(
    async (
      file: File,
    ): Promise<
      { blob: Blob } | { failed: true; reason: StoryModeImageCompressionFailureReason }
    > => {
      if (file.size <= CLOUDFLARE_SAFE_BLOB_BYTES) {
        return { blob: file }
      }
      const result = await compressImageForApiRequest(file)
      if (result.ok) {
        return { blob: result.blob }
      }
      if (result.reason === 'unsupported' && canSendUncompressedStoryModeStyleImage(file.size)) {
        return { blob: file }
      }
      return { failed: true, reason: result.reason }
    },
    [],
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
      // A new picture: the old description was about the old one.
      setLongTakeCustomStyle('')
      setLongTakeStyleInputMode('image')
      setLongTakeStyleImageError(null)
      setStylePreviewImageUrl(null)
      setPromptDirtySincePreview(false)

      const previewUrl = URL.createObjectURL(file)
      setLongTakeStyleImageFile(file)
      setLongTakeStyleImagePreviewUrl(previewUrl)
      setIsLongTakeStyleImageProcessing(true)

      try {
        const compression = await runStyleImageCompression(file)
        if (selectId !== styleImageSelectCounterRef.current) {
          return
        }
        if ('failed' in compression) {
          setLongTakeStyleImageError(STORY_MODE_STYLE_IMAGE_ERROR_MESSAGE)
          return
        }
        const imageDataUrl = await readFileAsDataUrl(compression.blob)
        if (selectId !== styleImageSelectCounterRef.current) {
          return
        }
        setLongTakeStyleImageDataUrl(imageDataUrl)
      } catch (err) {
        if (selectId !== styleImageSelectCounterRef.current) {
          return
        }
        const errorMessage = getErrorMessage(ensureError(err), STORY_MODE_STYLE_IMAGE_ERROR_MESSAGE)
        setLongTakeStyleImageError(errorMessage)
      } finally {
        if (selectId === styleImageSelectCounterRef.current) {
          setIsLongTakeStyleImageProcessing(false)
        }
      }
    },
    [
      clearStyleImage,
      runStyleImageCompression,
      setIsLongTakeStyleImageProcessing,
      setLongTakeCustomStyle,
      setLongTakeStyleImageDataUrl,
      setLongTakeStyleImageError,
      setLongTakeStyleImageFile,
      setLongTakeStyleImagePreviewUrl,
      setLongTakeStyleInputMode,
      setPromptDirtySincePreview,
      setStylePreviewImageUrl,
    ],
  )

  return {
    handleLongTakeStyleImageSelect,
    styleImageSelectCounterRef,
  }
}
