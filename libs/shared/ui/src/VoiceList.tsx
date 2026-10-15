'use client'

import { Pause, Play } from 'lucide-react'
import React, { memo } from 'react'

import { cn } from './lib/utils'

export interface VoiceOption {
  color?: string
  labels?: string[]
  name: string
  needsPresignedUrl?: boolean
  previewAudioUrl?: string
  value: string
  voiceCloneId?: string
}

interface VoiceListProps {
  isLoading?: boolean
  isPlaying?: (voiceId: string) => boolean
  itemClassName?: string
  onPlayback?: (voice: VoiceOption) => Promise<void>
  onSelect?: (voice: VoiceOption) => void
  renderName?: (name: string) => React.ReactNode
  selected: null | string
  voices: VoiceOption[]
}

const defaultColor = 'linear-gradient(180deg,#C29AFF,#FF765B)'

export const VoiceList: React.FC<VoiceListProps> = ({
  onSelect,
  selected,
  voices,
  itemClassName,
  renderName,
  onPlayback,
  isPlaying,
  isLoading = false,
}) => {
  const handlePlayback = async (voice: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onPlayback) {
      await onPlayback(voice)
    }
  }

  return (
    <div className="scrollbar-hide w-full space-y-2 overflow-y-auto pr-2">
      {voices.map((voice) => {
        const isSelected = selected === voice.value
        const voiceIsPlaying = isPlaying ? isPlaying(voice.value) : false

        return (
          <div
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-white/5 border border-transparent transition-colors',
              isSelected && 'border-white/20 bg-white/5',
              itemClassName,
            )}
            key={voice.value}
            onClick={() => onSelect?.(voice)}
          >
            <button
              className="flex size-8 items-center justify-center rounded-full disabled:opacity-50"
              disabled={isLoading}
              onClick={(e) => handlePlayback(voice, e)}
              style={{ background: voice.color || defaultColor }}
              type="button"
            >
              {voiceIsPlaying ? (
                <Pause className="size-4 text-white" fill="currentColor" />
              ) : (
                <Play className="ml-0.5 size-4 text-white" fill="currentColor" />
              )}
            </button>

            <div className="flex-1">
              {renderName ? (
                renderName(voice.name)
              ) : (
                <div className="text-white font-medium">{voice.name}</div>
              )}
              <div className="text-white/50 text-sm">{voice.labels?.join(' · ')}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default memo(VoiceList)
