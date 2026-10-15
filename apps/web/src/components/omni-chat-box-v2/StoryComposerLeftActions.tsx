'use client'

import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { useSetAtom } from 'jotai'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { chatBoxLeftOverlayOpenAtom } from '@/atom/notification'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'

import { AspectRatioButton } from './AspectRatioButton'
import { isSubmissionBgmDisabled } from './bgm-creation-payload'
import { CameraStyleButton } from './CameraStyleButton'
import { CaptionTogglePill } from './CaptionTogglePill'
import { MusicChoiceButton } from './MusicChoiceButton'
import { useRemixBgmCarry } from './use-remix-bgm-carry'
import { VideoModelButton } from './VideoModelButton'
import { VideoQualityButton } from './VideoQualityButton'

export type StoryComposerLeftActionsProps = {
  /** Whether the ratio and settings controls are disabled. */
  disabled?: boolean
  /** Story mode ratio selector change handler */
  onRatioChange?: (ratio: AspectRatio) => void
  /** Prompt-box caption toggle. */
  onShowCaptionsChange: (show: boolean) => void
  /**
   * Active remix source project (component-local composer state). The BGM
   * carry reconciler consumes pending remix intent only while it matches;
   * a mismatch clears stale intent.
   */
  remixProjectId?: string
  /** Selected ratio for story mode */
  selectedRatio?: AspectRatio
  /** Whether captions are currently enabled. */
  showCaptions?: boolean
  /** Active creation flow at submission time. */
  useCaseKey?: CreateUseCaseKey
}

/**
 * Story-mode composer controls that sit next to the brand brief pill: the
 * aspect-ratio button, the quality, camera and music dropdowns, and the caption toggle.
 */
const StoryComposerLeftActionsComponent: React.FC<StoryComposerLeftActionsProps> = ({
  disabled = false,
  onRatioChange,
  onShowCaptionsChange,
  remixProjectId,
  selectedRatio = '9:16',
  showCaptions = false,
  useCaseKey,
}) => {
  // Resolve (drop) carried remix BGM intent on the story surface.
  useRemixBgmCarry({
    activeRemixProjectId: remixProjectId,
    enabled: !isSubmissionBgmDisabled(useCaseKey),
  })

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const suppressTimeoutRef = useRef<null | ReturnType<typeof setTimeout>>(null)
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    if (open) {
      if (suppressTimeoutRef.current) {
        clearTimeout(suppressTimeoutRef.current)
      }
      setDropdownOpen(true)
    } else {
      suppressTimeoutRef.current = setTimeout(() => setDropdownOpen(false), 150)
    }
  }, [])
  useEffect(() => {
    return () => {
      if (suppressTimeoutRef.current) {
        clearTimeout(suppressTimeoutRef.current)
      }
    }
  }, [])
  const setLeftOverlayOpen = useSetAtom(chatBoxLeftOverlayOpenAtom)
  useLayoutEffect(() => {
    setLeftOverlayOpen(dropdownOpen)
    return () => setLeftOverlayOpen(false)
  }, [dropdownOpen, setLeftOverlayOpen])

  return (
    <>
      <div data-onboarding-target="aspect-ratio">
        <AspectRatioButton
          disabled={disabled}
          onChange={(ratio) => {
            onRatioChange?.(ratio)
          }}
          onOpenChange={handleDropdownOpenChange}
          value={selectedRatio}
          variant="story-bar"
        />
      </div>
      <VideoModelButton disabled={disabled} onOpenChange={handleDropdownOpenChange} />
      <VideoQualityButton disabled={disabled} onOpenChange={handleDropdownOpenChange} />
      <CameraStyleButton disabled={disabled} onOpenChange={handleDropdownOpenChange} />
      <MusicChoiceButton disabled={disabled} onOpenChange={handleDropdownOpenChange} />
      <CaptionTogglePill
        disabled={disabled}
        onShowCaptionsChange={onShowCaptionsChange}
        showCaptions={showCaptions}
      />
    </>
  )
}

export const StoryComposerLeftActions = React.memo(StoryComposerLeftActionsComponent)
