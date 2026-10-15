'use client'

import { LOCAL_USER_ID } from '@reelmakeeasy/common/auth/local-identity'
import { SharedLocalStorageValue } from '@reelmakeeasy/common/utils/shared-local-storage-value'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { useLegacyAnnouncementPreview } from '@/components/announcements/useLegacyAnnouncementPreview'
import { useOrchestratedAnnouncementSlot } from '@/components/announcements/useOrchestratedAnnouncementSlot'

import { type OnboardingStep, OnboardingTooltip } from './OnboardingTooltip'

const STORAGE_KEY = 'story-mode-onboarding-v2-completed'

/**
 * Onboarding tour steps for Story Mode.
 * Step order:
 *  1. Choose your aesthetic (style selection)
 *  2. Upload your assets (characters, products, logos)
 *  3. Upload your voiceover (or pick a voice - one dialog in v2)
 *  4. Choose the right aspect ratio
 *
 * Selectors accept both v1 and v2 anchor names so the tour renders on both
 * the legacy home and Dashboard V2 while the dashboard revamp rolls out.
 */
const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    description: 'Start with a preset style like Claymation or build a custom look from scratch.',
    id: 'choose-aesthetic',
    placement: 'bottom-left',
    targetSelector:
      '[data-onboarding-target="style-button"], [data-onboarding-target="style-selection"]',
    title: 'Choose your aesthetic',
  },
  {
    description: 'Personalize your video by uploading your own characters, products, and logos.',
    id: 'upload-assets',
    placement: 'bottom',
    targetSelector:
      '[data-onboarding-target="image-upload"], [data-onboarding-target="anchor-assets"]',
    title: 'Upload your assets',
  },
  {
    description: 'Upload your own audio or pick a narrator (optional).',
    id: 'upload-voiceover',
    placement: 'bottom-right',
    targetSelector: '[data-onboarding-target="voiceover-upload"]',
    title: 'Upload your voiceover or pick a voice',
  },
  {
    description: 'Select the aspect ratio you want your final video to be in.',
    id: 'aspect-ratio',
    placement: 'top-right',
    targetSelector: '[data-onboarding-target="aspect-ratio"]',
    title: 'Choose the right aspect ratio',
  },
]

interface OnboardingTourProps {
  /**
   * Announcement registry id. When set and the orchestrator gate is on, the
   * orchestrator decides when this tour may show; without it the tour keeps
   * its legacy self-scheduling behavior.
   */
  announcementId?: string
  /** Override for testing - if true, always show the tour regardless of localStorage */
  forceShow?: boolean
  /** Callback when tour is completed or dismissed */
  onComplete?: () => void
  /**
   * Called whenever navigation (Next or the dots) lands on a step. Lets a
   * variant tour prepare the surface a step points at - e.g. the rewards
   * editor tour opens the edit session before its in-editor steps.
   */
  onStepChange?: (step: OnboardingStep, stepIndex: number) => void
  /**
   * Delay before the tour appears, in ms. Use when the mount coincides with a
   * layout transition (e.g. the song upload card swapping to the standard
   * panel) so the anchors settle before the first tooltip shows.
   */
  showDelayMs?: number
  /** Step definitions. Defaults to the Story Mode tour steps. */
  steps?: OnboardingStep[]
  /** localStorage key for seen-state. Variant tours MUST pass their own key. */
  storageKey?: string
}

/**
 * Story Mode Onboarding Tour Component
 *
 * Shows a multi-step onboarding tour for first-time users visiting Story Mode.
 * The tour appears as a tooltip-style popup pointing to different UI elements.
 *
 * Features:
 * - Only shows once per user (persisted in localStorage)
 * - Clickable pagination dots to jump between steps
 * - Close (X) button to dismiss at any time
 * - Dismissing or completing marks the tour as done
 */
