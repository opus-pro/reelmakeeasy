'use client'
import { useRive } from '@rive-app/react-canvas'
import { cn } from '@shared/ui/lib/utils'
import React, { useCallback, useState } from 'react'

import { CheckMark, Export } from '@/components/icons/core'
import { useBreakpoint } from '@/util/browserUtils'
import { getPublicCdnUrl } from '@/util/cdn-utils'

interface VoiceUploadContentProps {
  className?: string
  context?: 'avatar' | 'voice'
  isDragging: boolean
  /** Shortest sample accepted, in seconds. */
  minSeconds?: number
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onStartRecording: () => void
  onUploadClick: () => void
  selectedFile?: File | null
}

export function VoiceUploadContent({
  isDragging,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onUploadClick,
  onStartRecording,
  className,
  context = 'voice',
  minSeconds = 15,
  selectedFile,
}: VoiceUploadContentProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const { isBelowMd } = useBreakpoint('md')
  const { RiveComponent } = useRive({
    src: getPublicCdnUrl('agent/voice-over/voice_icon.riv'),
    autoplay: true,
    onLoad: () => setIsLoaded(true),
  })

  const handleRecordClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onStartRecording()
    },
    [onStartRecording, context],
  )

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl md:border-2 md:border-dashed p-6 w-full flex-1 md:flex-none h-full md:h-auto transition-all duration-200',
        isDragging ? 'bg-fill-secondary border-subtle' : 'bg-menu-background border-subtle',
        // Only show hover state when a file is selected
        selectedFile && 'hover:border-secondary',
        className,
      )}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="flex flex-col items-center gap-3 size-full justify-center"
        onDragEnter={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDragEnter(e)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDragLeave(e)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDragOver(e)
        }}
        onDrop={(e) => {
          e.preventDefault()
          // Don't stop propagation - let it bubble up to parent
          onDrop(e)
        }}
      >
        {/* Icon and title with specific gap */}
        <div className="flex flex-col items-center gap-5">
          {/* Rive icon with transparent background */}
          <div
            className={cn(
              'flex items-center justify-center size-[60px] rounded-[10px] overflow-hidden transition-opacity duration-200 border-0',
              isLoaded ? 'opacity-100' : 'opacity-0',
            )}
          >
            <RiveComponent />
          </div>

          {/* Main text */}
          <div
            className="text-center"
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              // Don't stop propagation - let it bubble up to parent
              onDrop(e)
            }}
          >
            <p className="text-base md:text-sm font-medium text-primary leading-5">
              {isBelowMd
                ? 'Upload or record your voice to generate a custom voice.'
                : 'Drag and drop audio to create a custom voice.'}
            </p>
          </div>
        </div>

        {/* Instructions */}
        <div
          className="flex flex-col gap-0 items-start"
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDrop={(e) => {
            e.preventDefault()
            // Don't stop propagation - let it bubble up to parent
            onDrop(e)
          }}
        >
          <div className="flex gap-1 items-center">
            <CheckMark className="size-4 md:size-3.5 text-secondary md:fill-[var(--secondary)] leading-[22px]" />
            <span className="text-sm md:text-xs text-secondary">MP3, WAV, or M4A up to 10MB</span>
          </div>
          <div className="flex gap-1 items-center">
            <CheckMark className="size-4 md:size-3.5 text-secondary md:fill-[var(--secondary)] leading-[22px]" />
            <span className="text-sm md:text-xs text-secondary">
              {minSeconds} seconds of audio required
            </span>
          </div>
          <div className="flex gap-1 items-center">
            <CheckMark className="size-4 md:size-3.5 text-secondary md:fill-[var(--secondary)] leading-[22px]" />
            <span className="text-sm md:text-xs text-secondary">Use a quiet environment</span>
          </div>
        </div>

        {/* Divider */}
        {!isBelowMd && (
          <div className="flex items-center gap-3 w-full justify-center">
            <div className="w-[127px] border-t border-tertiary" />
            <span className="text-xs text-secondary">or</span>
            <div className="w-[127px] border-t border-tertiary" />
          </div>
        )}

        {!isBelowMd && (
          <div className="flex gap-2 items-center">
            {/* Upload button */}
            <button
              className="flex gap-1.5 items-center justify-center h-[36px] px-[10px] rounded-sm transition-colors bg-fill hover:bg-fill-hover text-black"
              onClick={() => {
                onUploadClick()
              }}
              type="button"
            >
              <Export className="size-[18px]" />
              <span className="text-sm font-medium">Upload</span>
            </button>

            {/* Record button */}
            <button
              className="flex gap-1.5 items-center justify-center h-[36px] px-[10px] rounded-sm transition-colors bg-fill-secondary hover:bg-fill-hover text-white"
              onClick={handleRecordClick}
              type="button"
            >
              <svg
                className="size-[18px]"
                fill="none"
                viewBox="0 0 19 19"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M14.75 8C15.1642 8 15.5 8.33579 15.5 8.75C15.5 11.8096 13.2096 14.3325 10.25 14.7017V15.5H12.5C12.9142 15.5 13.25 15.8358 13.25 16.25C13.25 16.6642 12.9142 17 12.5 17H6.5C6.08579 17 5.75 16.6642 5.75 16.25C5.75 15.8358 6.08579 15.5 6.5 15.5H8.75V14.7017C5.79038 14.3325 3.5 11.8096 3.5 8.75C3.5 8.33579 3.83579 8 4.25 8C4.66421 8 5 8.33579 5 8.75C5 11.2353 7.01472 13.25 9.5 13.25C11.9853 13.25 14 11.2353 14 8.75C14 8.33579 14.3358 8 14.75 8ZM9.5 2C11.1569 2 12.5 3.34315 12.5 5V8.75C12.5 10.4069 11.1569 11.75 9.5 11.75C7.84315 11.75 6.5 10.4069 6.5 8.75V5C6.5 3.34315 7.84315 2 9.5 2ZM9.5 3.5C8.67157 3.5 8 4.17157 8 5V8.75C8 9.57843 8.67157 10.25 9.5 10.25C10.3284 10.25 11 9.57843 11 8.75V5C11 4.17157 10.3284 3.5 9.5 3.5Z"
                  fill="currentColor"
                />
              </svg>
              <span className="text-sm font-medium">Record audio</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
