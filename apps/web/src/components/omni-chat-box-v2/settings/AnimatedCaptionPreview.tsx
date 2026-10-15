'use client'

import { cn } from '@shared/ui'
import React, { useEffect, useState } from 'react'

const CAPTION_WORDS = ['Ready', 'to', 'make', 'a', 'video?']
const WORD_DURATION = 200
const LOOP_PAUSE = 800

interface AnimatedCaptionPreviewProps {
  className?: string
}

export const AnimatedCaptionPreview: React.FC<AnimatedCaptionPreviewProps> = ({ className }) => {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const timeoutId = setTimeout(
      () => {
        setActiveIndex((prev) => (prev + 1) % CAPTION_WORDS.length)
      },
      activeIndex === CAPTION_WORDS.length - 1 ? WORD_DURATION + LOOP_PAUSE : WORD_DURATION,
    )
    return () => clearTimeout(timeoutId)
  }, [activeIndex])

  return (
    <div
      className={cn(
        'h-[60px] bg-fill-tertiary rounded-sm flex items-center justify-center px-3 mb-1 overflow-hidden select-none',
        className,
      )}
    >
      <p className="text-primary text-base leading-5 flex items-center justify-center font-['Anton']">
        {CAPTION_WORDS.map((word, index) => (
          <span
            className={cn(
              'inline-block transition-transform duration-150 ease-out origin-center my-0 mx-0.5',
              index === activeIndex ? 'scale-110' : 'scale-100',
            )}
            key={index}
          >
            {word}
          </span>
        ))}
      </p>
    </div>
  )
}
