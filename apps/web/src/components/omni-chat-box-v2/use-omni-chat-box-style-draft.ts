import { toast } from '@shared/ui'
import { useAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import {
  useGenerateStylePreview,
  type UserSavedStyle,
  useUpdateStyleThumbnailFromUrl,
} from '@/hooks/useUserSavedStyles'
import { getErrorMessage } from '@/util/error-message'

import type { BrandBriefStyleRef } from './brand/brand-briefs-client'
import { getIsChooseStylePopupOpenAtom } from './state/atoms/domain/runtime'
import type { ChatBoxState } from './state/chatbox-state'
import { resolveReconciledStyleId } from './style/style-match-utils'
import type { CommittedCustomStoryStyle } from './omni-chat-box.types'
import { STORY_MODE_EMPTY_STYLE_ID } from './omni-chat-box-helpers'
import { STORY_MODE_CUSTOM_STYLE_ID } from './omni-chat-box-render-helpers'
import { useStyleApply } from './use-omni-chat-box-style-apply'
import { requestStyleTextFromImage, useStyleImageProcessing } from './use-omni-chat-box-style-image'

export interface StyleDraftDeps {
  allPanelStyleOptions: StoryModeStyleOption[]
  generateStylePreviewMutation: ReturnType<typeof useGenerateStylePreview>
  state: ChatBoxState
  stylePreviewBaseImageUrl: string
  userSavedStyles: UserSavedStyle[]
  userSavedStylesById: Map<string, UserSavedStyle>
}

export function useStyleDraftState(deps: StyleDraftDeps) {
  const {
    allPanelStyleOptions,
    generateStylePreviewMutation,
    state,
    stylePreviewBaseImageUrl,
    userSavedStyles,
    userSavedStylesById,
  } = deps

  // --- Remix attribution state ---
  const [remixProjectId, setRemixProjectId] = useState<string | undefined>()
  const [isStyleCopy, setIsStyleCopy] = useState<boolean | undefined>()
  const clearRemixAttribution = useCallback(() => {
    setRemixProjectId(undefined)
    setIsStyleCopy(undefined)
  }, [])

  // --- Style draft state ---
  const [longTakeCustomStyle, setLongTakeCustomStyle] = useState<string>('')
  const [longTakeStyleName, setLongTakeStyleName] = useState<string>('')
  const [longTakeStyleInputMode, setLongTakeStyleInputMode] = useState<'image' | 'none' | 'text'>(
    'none',
  )
  const [longTakeStyleImageFile, setLongTakeStyleImageFile] = useState<File | null>(null)
  const [longTakeStyleImagePreviewUrl, setLongTakeStyleImagePreviewUrl] = useState<null | string>(
    null,
  )
  const [longTakeStyleImageError, setLongTakeStyleImageError] = useState<null | string>(null)
  const [isLongTakeStyleImageProcessing, setIsLongTakeStyleImageProcessing] = useState(false)
  // The uploaded style picture, shrunk under the request limit: saved as the style and,
  // in "Write with AI", sent to the vision model for a name and description.
  const [longTakeStyleImageDataUrl, setLongTakeStyleImageDataUrl] = useState<null | string>(null)
  const [isLongTakeStyleWritingWithAi, setIsLongTakeStyleWritingWithAi] = useState(false)
  const styleWriteWithAiCounterRef = useRef(0)
  const { fetchApiDomain } = useApi()
  const [storyModeStyleId, setStoryModeStyleId] = useState<string>(STORY_MODE_EMPTY_STYLE_ID)
  const [appliedCustomStoryStyle, setAppliedCustomStoryStyle] =
    useState<CommittedCustomStoryStyle | null>(null)
  // Render-time fallback: when a remix matches a user-saved style that has no
  // thumbnailUrl, the demo's thumbnail is stashed here so the saved-style
  // render path can borrow it. Paired with savedStyleId; auto-clears when the
  // user picks a different style (see effect below).
  const [remixedSavedStyleThumbnailFallback, setRemixedSavedStyleThumbnailFallback] =
    useState<null | {
      savedStyleId: string
      thumbnailUrl: string
    }>(null)
  const [longTakeStyleDialogOpen, setLongTakeStyleDialogOpen] = useState(false)
  // The saved-style id to reopen in the studio; null for a fresh
  // "Add style". Cleared when the studio dialog closes.
  const [isChooseStylePopupOpen, setIsChooseStylePopupOpen] = useAtom(
    getIsChooseStylePopupOpenAtom(state),
  )
  const suppressChooseStyleAutoCloseRef = useRef(false)
  const [stylePreviewImageUrl, setStylePreviewImageUrl] = useState<null | string>(null)
  const [isStylePreviewGenerating, setIsStylePreviewGenerating] = useState(false)
  const [promptDirtySincePreview, setPromptDirtySincePreview] = useState(false)
  const stylePreviewGenCounterRef = useRef(0)

  // Clean up blob URL
  useEffect(() => {
    return () => {
      if (longTakeStyleImagePreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(longTakeStyleImagePreviewUrl)
      }
    }
  }, [longTakeStyleImagePreviewUrl])

  // Reconcile remixed custom style to its matching library/saved style once
  // async style sources (catalog presets, user saved styles) finish loading.
  // Without this, a remix applied before data lands stays pinned to the
  // 'custom' sentinel and renders a duplicate card next to the real one.
  useEffect(() => {
    const reconciledId = resolveReconciledStyleId({
      customStyleText: appliedCustomStoryStyle?.styleText,
      isCustomStyleSelected: storyModeStyleId === STORY_MODE_CUSTOM_STYLE_ID,
      options: allPanelStyleOptions,
    })
    if (reconciledId) {
      const reconciledMatch = allPanelStyleOptions.find((o) => o.id === reconciledId)
      const reconciledHasThumb = !!reconciledMatch?.thumbnailUrl?.trim()
      const carriedThumb = appliedCustomStoryStyle?.previewUrl?.trim()
      if (!reconciledHasThumb && carriedThumb) {
        setRemixedSavedStyleThumbnailFallback({
          savedStyleId: reconciledId,
          thumbnailUrl: carriedThumb,
        })
      }
      setAppliedCustomStoryStyle(null)
      setStoryModeStyleId(reconciledId)
    }
  }, [allPanelStyleOptions, appliedCustomStoryStyle, storyModeStyleId])

  // Auto-clear the fallback whenever the active style changes away from the
  // saved style it was paired with. Safer than scattering manual clears across
  // every code path that touches setStoryModeStyleId.
  useEffect(() => {
    if (
      remixedSavedStyleThumbnailFallback &&
      remixedSavedStyleThumbnailFallback.savedStyleId !== storyModeStyleId
    ) {
      setRemixedSavedStyleThumbnailFallback(null)
    }
  }, [remixedSavedStyleThumbnailFallback, storyModeStyleId])

  // Write-through: when we pin a render-time fallback thumbnail to a saved
  // style, also persist it back to the row so the saved-styles panel stops
  // rendering blank for legacy thumbnail-less rows. Per-mount dedup ref keeps
  // a remix -> switch-style -> switch-back cycle from re-firing the mutation.
  // Skip when the matched id is a catalog preset (not in userSavedStylesById)
  // -- the render-time fallback still covers the chip; only the row in
  // user_saved_styles is targeted by this mutation. Server-side
  // `assertAllowedThumbnailUrl` validates the URL.
  const updateStyleThumbnailFromUrlMutation = useUpdateStyleThumbnailFromUrl()
  const writeThroughAttemptedSavedStyleIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!remixedSavedStyleThumbnailFallback) {
      return
    }
    const { savedStyleId, thumbnailUrl } = remixedSavedStyleThumbnailFallback
    if (!userSavedStylesById.has(savedStyleId)) {
      return
    }
    if (writeThroughAttemptedSavedStyleIdsRef.current.has(savedStyleId)) {
      return
    }
    writeThroughAttemptedSavedStyleIdsRef.current.add(savedStyleId)
    updateStyleThumbnailFromUrlMutation.mutate({ id: savedStyleId, thumbnailUrl })
  }, [remixedSavedStyleThumbnailFallback, updateStyleThumbnailFromUrlMutation, userSavedStylesById])

  // --- Derived style state ---
  const selectedStoryModeLibraryStyle = useMemo(
    () =>
      storyModeStyleId === STORY_MODE_EMPTY_STYLE_ID ||
      storyModeStyleId === STORY_MODE_CUSTOM_STYLE_ID
        ? undefined
        : allPanelStyleOptions.find((style) => style.id === storyModeStyleId),
    [allPanelStyleOptions, storyModeStyleId],
  )
  const committedStoryModeStyle = useMemo(() => {
    if (storyModeStyleId === STORY_MODE_EMPTY_STYLE_ID) {
      return null
    }
    if (storyModeStyleId === STORY_MODE_CUSTOM_STYLE_ID) {
      const customStyleData = appliedCustomStoryStyle
      if (!customStyleData) {
        return null
      }
      const styleText = customStyleData.styleText.trim()
      if (!styleText) {
        return null
      }
      return {
        customStyle: true,
        isSavedStyle: false,
        styleInputMode: customStyleData.styleInputMode,
        styleName: customStyleData.styleName?.trim() || undefined,
        styleText,
        styleThumbnailUrl: customStyleData.previewUrl || undefined,
      }
    }
    const styleText = selectedStoryModeLibraryStyle?.styleText?.trim() || ''
    if (!styleText) {
      return null
    }
    const savedStyle = userSavedStylesById.get(storyModeStyleId)
    const fallbackThumb =
      remixedSavedStyleThumbnailFallback?.savedStyleId === storyModeStyleId
        ? remixedSavedStyleThumbnailFallback.thumbnailUrl
        : undefined
    // Prefer a rendered scene preview (latest snapshot) over the uploaded
    // reference image so the committed-style chip mirrors the gallery card.
    // Preset/legacy styles without scene previews keep falling back
    // to thumbnailUrl, then to the remix-borrowed thumbnail.
    const scenePreviewUrl = selectedStoryModeLibraryStyle?.scenePreviewUrls?.find((url) =>
      url.trim(),
    )
    return {
      customStyle: false,
      // Full composed style for generation, read from the saved
      // record. Absent for presets / legacy styles -> generation falls back to
      // styleText at session-create. styleText stays the short display value.
      generationStyleText: savedStyle?.generationStyleText || undefined,
      isSavedStyle: Boolean(savedStyle),
      // The style's own id, carried so the submission can link the style to the
      // project it produced. Only set for a real saved style --
      // presets and legacy library entries have no UserSavedStyle row.
      savedStyleId: savedStyle ? storyModeStyleId : undefined,
      shortDescription: selectedStoryModeLibraryStyle?.shortDescription?.trim() || undefined,
      styleInputMode: savedStyle?.styleInputMode || 'text',
      styleName: selectedStoryModeLibraryStyle?.label || savedStyle?.name,
      styleText,
      styleThumbnailUrl:
        scenePreviewUrl ||
        selectedStoryModeLibraryStyle?.thumbnailUrl ||
        fallbackThumb ||
        undefined,
    }
  }, [
    appliedCustomStoryStyle,
    remixedSavedStyleThumbnailFallback,
    selectedStoryModeLibraryStyle,
    storyModeStyleId,
    userSavedStylesById,
  ])
  // Reference to the user's explicit pick (preset slug / saved-custom id), sent
  // at session-create so a saved brand brief can reference it at confirm.
  // Undefined for the empty slot or an unsaved custom draft (no id to
  // reference). Custom ids live in userSavedStylesById; everything else is a preset.
  const selectedStyleRef = useMemo<BrandBriefStyleRef | undefined>(() => {
    if (
      storyModeStyleId === STORY_MODE_EMPTY_STYLE_ID ||
      storyModeStyleId === STORY_MODE_CUSTOM_STYLE_ID
    ) {
      return undefined
    }
    return userSavedStylesById.has(storyModeStyleId)
      ? { kind: 'custom', userSavedStyleId: storyModeStyleId }
      : { kind: 'preset', presetId: storyModeStyleId }
  }, [storyModeStyleId, userSavedStylesById])
  // Auto Style Selection is off, so the picker shows the stored id and only a
  // committed concrete style satisfies the style-required submit gate.
  const pickerSelectedStyleId = storyModeStyleId
  const hasLongTakeStyle = Boolean(committedStoryModeStyle)
  const isCustomStoryStyleActive =
    storyModeStyleId === STORY_MODE_CUSTOM_STYLE_ID && hasLongTakeStyle
  const customStoryStylePreviewUrl =
    isCustomStoryStyleActive && committedStoryModeStyle
      ? committedStoryModeStyle.styleThumbnailUrl || null
      : null
  const selectedStoryModeStyleThumbnailUrl = useMemo(() => {
    const thumbnailUrl = committedStoryModeStyle?.styleThumbnailUrl?.trim() || ''
    return thumbnailUrl || undefined
  }, [committedStoryModeStyle])

  // --- Image value and reset helpers ---
  const longTakeStyleImageValue = useMemo(() => {
    if (!longTakeStyleImageFile || !longTakeStyleImagePreviewUrl) {
      return null
    }
    return {
      file: longTakeStyleImageFile,
      isProcessing: isLongTakeStyleImageProcessing,
      previewUrl: longTakeStyleImagePreviewUrl,
    }
  }, [isLongTakeStyleImageProcessing, longTakeStyleImageFile, longTakeStyleImagePreviewUrl])
  const clearStyleImage = useCallback(() => {
    if (longTakeStyleImagePreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(longTakeStyleImagePreviewUrl)
    }
    setLongTakeStyleImageFile(null)
    setLongTakeStyleImagePreviewUrl(null)
    setLongTakeStyleImageDataUrl(null)
    setLongTakeStyleImageError(null)
    setIsLongTakeStyleImageProcessing(false)
    styleWriteWithAiCounterRef.current += 1
    setIsLongTakeStyleWritingWithAi(false)
  }, [longTakeStyleImagePreviewUrl])

  const resetLongTakeStyleDraft = useCallback(() => {
    clearStyleImage()
    setLongTakeCustomStyle('')
    setLongTakeStyleName('')
    setLongTakeStyleInputMode('none')
    setStylePreviewImageUrl(null)
    setPromptDirtySincePreview(false)
    setIsStylePreviewGenerating(false)
  }, [
    clearStyleImage,
    setLongTakeCustomStyle,
    setLongTakeStyleInputMode,
    setLongTakeStyleName,
    setPromptDirtySincePreview,
    setStylePreviewImageUrl,
  ])

  // --- Style change handlers ---
  const handleLongTakeCustomStyleChange = useCallback(
    (value: string) => {
      const isImageMode = longTakeStyleInputMode === 'image'
      if (!isImageMode && longTakeStyleInputMode !== 'text') {
        clearStyleImage()
      }
      setLongTakeCustomStyle(value)
      setPromptDirtySincePreview(true)
      if (!isImageMode) {
        setLongTakeStyleInputMode(value.trim().length > 0 ? 'text' : 'none')
      }
    },
    [clearStyleImage, longTakeStyleInputMode, setLongTakeCustomStyle, setLongTakeStyleInputMode],
  )

  const handleLongTakeCustomStyleClear = useCallback(() => {
    setLongTakeCustomStyle('')
    if (longTakeStyleInputMode === 'text') {
      setLongTakeStyleInputMode('none')
    }
  }, [longTakeStyleInputMode, setLongTakeCustomStyle, setLongTakeStyleInputMode])

  const handleLongTakeStyleImageClear = useCallback(() => {
    clearStyleImage()
    setStylePreviewImageUrl(null)
    setPromptDirtySincePreview(false)
    if (longTakeStyleInputMode === 'image') {
      setLongTakeStyleInputMode('none')
      setLongTakeCustomStyle('')
      setLongTakeStyleName('')
    }
  }, [
    clearStyleImage,
    longTakeStyleInputMode,
    setLongTakeCustomStyle,
    setLongTakeStyleInputMode,
    setLongTakeStyleName,
  ])

  // --- Preview generation ---
  const handleGenerateStylePreview = useCallback(async () => {
    const styleText = longTakeCustomStyle.trim()
    if (!styleText) {
      return
    }
    stylePreviewGenCounterRef.current += 1
    const genId = stylePreviewGenCounterRef.current
    setIsStylePreviewGenerating(true)
    try {
      const result = await generateStylePreviewMutation.mutateAsync({
        baseImageUrl: stylePreviewBaseImageUrl,
        styleText,
      })
      if (genId !== stylePreviewGenCounterRef.current) {
        return
      }
      setStylePreviewImageUrl(`data:image/png;base64,${result.previewImageBase64}`)
      setPromptDirtySincePreview(false)
    } catch {
      if (genId === stylePreviewGenCounterRef.current) {
        toast.error('Failed to generate style preview. You can try again.')
      }
    } finally {
      if (genId === stylePreviewGenCounterRef.current) {
        setIsStylePreviewGenerating(false)
      }
    }
  }, [
    longTakeCustomStyle,
    generateStylePreviewMutation,
    setPromptDirtySincePreview,
    setStylePreviewImageUrl,
    stylePreviewBaseImageUrl,
  ])

  const isLongTakeStyleGeneratePreviewEnabled =
    promptDirtySincePreview && longTakeCustomStyle.trim().length > 0
  // An image style needs only the picture: an empty name or description is written by the AI.
  const isLongTakeStyleApplyEnabled =
    longTakeStyleInputMode === 'image'
      ? Boolean(longTakeStyleImageDataUrl) &&
        !isLongTakeStyleImageProcessing &&
        !isLongTakeStyleWritingWithAi
      : longTakeCustomStyle.trim().length > 0 &&
        Boolean(stylePreviewImageUrl) &&
        !promptDirtySincePreview

  // "Write with AI": fills whichever of name and description is empty from the picture,
  // or rewrites both when both are filled (asking again means "give me another take").
  const handleLongTakeStyleWriteWithAi = useCallback(async () => {
    if (!longTakeStyleImageDataUrl) {
      return
    }
    styleWriteWithAiCounterRef.current += 1
    const requestId = styleWriteWithAiCounterRef.current
    const hasText = longTakeCustomStyle.trim().length > 0
    const hasName = longTakeStyleName.trim().length > 0
    const rewriteBoth = hasText && hasName
    setIsLongTakeStyleWritingWithAi(true)
    try {
      const written = await requestStyleTextFromImage(fetchApiDomain, longTakeStyleImageDataUrl)
      if (requestId !== styleWriteWithAiCounterRef.current) {
        return
      }
      if (rewriteBoth || !hasText) {
        setLongTakeCustomStyle(written.styleText)
      }
      if ((rewriteBoth || !hasName) && written.styleName) {
        setLongTakeStyleName(written.styleName)
      }
    } catch (err) {
      if (requestId === styleWriteWithAiCounterRef.current) {
        toast.error(getErrorMessage(err, "Couldn't describe the image. Try again."))
      }
    } finally {
      if (requestId === styleWriteWithAiCounterRef.current) {
        setIsLongTakeStyleWritingWithAi(false)
      }
    }
  }, [
    fetchApiDomain,
    longTakeCustomStyle,
    longTakeStyleImageDataUrl,
    longTakeStyleName,
    setLongTakeCustomStyle,
    setLongTakeStyleName,
  ])

  // --- Style apply & image processing hooks ---
  const { handleLongTakeStyleApply, isLongTakeStyleApplying, saveUserStyleMutation } =
    useStyleApply({
      clearRemixAttribution,
      longTakeCustomStyle,
      longTakeStyleImageDataUrl,
      longTakeStyleInputMode,
      longTakeStyleName,
      promptDirtySincePreview,
      resetLongTakeStyleDraft,
      setAppliedCustomStoryStyle: setAppliedCustomStoryStyle as never,
      setLongTakeStyleDialogOpen,
      setStoryModeStyleId,
      stylePreviewBaseImageUrl,
      stylePreviewImageUrl,
      userSavedStyles,
    })
  const { handleLongTakeStyleImageSelect, styleImageSelectCounterRef } = useStyleImageProcessing({
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
  })

  // --- Dialog open/close ---
  const handleLongTakeStyleDialogOpenChange = useCallback(
    (open: boolean) => {
      styleImageSelectCounterRef.current += 1
      stylePreviewGenCounterRef.current += 1
      if (!open) {
        resetLongTakeStyleDraft()
        setLongTakeStyleDialogOpen(false)
        return
      }
      if (isCustomStoryStyleActive && committedStoryModeStyle) {
        setLongTakeCustomStyle(committedStoryModeStyle.styleText)
        setLongTakeStyleName(committedStoryModeStyle.styleName || '')
        setLongTakeStyleInputMode('text')
        // Seed preview with existing CDN thumbnail so the UI shows it immediately.
        // The save handler detects non-data-URL seeds and skips inline upload;
        // Phase 2 regenerates a fresh thumbnail server-side after save.
        setStylePreviewImageUrl(committedStoryModeStyle.styleThumbnailUrl || null)
        setPromptDirtySincePreview(!committedStoryModeStyle.styleThumbnailUrl)
      } else {
        resetLongTakeStyleDraft()
      }
      setLongTakeStyleDialogOpen(true)
    },
    [
      committedStoryModeStyle,
      isCustomStoryStyleActive,
      resetLongTakeStyleDraft,
      setLongTakeCustomStyle,
      setLongTakeStyleDialogOpen,
      setLongTakeStyleInputMode,
      setLongTakeStyleName,
      setPromptDirtySincePreview,
      setStylePreviewImageUrl,
    ],
  )

  // --- Story mode style selection handlers ---
  const handleStoryModeStyleSelectInternal = useCallback(
    (style: StoryModeStyleOption) => {
      setStoryModeStyleId(style.id)
      setAppliedCustomStoryStyle(null)
      setRemixProjectId(undefined)
      setIsStyleCopy(undefined)
      resetLongTakeStyleDraft()
    },
    [resetLongTakeStyleDraft, setAppliedCustomStoryStyle, setStoryModeStyleId],
  )
  const handleStoryModeStyleClear = useCallback(() => {
    setStoryModeStyleId(STORY_MODE_EMPTY_STYLE_ID)
    setAppliedCustomStoryStyle(null)
    setRemixProjectId(undefined)
    setIsStyleCopy(undefined)
    resetLongTakeStyleDraft()
  }, [resetLongTakeStyleDraft, setAppliedCustomStoryStyle, setStoryModeStyleId])
  const handleStoryModeAddStyleInternal = useCallback(() => {
    handleLongTakeStyleDialogOpenChange(true)
  }, [handleLongTakeStyleDialogOpenChange])

  // --- Choose style popup handlers ---
  const handleChooseStylePopupClose = useCallback(() => {
    setIsChooseStylePopupOpen(false)
  }, [])
  const handleChooseStylePopupAddStyle = useCallback(() => {
    // Non-modal Dialog will auto-dismiss on outside/focus shift; suppress that for Add Style flow.
    suppressChooseStyleAutoCloseRef.current = true
    handleStoryModeAddStyleInternal()
  }, [handleStoryModeAddStyleInternal])
  const handleChooseStylePopupOpenChange = useCallback(
    (open: boolean) => {
      if (!open && (suppressChooseStyleAutoCloseRef.current || longTakeStyleDialogOpen)) {
        return
      }
      setIsChooseStylePopupOpen(open)
    },
    [longTakeStyleDialogOpen],
  )
  const handleChooseStylePopupSelect = useCallback(
    (style: StoryModeStyleOption) => {
      handleStoryModeStyleSelectInternal(style)
      setIsChooseStylePopupOpen(false)
    },
    [handleStoryModeStyleSelectInternal],
  )

  useEffect(() => {
    if (!longTakeStyleDialogOpen) {
      suppressChooseStyleAutoCloseRef.current = false
    }
  }, [longTakeStyleDialogOpen])
  const handleLongTakeStyleApplyWithChooseStyle = useCallback(async () => {
    const didApply = await handleLongTakeStyleApply()
    if (didApply) {
      setIsChooseStylePopupOpen(false)
    }
  }, [handleLongTakeStyleApply])

  return {
    appliedCustomStoryStyle,
    clearRemixAttribution,
    clearStyleImage,
    committedStoryModeStyle,
    customStoryStylePreviewUrl,
    handleChooseStylePopupAddStyle,
    handleChooseStylePopupClose,
    handleChooseStylePopupOpenChange,
    handleChooseStylePopupSelect,
    handleGenerateStylePreview,
    handleLongTakeCustomStyleChange,
    handleLongTakeCustomStyleClear,
    handleLongTakeStyleApply,
    handleLongTakeStyleApplyWithChooseStyle,
    handleLongTakeStyleDialogOpenChange,
    handleLongTakeStyleImageClear,
    handleLongTakeStyleImageSelect,
    handleLongTakeStyleWriteWithAi,
    handleStoryModeAddStyleInternal,
    handleStoryModeStyleClear,
    handleStoryModeStyleSelectInternal,
    hasLongTakeStyle,
    isChooseStylePopupOpen,
    isCustomStoryStyleActive,
    isStyleCopy,
    isLongTakeStyleApplyEnabled,
    isLongTakeStyleApplying,
    isLongTakeStyleGeneratePreviewEnabled,
    isLongTakeStyleImageProcessing,
    isLongTakeStyleWritingWithAi,
    isStylePreviewGenerating,
    longTakeCustomStyle,
    longTakeStyleDialogOpen,
    longTakeStyleImageError,
    longTakeStyleImageValue,
    longTakeStyleInputMode,
    longTakeStyleImageFile,
    longTakeStyleName,
    setLongTakeStyleName,
    pickerSelectedStyleId,
    promptDirtySincePreview,
    remixProjectId,
    resetLongTakeStyleDraft,
    saveUserStyleMutation,
    selectedStoryModeLibraryStyle,
    selectedStoryModeStyleThumbnailUrl,
    selectedStyleRef,
    setAppliedCustomStoryStyle,
    setIsChooseStylePopupOpen,
    setIsStyleCopy,
    setRemixedSavedStyleThumbnailFallback,
    setRemixProjectId,
    setStoryModeStyleId,
    storyModeStyleId,
    stylePreviewImageUrl,
  }
}
