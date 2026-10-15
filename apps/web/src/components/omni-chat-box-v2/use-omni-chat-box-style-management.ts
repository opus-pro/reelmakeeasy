import { toast } from '@shared/ui'
import { useCallback, useState } from 'react'

import {
  useDeleteUserStyle,
  type UserSavedStyle,
  useSaveUserStyle,
} from '@/hooks/useUserSavedStyles'
import { getErrorMessage } from '@/util/error-message'

import {
  buildUniqueStyleName,
  createAutoSavedStyleBaseName,
  normalizeSavedStyleText,
  readFileAsDataUrl,
} from './omni-chat-box-helpers'
import { compressStylePreviewForSave } from './story-mode-style-image'

export function useStyleManagement(
  committedStoryModeStyle: null | {
    customStyle?: boolean
    generationStyleText?: null | string
    isSavedStyle?: boolean
    styleInputMode: string
    styleName?: string
    styleText: string
    styleThumbnailUrl?: string
  },
  appliedCustomStoryStyleImageDataUrl: string | undefined,
  isLongTakeStyleImageProcessing: boolean,
  userSavedStyles: UserSavedStyle[],
  userSavedStylesById: Map<string, UserSavedStyle>,
  storyModeStyleId: string,
  handleStoryModeStyleClear: () => void,
) {
  const saveUserStyleMutation = useSaveUserStyle()
  const deleteUserStyleMutation = useDeleteUserStyle()
  const [pendingDeleteStyle, setPendingDeleteStyle] = useState<null | { id: string; name: string }>(
    null,
  )

  const autoSaveCurrentStoryStyle = useCallback(async () => {
    if (!committedStoryModeStyle?.customStyle || isLongTakeStyleImageProcessing) {
      return
    }
    const styleText = committedStoryModeStyle.styleText.trim()
    if (!styleText) {
      return
    }
    const styleInputMode = committedStoryModeStyle.styleInputMode
    const imageDataUrl = appliedCustomStoryStyleImageDataUrl
    if (styleInputMode === 'image' && !imageDataUrl) {
      return
    }
    const normalizedStyleText = normalizeSavedStyleText(styleText)
    const alreadySaved = userSavedStyles.some(
      (style) =>
        style.styleInputMode === styleInputMode &&
        normalizeSavedStyleText(style.styleText) === normalizedStyleText,
    )
    if (alreadySaved) {
      return
    }
    const existingNamesLower = new Set<string>(
      userSavedStyles.map((style) => style.name.trim().toLowerCase()),
    )
    const preferredName = committedStoryModeStyle.styleName?.trim() || ''
    const baseName =
      preferredName || createAutoSavedStyleBaseName(styleText, styleInputMode as 'image' | 'text')
    const name = buildUniqueStyleName(baseName, existingNamesLower)
    try {
      let imageDataUrlToSave: string | undefined
      if (styleInputMode === 'image' && imageDataUrl) {
        const compressionResult = await compressStylePreviewForSave(imageDataUrl)
        if (compressionResult.ok) {
          imageDataUrlToSave = await readFileAsDataUrl(compressionResult.blob)
        }
      }
      const remoteThumbnailUrl =
        styleInputMode === 'text' ? committedStoryModeStyle.styleThumbnailUrl?.trim() : undefined
      await saveUserStyleMutation.mutateAsync({
        ...(imageDataUrlToSave ? { imageDataUrl: imageDataUrlToSave } : {}),
        name,
        styleInputMode: styleInputMode as 'image' | 'text',
        styleText,
        ...(remoteThumbnailUrl ? { thumbnailUrl: remoteThumbnailUrl } : {}),
      })
      toast.success('Style auto-saved')
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Failed to auto-save style')
      if (!errorMessage.toLowerCase().includes('already exists')) {
        toast.warning(`Story started, but auto-save failed: ${errorMessage}`)
      }
    }
  }, [
    appliedCustomStoryStyleImageDataUrl,
    committedStoryModeStyle,
    isLongTakeStyleImageProcessing,
    saveUserStyleMutation,
    userSavedStyles,
  ])

  const handleDeleteUserStyle = useCallback(
    (styleId: string) => {
      const style = userSavedStylesById.get(styleId)
      setPendingDeleteStyle({ id: styleId, name: style?.name || 'this style' })
    },
    [userSavedStylesById],
  )

  const handleDeleteUserStyleCancel = useCallback(() => {
    if (deleteUserStyleMutation.isPending) {
      return
    }
    setPendingDeleteStyle(null)
  }, [deleteUserStyleMutation.isPending])

  const handleDeleteUserStyleConfirm = useCallback(async () => {
    if (!pendingDeleteStyle) {
      return
    }
    const styleId = pendingDeleteStyle.id
    try {
      await deleteUserStyleMutation.mutateAsync(styleId)
      if (storyModeStyleId === styleId) {
        handleStoryModeStyleClear()
      }
      toast.success('Style deleted')
      setPendingDeleteStyle(null)
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Failed to delete style')
      toast.error(errorMessage)
    }
  }, [deleteUserStyleMutation, handleStoryModeStyleClear, pendingDeleteStyle, storyModeStyleId])

  return {
    autoSaveCurrentStoryStyle,
    deleteUserStyleMutation,
    handleDeleteUserStyle,
    handleDeleteUserStyleCancel,
    handleDeleteUserStyleConfirm,
    pendingDeleteStyle,
  }
}
