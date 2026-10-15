'use client'

import { cn } from '@shared/ui'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { AudioPlaybackPill } from '@/components/shared/AudioPlaybackPill'
import { formatAudioDisplayName } from '@/util/format-audio-display-name'

interface StoryModeAudioToVideoPillProps {
  audioUrl: string
  className?: string
  textClassName?: string
}

export const StoryModeAudioToVideoPill: React.FC<StoryModeAudioToVideoPillProps> = ({
  audioUrl,
  className,
  textClassName,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [progress, setProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (!audioUrl) {
      audioRef.current = null
      setProgress(0)
      setIsPlaying(false)
      return
    }

    const audio = new Audio(audioUrl)
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audioRef.current = audio

    const onTimeUpdate = () => {
      const d = audio.duration
      const newProgress = d > 0 ? Math.max(0, Math.min(audio.currentTime / d, 1)) : 0
      setProgress((prev) => (Math.abs(newProgress - prev) > 0.01 ? newProgress : prev))
    }
    const onEnded = () => {
      setIsPlaying(false)
      setProgress(0)
    }
    const onPause = () => setIsPlaying(false)
    const onPlay = () => setIsPlaying(true)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
      audio.pause()
      audioRef.current = null
      setProgress(0)
      setIsPlaying(false)
    }
  }, [audioUrl])

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    if (audio.paused) {
      audio.play()
    } else {
      audio.pause()
    }
  }, [])

  const title = formatAudioDisplayName(audioUrl)

  return (
    <div className="isolate [contain:paint]">
      <AudioPlaybackPill
        className={cn(
          'w-full max-w-full !bg-white/[0.14]',
          'cursor-pointer transition-colors hover:!bg-white/[0.14]',
          className,
        )}
        isPlaying={isPlaying}
        onPlayPause={togglePlayback}
        progress={progress}
        textClassName={textClassName ?? 'max-w-[241px]'}
        title={title}
        variant="pill"
      />
    </div>
  )
}
