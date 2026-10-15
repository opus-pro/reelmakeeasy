'use client'

import React from 'react'

import type { OnboardingStep } from './OnboardingTooltip'
import { OnboardingTour } from './OnboardingTour'

// Separate seen-state from the story-mode tour so completing one never hides
// the other.
const STORAGE_KEY = 'song-to-video-onboarding-v1-completed'

/**
 * Two-step onboarding for the Song to Video use case. Anchors reuse
 * the same data-onboarding-target attributes as the story-mode tour; both
 * targets only exist after the song is uploaded (the upload card swaps to the
 * standard panel), which is when the mount site renders this tour.
 */
const SONG_TO_VIDEO_STEPS: OnboardingStep[] = [
  {
    description:
      'Choose a visual style that matches your song: high-energy, emotional, or build something entirely your own.',
    id: 'song-set-vibe',
    placement: 'bottom-left',
    targetSelector:
      '[data-onboarding-target="style-button"], [data-onboarding-target="style-selection"]',
    title: 'Set the Vibe',
  },
  {
    description:
      'Make it yours. Add artist photos and brand visuals to personalize your music video.',
    id: 'song-upload-assets',
    placement: 'bottom',
    targetSelector:
      '[data-onboarding-target="image-upload"], [data-onboarding-target="anchor-assets"]',
    title: 'Upload Your Music Assets',
  },
]

interface SongToVideoOnboardingTourProps {
  /** Override for testing - if true, always show the tour regardless of localStorage */
  forceShow?: boolean
  /** Callback when tour is completed or dismissed */
  onComplete?: () => void
}

// The tour mounts the moment the audio attachment lands, while the upload
// card is still swapping to the standard panel and the announcement banner
// collapses. Wait for that layout transition to settle before the first
// tooltip shows so it does not pop in mid-shift.
const SHOW_DELAY_MS = 600

export const SongToVideoOnboardingTour: React.FC<SongToVideoOnboardingTourProps> = (props) => {
  return (
    <OnboardingTour
      {...props}
      announcementId="song-to-video-onboarding-tour"
      showDelayMs={SHOW_DELAY_MS}
      steps={SONG_TO_VIDEO_STEPS}
      storageKey={STORAGE_KEY}
    />
  )
}
