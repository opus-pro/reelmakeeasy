import { useAtom, useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'

import { usePubSub } from '../editor/hooks/usePubSub'
import { renderMainEngineStore } from '../editor/render-engine-sdk'
import { editorUiStore } from '../editor/stores/editor-ui.store'
import { ModuleName } from '../editor/wasm/type'

import { ShotListItem } from './useShotItems'

const LOOP_EARLY_MS = 80
const LOOP_MIN_INTERVAL_MS = 200

// window.pubSub is a single global bus shared by every engine instance, and each
// event carries the originating moduleName. This hook only drives the default
// 'Module' instance, so ignore events from any other instance.
const DEFAULT_MODULE_NAME: ModuleName = 'Module'

interface UseVideoPlaybackOptions {
  shotItems: ShotListItem[]
}

interface UseVideoPlaybackReturn {
  currentTime: number
  duration: number
  isPlaying: boolean
  pause: () => void
  play: () => void
  playGlobal: () => void
  playShot: (shotId: string) => void
  seekToCurrentTime: () => void
  selectedShotId: null | string
  toggle: () => void
}

const EDITOR_SEEK_DELAY_MS = 500

export function useVideoPlayback({ shotItems }: UseVideoPlaybackOptions): UseVideoPlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedShotId, setSelectedShotId] = useAtom(editorUiStore.selectedShotId)
  const engineActions = useAtomValue(renderMainEngineStore.engineActions)
  const currentTime = useAtomValue(renderMainEngineStore.currentTimeWithLowFrequency) / 1000
  const totalTimeMs = useAtomValue(renderMainEngineStore.totalTime)
  const duration = Math.round(totalTimeMs / 1000)
  const pubsub = usePubSub()
  const seekTimeoutIdRef = useRef<null | number>(null)

  const selectedShot = useMemo(() => {
    if (selectedShotId) {
      return shotItems.find((s) => s.id === selectedShotId)
    }
    return null
  }, [shotItems, selectedShotId])

  const engineActionsRef = useRef(engineActions)
  engineActionsRef.current = engineActions

  const selectedShotRef = useRef(selectedShot)
  const isPlayingRef = useRef(isPlaying)
  const totalTimeRef = useRef(totalTimeMs)
  const lastLoopSeekAtRef = useRef(0)

  useEffect(() => {
    selectedShotRef.current = selectedShot
    lastLoopSeekAtRef.current = 0
  }, [selectedShot])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    totalTimeRef.current = totalTimeMs
  }, [totalTimeMs])

  useEffect(() => {
    return () => {
      if (seekTimeoutIdRef.current) {
        window.clearTimeout(seekTimeoutIdRef.current)
      }
    }
  }, [])

  const handleVideoTimeUpdate = useCallback((moduleName: ModuleName, progress: number) => {
    if (moduleName !== DEFAULT_MODULE_NAME) {
      return
    }
    const shot = selectedShotRef.current
    if (!shot || !isPlayingRef.current) {
      return
    }

    const totalTime = totalTimeRef.current
    if (!totalTime) {
      return
    }

    const timeMs = Math.round((totalTime * (progress || 0)) / 100)
    const endMs = shot.timeRange.end * 1000
    if (timeMs < endMs - LOOP_EARLY_MS) {
      return
    }

    const now = performance.now()
    if (now - lastLoopSeekAtRef.current < LOOP_MIN_INTERVAL_MS) {
      return
    }

    lastLoopSeekAtRef.current = now
    setIsPlaying(false)
    engineActionsRef.current?.playOrPause(false)
    engineActionsRef.current?.seek(shot.timeRange.start * 1000)
  }, [])

  useEffect(() => {
    pubsub.on('videoTimeUpdate', handleVideoTimeUpdate)
    return () => {
      pubsub.off('videoTimeUpdate', handleVideoTimeUpdate)
    }
  }, [pubsub, handleVideoTimeUpdate])

  const play = useCallback(() => {
    setIsPlaying(true)
    engineActions?.playOrPause(true)
  }, [engineActions])

  const pause = useCallback(() => {
    setIsPlaying(false)
    engineActions?.playOrPause(false)
  }, [engineActions])

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }, [isPlaying, pause, play])

  const playShot = useCallback(
    (shotId: string) => {
      const shot = shotItems.find((s) => s.id === shotId)
      if (!shot) {
        return
      }

      setSelectedShotId(shotId)
      engineActions?.seek(shot.timeRange.start * 1000)
    },
    [shotItems, engineActions, setSelectedShotId],
  )

  const playGlobal = useCallback(() => {
    setSelectedShotId(null)
    setIsPlaying(true)
    engineActions?.playOrPause(true)
  }, [engineActions, setSelectedShotId])

  const seekToCurrentTime = useRefCallback(() => {
    if (seekTimeoutIdRef.current) {
      window.clearTimeout(seekTimeoutIdRef.current)
    }
    seekTimeoutIdRef.current = window.setTimeout(() => {
      engineActions?.seek(currentTime * 1000)
    }, EDITOR_SEEK_DELAY_MS)
  })

  return {
    currentTime,
    duration,
    isPlaying,
    pause,
    play,
    playGlobal,
    playShot,
    selectedShotId,
    toggle,
    seekToCurrentTime,
  }
}
