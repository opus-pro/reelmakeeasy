import { toast } from '@shared/ui'
import { useCallback, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import {
  useGenerateStyleName,
  useGenerateStylePreview,
  type UserSavedStyle,
  useSaveUserStyle,
  useUpdateStyleThumbnail,
} from '@/hooks/useUserSavedStyles'
import { getErrorMessage } from '@/util/error-message'

import {
  buildUniqueStyleName,
  createAutoSavedStyleBaseName,
  readFileAsDataUrl,
} from './omni-chat-box-helpers'
import { compressStylePreviewForSave } from './story-mode-style-image'
import { requestStyleTextFromImage } from './use-omni-chat-box-style-image'

export interface StyleApplyDeps {
  clearRemixAttribution?: () => void
  longTakeCustomStyle: string
  /** The user's style picture (compressed data URL), in image mode. */
  longTakeStyleImageDataUrl: null | string
  longTakeStyleInputMode: 'image' | 'none' | 'text'
  longTakeStyleName: string
  promptDirtySincePreview: boolean
  resetLongTakeStyleDraft: () => void
  setAppliedCustomStoryStyle: (v: null) => void
  setLongTakeStyleDialogOpen: (v: boolean) => void
  setStoryModeStyleId: (v: string) => void
  stylePreviewBaseImageUrl: string
  stylePreviewImageUrl: null | string
  userSavedStyles: UserSavedStyle[]
}

export function useStyleApply(deps: StyleApplyDeps) {
  const {
    clearRemixAttribution,
    longTakeCustomStyle,
    longTakeStyleImageDataUrl,
    longTakeStyleInputMode,
    longTakeStyleName,
    promptDirtySincePreview,
    resetLongTakeStyleDraft,
    setAppliedCustomStoryStyle,
    setLongTakeStyleDialogOpen,
    setStoryModeStyleId,
    stylePreviewBaseImageUrl,
    stylePreviewImageUrl,
    userSavedStyles,
  } = deps

  const { fetchApiDomain } = useApi()

  const saveUserStyleMutation = useSaveUserStyle()
  const generateStylePreviewMutation = useGenerateStylePreview()
  const generateStyleNameMutation = useGenerateStyleName()
  const updateStyleThumbnailMutation = useUpdateStyleThumbnail()
  const [isLongTakeStyleApplying, setIsLongTakeStyleApplying] = useState(false)

  const finishSave = useCallback(
    (savedId: string) => {
      setStoryModeStyleId(savedId)
      setAppliedCustomStoryStyle(null)
      clearRemixAttribution?.()
      setLongTakeStyleDialogOpen(false)
      resetLongTakeStyleDraft()
      toast.success('Style saved')
    },
    [
      clearRemixAttribution,
      resetLongTakeStyleDraft,
      setAppliedCustomStoryStyle,
      setLongTakeStyleDialogOpen,
      setStoryModeStyleId,
    ],
  )

  // An image style: the user's own picture is the style. It is saved as is (thumbnail and
  // original), and a video made with it sends it to the image model as a reference. The
  // name and description are the user's, or the AI's for whichever field was left empty.
  const applyImageStyle = useCallback(async (): Promise<boolean> => {
    if (!longTakeStyleImageDataUrl) {
      return false
    }
    let styleText = longTakeCustomStyle.trim()
    let preferredName = longTakeStyleName.trim()
    if (!styleText || !preferredName) {
      try {
        const written = await requestStyleTextFromImage(fetchApiDomain, longTakeStyleImageDataUrl)
        styleText = styleText || written.styleText
        preferredName = preferredName || written.styleName
      } catch (err) {
        if (!styleText) {
          toast.error(getErrorMessage(err, "Couldn't describe the image. Write a description."))
          return false
        }
      }
    }
    const existingNamesLower = new Set(userSavedStyles.map((s) => s.name.trim().toLowerCase()))
    const name = buildUniqueStyleName(
      preferredName || createAutoSavedStyleBaseName(styleText, 'image'),
      existingNamesLower,
    )
    try {
      const saved = await saveUserStyleMutation.mutateAsync({
        imageDataUrl: longTakeStyleImageDataUrl,
        name,
        styleInputMode: 'image',
        styleText,
      })
      finishSave(saved.id)
      return true
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save style'))
      return false
    }
  }, [
    fetchApiDomain,
    finishSave,
    longTakeCustomStyle,
    longTakeStyleImageDataUrl,
    longTakeStyleName,
    saveUserStyleMutation,
    userSavedStyles,
  ])

  const handleLongTakeStyleApply = useCallback(async () => {
    if (longTakeStyleInputMode === 'image') {
      setIsLongTakeStyleApplying(true)
      try {
        return await applyImageStyle()
      } finally {
        setIsLongTakeStyleApplying(false)
      }
    }
    if (!longTakeCustomStyle.trim()) {
      return false
    }
    setIsLongTakeStyleApplying(true)
    let didApply = false
    try {
      const styleText = longTakeCustomStyle.trim()
      const existingNamesLower = new Set(userSavedStyles.map((s) => s.name.trim().toLowerCase()))
      // Image styles take applyImageStyle above; this path saves a typed (text) style.
      const inputMode = 'text'
      let preferredName = longTakeStyleName.trim()
      let imageDataUrlToSave: string | undefined

      const isDataUrlPreview = stylePreviewImageUrl?.startsWith('data:') ?? false
      if (stylePreviewImageUrl && !promptDirtySincePreview && isDataUrlPreview) {
        const compressionResult = await compressStylePreviewForSave(stylePreviewImageUrl)
        if (!compressionResult.ok) {
          toast.error(
            'Preview image is too large to save. Try a smaller or lower-resolution image.',
          )
          return false
        }
        imageDataUrlToSave = await readFileAsDataUrl(compressionResult.blob)
      }

      // Generate a friendly style name when the user did not type one. Runs
      // regardless of whether we also have an inline preview, so users who go
      // through the manual preview flow get "Polaroid Nostalgia" instead of
      // "Text style: Nostalgic 1970s Polaroid film loo...".
      if (!preferredName) {
        try {
          const nameResult = await generateStyleNameMutation.mutateAsync(styleText)
          preferredName = nameResult?.styleName ?? ''
        } catch {
          /* Name generation failed; fall back to prompt snippet */
        }
      }

      const baseName = preferredName || createAutoSavedStyleBaseName(styleText, inputMode)
      const name = buildUniqueStyleName(baseName, existingNamesLower)

      let savedId: string | undefined
      try {
        const saved = await saveUserStyleMutation.mutateAsync({
          imageDataUrl: imageDataUrlToSave,
          name,
          styleInputMode: inputMode,
          styleText,
        })
        savedId = saved.id
        finishSave(saved.id)
        didApply = true
      } catch (err) {
        const errorMessage = getErrorMessage(err, 'Failed to save style')
        toast.error(errorMessage)
      }

      // Phase 2 (background): generate preview and patch thumbnail
      if (savedId && !imageDataUrlToSave) {
        void (async () => {
          try {
            const previewResult = await generateStylePreviewMutation.mutateAsync({
              baseImageUrl: stylePreviewBaseImageUrl,
              styleText,
            })
            const previewDataUrl = `data:image/png;base64,${previewResult.previewImageBase64}`
            const compressionResult = await compressStylePreviewForSave(previewDataUrl)
            if (compressionResult.ok) {
              const compressedDataUrl = await readFileAsDataUrl(compressionResult.blob)
              await updateStyleThumbnailMutation.mutateAsync({
                id: savedId,
                imageDataUrl: compressedDataUrl,
              })
            }
          } catch {
            /* Background thumbnail generation failed */
          }
        })()
      }
    } finally {
      setIsLongTakeStyleApplying(false)
    }
    return didApply
  }, [
    applyImageStyle,
    finishSave,
    generateStyleNameMutation,
    generateStylePreviewMutation,
    longTakeCustomStyle,
    longTakeStyleInputMode,
    longTakeStyleName,
    promptDirtySincePreview,
    saveUserStyleMutation,
    stylePreviewBaseImageUrl,
    stylePreviewImageUrl,
    updateStyleThumbnailMutation,
    userSavedStyles,
  ])

  return {
    handleLongTakeStyleApply,
    isLongTakeStyleApplying,
    saveUserStyleMutation,
  }
}
