import { toast } from '@shared/ui'
import { useCallback, useState } from 'react'

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

export interface StyleApplyDeps {
  clearRemixAttribution?: () => void
  longTakeCustomStyle: string
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

  const saveUserStyleMutation = useSaveUserStyle()
  const generateStylePreviewMutation = useGenerateStylePreview()
  const generateStyleNameMutation = useGenerateStyleName()
  const updateStyleThumbnailMutation = useUpdateStyleThumbnail()
  const [isLongTakeStyleApplying, setIsLongTakeStyleApplying] = useState(false)

  const handleLongTakeStyleApply = useCallback(async () => {
    if (!longTakeCustomStyle.trim()) {
      return false
    }
    setIsLongTakeStyleApplying(true)
    let didApply = false
    try {
      const styleText = longTakeCustomStyle.trim()
      const existingNamesLower = new Set(userSavedStyles.map((s) => s.name.trim().toLowerCase()))
      const inputMode = longTakeStyleInputMode === 'image' ? 'image' : 'text'
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

      // Image mode requires imageDataUrl server-side. If we don't have one
      // (dirty prompt after preview, failed preview, or remix-CDN path that
      // was short-circuited), downgrade to text mode so the save succeeds and
      // Phase 2 can regenerate a thumbnail later. Preserves the pre-refactor
      // guard while keeping the payload honest for every other path.
      const effectiveInputMode = inputMode === 'image' && !imageDataUrlToSave ? 'text' : inputMode

      let savedId: string | undefined
      try {
        const saved = await saveUserStyleMutation.mutateAsync({
          imageDataUrl: imageDataUrlToSave,
          name,
          styleInputMode: effectiveInputMode,
          styleText,
        })
        savedId = saved.id
        setStoryModeStyleId(saved.id)
        setAppliedCustomStoryStyle(null)
        clearRemixAttribution?.()
        setLongTakeStyleDialogOpen(false)
        resetLongTakeStyleDraft()
        toast.success('Style saved')
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
    clearRemixAttribution,
    generateStyleNameMutation,
    generateStylePreviewMutation,
    longTakeCustomStyle,
    longTakeStyleInputMode,
    longTakeStyleName,
    promptDirtySincePreview,
    resetLongTakeStyleDraft,
    saveUserStyleMutation,
    setAppliedCustomStoryStyle,
    setLongTakeStyleDialogOpen,
    setStoryModeStyleId,
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
