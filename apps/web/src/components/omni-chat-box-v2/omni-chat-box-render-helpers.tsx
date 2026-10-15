'use client'

import React from 'react'

import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'

import type { AnchorAssetCategory, AnchorAssetPromptItem } from './anchor-assets'
import { AnchorAssetsBox } from './anchor-assets'
import { STORY_MODE_CUSTOM_STYLE_ID, StoryModePanel } from './StoryModePanel'

export { STORY_MODE_CUSTOM_STYLE_ID }

export const renderStoryModePanel = ({
  customStyleLabel,
  customStylePreviewUrl,
  isStoryModeLayout,
  onAddStyle,
  onClearSelectedStyle,
  onCloseWithoutApply,
  onDeleteUserStyle,
  onSelectStyle,
  selectedStyleId,
  showStyleError,
  styleOptions,
  userStyles,
}: {
  customStyleLabel?: string
  customStylePreviewUrl?: null | string
  isStoryModeLayout: boolean
  onAddStyle: () => void
  onClearSelectedStyle: () => void
  onCloseWithoutApply?: (previousStyleId: string) => void
  onDeleteUserStyle?: (styleId: string) => void
  onSelectStyle: (style: StoryModeStyleOption) => void
  selectedStyleId: string
  showStyleError: boolean
  styleOptions: StoryModeStyleOption[]
  userStyles?: StoryModeStyleOption[]
}) => {
  if (!isStoryModeLayout) {
    return null
  }
  return (
    <StoryModePanel
      customStyleLabel={customStyleLabel}
      customStylePreviewUrl={customStylePreviewUrl}
      onAddStyle={onAddStyle}
      onClearSelectedStyle={onClearSelectedStyle}
      onCloseWithoutApply={onCloseWithoutApply}
      onDeleteUserStyle={onDeleteUserStyle}
      onSelectStyle={onSelectStyle}
      selectedStyleId={selectedStyleId}
      showStyleError={showStyleError}
      styleOptions={styleOptions}
      userStyles={userStyles}
    />
  )
}

export const renderAnchorAssetsOverlay = ({
  assets,
  disabled,
  isEnhancing,
  isSending,
  maxImageAttachments,
  onHoverChange,
  onRemove,
  onSelect,
  onUpload,
  showAnchorAssetsBox,
}: {
  assets: AnchorAssetPromptItem[]
  disabled: boolean
  isEnhancing: boolean
  isSending: boolean
  maxImageAttachments: number
  onHoverChange: (isHovered: boolean) => void
  onRemove: (asset: AnchorAssetPromptItem) => void
  onSelect: (asset: AnchorAssetPromptItem) => void
  onUpload: (category: AnchorAssetCategory, files: File[]) => void
  showAnchorAssetsBox: boolean
}) => {
  if (!showAnchorAssetsBox) {
    return null
  }
  return (
    <AnchorAssetsBox
      assets={assets}
      disabled={disabled || isEnhancing || isSending}
      maxImageAttachments={maxImageAttachments}
      onHoverChange={onHoverChange}
      onRemove={onRemove}
      onSelect={onSelect}
      onUpload={onUpload}
    />
  )
}
