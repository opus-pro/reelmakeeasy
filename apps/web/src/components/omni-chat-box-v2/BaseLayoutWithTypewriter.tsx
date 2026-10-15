'use client'

import { cn } from '@shared/ui'
import React, { useEffect, useState } from 'react'

import { STORY_MODE_PLACEHOLDER_TEXT_PROMPT_SCRIPT_OR_AUDIO } from '@/components/markdown-editor/constants'
import { useIsMobile } from '@/util/browserUtils'

import { BaseLayout, type BaseLayoutProps } from './layout'

export const BaseLayoutWithTypewriter: React.FC<
  BaseLayoutProps & {
    longTakeEnabled?: boolean
  }
> = ({ longTakeEnabled, placeholder, placeholderContainerClassName, ...props }) => {
  const isMobile = useIsMobile()
  const currentText = useExampleTransition()

  const placeholderOverride = (placeholder ?? '').trim()
  const displayText = placeholderOverride
    ? placeholderOverride
    : longTakeEnabled
      ? STORY_MODE_PLACEHOLDER_TEXT_PROMPT_SCRIPT_OR_AUDIO
      : isMobile
        ? 'What do you want to make today?'
        : currentText

  const customPlaceholder = (
    <div
      className={cn(
        'text-secondary text-base leading-[26px]',
        !longTakeEnabled && !placeholderOverride && 'animate-fade-in-up',
      )}
      key={placeholderOverride || (longTakeEnabled ? 'story-mode-placeholder' : displayText)}
    >
      <span className="align-baseline">{displayText}</span>
    </div>
  )

  return <BaseLayout {...props} customPlaceholder={customPlaceholder} />
}

// Simplified transition: new text fades in with blur + movement, old text disappears instantly
function useExampleTransition() {
  const examples = [
    'a surprise album announcement using this X post...',
    'the cost of migrating to Mars using this X post as the intro...',
    'a new phone launch based on this LinkedIn post...',
    'the collectible toy craze using this article as the source...',
    'the night time habit using my own uploaded audio...',
  ]

  const [index, setIndex] = useState(0)
  const currentText = `Create a video about ${examples[index % examples.length]}`

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % examples.length)
    }, 5000) // Change text every 5 seconds

    return () => clearInterval(timer)
  }, [examples.length])

  return currentText
}
