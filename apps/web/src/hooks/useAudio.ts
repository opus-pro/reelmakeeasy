'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { useEffect, useRef, useState } from 'react'

import { useRefCallback } from './use-ref-callback'

const nsLogger = Logger.get('audio')

let globalAudioElement: HTMLAudioElement | null = null
let globalPlayingId: null | string = null

interface UseAudioOptions {
  onEnded?: () => void
  onError?: (error: Error) => void
}
interface UseAudioReturn {
  isPlaying: boolean
  pause: () => void
  play: (id: string, url: string) => void
  playingId: null | string
  toggle: (id: string, url: string) => void
}

export function useAudio(options: UseAudioOptions = {}): UseAudioReturn {
  const [playingId, setPlayingId] = useState<null | string>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playPromiseRef = useRef<null | Promise<void>>(null)
  // Bumped by cleanup() and pause(), so a play promise that rejects after the element was
  // released reports nothing: the caller already moved on.
  const playbackAttemptRef = useRef(0)

  const cleanup = useRefCallback(() => {
    playbackAttemptRef.current += 1
    if (audioRef.current) {
      const shouldRelease = !playPromiseRef.current

      if (shouldRelease) {
        // If no play promise is pending, the audio has either finished playing or we are intentionally cleaning up.
        // In that case we can safely pause and release the element.
        audioRef.current.pause()
      }

      // Always remove listeners to avoid accumulating multiple callbacks.
      audioRef.current.removeEventListener('ended', handleAudioEnded)
      audioRef.current.removeEventListener('error', handleAudioError)

      // Only clear the ref when it's appropriate to fully release the element.
      if (shouldRelease) {
        audioRef.current = null
      }
    }
    if (globalPlayingId === playingId) {
      globalPlayingId = null
      globalAudioElement = null
    }
    playPromiseRef.current = null
  })

  const handleAudioEnded = useRefCallback(() => {
    setPlayingId(null)
    if (options.onEnded) {
      options.onEnded()
    }
    playPromiseRef.current = null
  })

  const handleAudioError = useRefCallback((event: Event) => {
    if (event.target && event.target !== audioRef.current) {
      return
    }
    const error = event instanceof ErrorEvent ? event.error : new Error('Audio playback failed')

    if (error && error.name === 'AbortError') {
      return
    }

    setPlayingId(null)
    if (options.onError) {
      options.onError(error)
    } else {
      nsLogger.error('Audio playback error:', error)
    }
    playPromiseRef.current = null
  })

  const play = useRefCallback((id: string, url: string) => {
    if (playingId === id) {
      return
    }

    if (globalAudioElement && globalPlayingId !== id) {
      if (playPromiseRef.current) {
        playPromiseRef.current.then(() => {
          if (globalAudioElement) {
            globalAudioElement.pause()
          }
        })
      } else {
        globalAudioElement.pause()
      }
    }

    cleanup()
    const attempt = playbackAttemptRef.current

    try {
      const audio = new Audio(url)
      audio.preload = 'auto'
      audio.addEventListener('ended', handleAudioEnded)
      audio.addEventListener('error', handleAudioError)
      audioRef.current = audio
      globalAudioElement = audio
      globalPlayingId = id

      const playPromise = audio.play()
      playPromiseRef.current = playPromise

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (playPromiseRef.current === playPromise) {
              playPromiseRef.current = null
            }
          })
          .catch((error) => {
            if (attempt !== playbackAttemptRef.current) {
              return
            }
            if (error.name !== 'AbortError') {
              nsLogger.error('Failed to play audio:', error)
              handleAudioError(new ErrorEvent('error', { error }))
            }

            if (playPromiseRef.current === playPromise) {
              playPromiseRef.current = null
            }
          })
      }

      setPlayingId(id)
    } catch (error) {
      nsLogger.error('Error creating audio:', error)
      setPlayingId(null)
    }
  })

  const pause = useRefCallback(() => {
    playbackAttemptRef.current += 1
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeEventListener('error', handleAudioError)
      audioRef.current.removeEventListener('ended', handleAudioEnded)
      audioRef.current = null
    }

    setPlayingId(null)
    playPromiseRef.current = null

    if (globalAudioElement) {
      globalAudioElement.pause()
      globalAudioElement = null
    }
    globalPlayingId = null

    // Fallback: pause all audio elements in DOM
    const audioElements = document.querySelectorAll('audio')
    audioElements.forEach((audio) => {
      if (!audio.paused) {
        audio.pause()
      }
    })
  })

  const toggle = useRefCallback((id: string, url: string) => {
    if (playingId === id) {
      pause()
    } else {
      play(id, url)
    }
  })

  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    isPlaying: !!playingId,
    pause,
    play,
    playingId,
    toggle,
  }
}
