'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { useLegacyAnnouncementPreview } from '@/components/announcements/useLegacyAnnouncementPreview'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { type OnboardingStep, OnboardingTooltip } from './OnboardingTooltip'

const STORAGE_KEY = 'story-mode-editor-onboarding-v1-completed'
const ANNOUNCEMENT_ID = 'story-mode-editor-onboarding-tour'

const EDITOR_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    description: 'Changes may regenerate connected scenes for smooth transitions.',
    id: 'click-frame',
    placement: 'top-left',
    targetSelector: '[data-onboarding-target="editor-frame-preview"]',
    title: 'Click a frame to change the shot',
  },
  {
    description: 'You can fix details, adjust visuals, or change how the scene is presented.',
    id: 'describe-change',
    placement: 'top',
    targetSelector: '[data-onboarding-target="editor-edit-box"]',
    title: 'Describe what you want to change',
  },
  {
    description: 'These are quick ways to refine your scene instantly.',
    id: 'quick-edit',
    placement: 'top-left',
    targetSelector: '[data-onboarding-target="editor-preset-prompts"]',
    title: 'Try a quick edit',
  },
  {
    description: 'Revert the last shot change or bring back an edit you just undid.',
    id: 'undo-redo',
    placement: 'bottom-right',
    targetSelector: '[data-onboarding-target="editor-history-toolbar"]',
    title: 'Undo or Redo your last change',
  },
]

interface EditorOnboardingTourProps {
  isEditing: boolean
  onComplete?: () => void
}

export const EditorOnboardingTour: React.FC<EditorOnboardingTourProps> = ({
  isEditing,
  onComplete,
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const { forced, suppressed } = useLegacyAnnouncementPreview(ANNOUNCEMENT_ID)

  const activeSteps = useMemo(() => {
    if (!isVisible) {
      return EDITOR_ONBOARDING_STEPS
    }
    const filtered = EDITOR_ONBOARDING_STEPS.filter(
      (step) => !step.targetSelector || document.querySelector(step.targetSelector),
    )
    // If targets are not mounted yet, still show the tour; OnboardingTooltip falls back to centered layout
    return filtered.length > 0 ? filtered : EDITOR_ONBOARDING_STEPS
  }, [isVisible])

  useEffect(() => {
    if (!isEditing) {
      // Leaving the editor must dismiss the tour. Otherwise the tooltip lingers
      // after exit, stranded in a stale position once its target frame/edit-box
      // unmounts.
      setIsVisible(false)
      setCurrentStep(0)
      return
    }
    if (suppressed) {
      setIsVisible(false)
      return
    }
    if (forced) {
      return
    }
    if (localStorage.getItem(STORAGE_KEY) === 'true') {
      return
    }
    // Delay to let the ClipStrip slide-in transition (500ms) finish before measuring position
    const timerId = window.setTimeout(() => setIsVisible(true), 600)
    return () => window.clearTimeout(timerId)
  }, [isEditing, forced, suppressed])

  // Force show via debug toggle or preview param: re-runs whenever it or isEditing changes
  useEffect(() => {
    if (!forced || !isEditing) {
      return
    }
    setCurrentStep(0)
    setIsVisible(false)
    const timerId = window.setTimeout(() => setIsVisible(true), 600)
    return () => window.clearTimeout(timerId)
  }, [forced, isEditing])

  const markAsCompleted = useRefCallback(() => {
    if (!forced) {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setIsVisible(false)
    onComplete?.()
  })

  const handleSkip = useRefCallback(() => {
    markAsCompleted()
  })

  const handleComplete = useRefCallback(() => {
    markAsCompleted()
  })

  const handleGoToStep = useRefCallback((stepIndex: number) => {
    if (stepIndex >= 0 && stepIndex < activeSteps.length) {
      setCurrentStep(stepIndex)
    }
  })

  if (!isVisible) {
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

export const useEditorOnboardingTour = () => {
  const resetOnboarding = useRefCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  const isCompleted = useRefCallback(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  })

  return {
    isCompleted,
    resetOnboarding,
    storageKey: STORAGE_KEY,
  }
}
