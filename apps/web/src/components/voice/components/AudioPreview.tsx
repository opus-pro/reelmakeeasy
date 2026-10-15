import React, { useEffect, useState } from 'react'

import { Delete, Loading, Pause, Play } from '@/components/icons/core'
import { formatSecondsToTime } from '@/util/time-utils'

interface AudioPreviewProps {
  audioDuration: number
  currentTime: number
  isVoiceLoading?: boolean
  onClearFile: () => void
  playingId?: null | string
  selectedFile: File
  toggleFilePlayback: () => void
}

export function AudioPreview({
  audioDuration,
  currentTime,
  isVoiceLoading = false,
  onClearFile,
  playingId,
  selectedFile,
  toggleFilePlayback,
}: AudioPreviewProps) {
  const audioId = `upload-${selectedFile.name}-${selectedFile.size}`
  const isPlaying = playingId === audioId

  const [isMetadataLoading, setIsMetadataLoading] = useState(true)

  // Reset to loading whenever the file changes
  useEffect(() => {
    setIsMetadataLoading(true)
  }, [selectedFile])

  // Clear loading once we have a valid duration
  useEffect(() => {
    if (audioDuration > 0) {
      setIsMetadataLoading(false)
    }
  }, [audioDuration])

  // Safety fallback for formats (e.g. webm) where duration never resolves
  useEffect(() => {
    const timer = setTimeout(() => setIsMetadataLoading(false), 2000)
    return () => clearTimeout(timer)
  }, [selectedFile])

  return (
    <div className="transition-opacity duration-200 opacity-100 flex-1 md:flex-none">
      <div className="bg-[rgba(255,255,255,0.08)] relative rounded-3xl md:rounded-md p-4 flex flex-col h-full md:h-[377px] md:border-2 md:border-[rgba(255,255,255,0.08)] md:border-dashed">
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <div className="flex flex-col items-center">
            {isMetadataLoading ? (
              <Loading className="size-8 animate-spin text-white/50" />
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <button
                      className="flex size-[106px] items-center justify-center rounded-full transition-colors border-2 border-white/10 disabled:opacity-50"
                      disabled={isVoiceLoading}
                      onClick={toggleFilePlayback}
                      type="button"
                    >
                      <div className="size-[96px] rounded-full bg-gradient-to-b from-[rgba(153,162,180,0.08)] to-[rgba(153,162,180,0.2)] flex items-center justify-center">
                        {isPlaying ? (
                          <Pause className="size-7 text-white" />
                        ) : (
                          <Play className="size-7 text-white" />
                        )}
                      </div>
                    </button>

                    {isVoiceLoading && (
                      <div className="absolute inset-0 size-[106px] animate-spin rounded-full">
                        <div className="size-full rounded-full bg-gradient-to-r from-transparent via-white/20 to-transparent p-0.5">
                          <div className="bg-white/8 size-full rounded-full" />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-0.5 items-center">
                    <span className="text-sm text-white">{formatSecondsToTime(currentTime)}</span>
                    <span className="text-sm text-white/50">/</span>
                    <span className="text-sm text-white/50">
                      {formatSecondsToTime(audioDuration)}
                    </span>
                  </div>
                </div>

                <button
                  className="flex gap-1.5 items-center justify-center h-[48px] md:h-[38px] px-4 rounded-full md:rounded-sm bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] transition-colors"
                  onClick={onClearFile}
                  type="button"
                >
                  <Delete className="size-6 md:size-4.5" />
                  <span className="text-base md:text-sm font-medium text-white">Delete</span>
                </button>
              </div>
            )}

            {isVoiceLoading ? (
              <p className="mt-4 text-sm text-white/70">Cloning your voice...</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