export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  announcementId,
  forceShow = false,
  onComplete,
  onStepChange,
  showDelayMs = 0,
  steps = ONBOARDING_STEPS,
  storageKey = STORAGE_KEY,
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false)
  const slot = useOrchestratedAnnouncementSlot(announcementId ?? null)
  const { forced: previewForced, suppressed } = useLegacyAnnouncementPreview(announcementId ?? null)
  const effectiveForceShow = forceShow || previewForced

  // Filter steps to only those whose target element exists in the DOM
  const activeSteps = useMemo(() => {
    if (!isVisible) {
      return steps
    }
    return steps.filter(
      (step) => !step.targetSelector || document.querySelector(step.targetSelector),
    )
  }, [isVisible, steps])

  // Check if user has already seen the onboarding tour
  useEffect(() => {
    if (effectiveForceShow) {
      setIsVisible(true)
      setHasCheckedStorage(true)
      return
    }

    if (suppressed) {
      setIsVisible(false)
      setHasCheckedStorage(true)
      return
    }

    const hasCompleted = localStorage.getItem(storageKey) === 'true'
    setHasCheckedStorage(true)
    if (hasCompleted) {
      return
    }

    if (showDelayMs <= 0) {
      setIsVisible(true)
      return
    }

    const timer = setTimeout(() => setIsVisible(true), showDelayMs)
    return () => clearTimeout(timer)
  }, [effectiveForceShow, showDelayMs, storageKey, suppressed])

  // Get user properties for analytics
  // PII cleanup: user_email and user_name removed; user_id is the analytics key.
  const getUserProperties = useCallback(() => ({ user_id: LOCAL_USER_ID }), [])

  // Mark tour as completed in localStorage
  const markAsCompleted = useCallback(
    (outcome: 'completed' | 'skipped') => {
      if (!effectiveForceShow) {
        // Written through SharedLocalStorage so same-tab listeners (the Seedance
        // journey intro waits on this key) arm immediately, not on next reload.
        new SharedLocalStorageValue(storageKey).set('true')
        if (outcome === 'completed') {
          slot.complete()
        } else {
          slot.dismiss()
        }
      }
      setIsVisible(false)
      onComplete?.()
    },
    [effectiveForceShow, onComplete, slot.complete, slot.dismiss, storageKey],
  )

  // Handle skip (clicking X button) - track as skipped
  const handleSkip = useCallback(() => {
    markAsCompleted('skipped')
  }, [activeSteps, currentStep, getUserProperties, markAsCompleted])

  // Handle completion (clicking Done button on last step)
  const handleComplete = useCallback(() => {
    markAsCompleted('completed')
  }, [activeSteps.length, getUserProperties, markAsCompleted])

  // Handle navigation to specific step
  const handleGoToStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex >= 0 && stepIndex < activeSteps.length) {
        setCurrentStep(stepIndex)
        onStepChange?.(activeSteps[stepIndex], stepIndex)
      }
    },
    [activeSteps, onStepChange],
  )

  // Don't render anything until we've checked localStorage
  if (!hasCheckedStorage) {
    return null
  }

  // Don't render if tour is not visible
  if (!isVisible) {
    return null
  }

  // Once orchestrated, the orchestrator owns the timing of this tour.
  if (announcementId && slot.orchestrated && !slot.active) {
    return null
  }

  const step = activeSteps[currentStep]
  const isLastStep = currentStep === activeSteps.length - 1

  if (!step) {
    return null
  }

  return (
    <OnboardingTooltip
      currentStepIndex={currentStep}
      isLastStep={isLastStep}
      onComplete={handleComplete}
      onGoToStep={handleGoToStep}
      onSkip={handleSkip}
      step={step}
      totalSteps={activeSteps.length}
    />
  )
}

/**
 * Hook to manage onboarding tour state.
 * Provides utilities to reset the tour state for testing.
 */
export const useOnboardingTour = () => {
  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const isCompleted = useCallback(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  }, [])

  return {
    resetOnboarding,
    isCompleted,
    storageKey: STORAGE_KEY,
  }
}
