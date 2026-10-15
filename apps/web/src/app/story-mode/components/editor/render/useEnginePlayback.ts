'use client'

import { useEffect, useState } from 'react'

import type { EngineActions } from '@/app/projects/[projectId]/editor/render-engine-sdk/render-engine.store'
import { useRefCallback } from '@/hooks/use-ref-callback'

/**
 * Play / pause / seek on an editor engine, and whether it is playing: play restarts a
 * finished playback from the top, and the end of playback flips it back to paused.
 *
 * `loop` (a loop short): the engine is asked to loop, and should it still report the end,
 * playback goes on from the top instead of pausing.
 */
export function useEnginePlayback({
  engineActions,
  loop = false,
  playbackCompleted,
}: {
  engineActions: EngineActions | undefined
  loop?: boolean
  playbackCompleted: boolean
}) {
  const [isPlaying, setIsPlaying] = useState(false)

  const play = useRefCallback(() => {
    if (playbackCompleted) {
      engineActions?.seek(0)
    }
    engineActions?.playOrPause(true, loop)
    setIsPlaying(true)
  })
  const pause = useRefCallback(() => {
    engineActions?.playOrPause(false)
    setIsPlaying(false)
  })
  const seek = useRefCallback((ms: number) => {
    engineActions?.seek(ms)
  })

  useEffect(() => {
    if (!isPlaying || !playbackCompleted) {
      return
    }
    if (loop) {
      engineActions?.seek(0)
      engineActions?.playOrPause(true, true)
      return
    }
    setIsPlaying(false)
  }, [engineActions, isPlaying, loop, playbackCompleted])

  return { isPlaying, pause, play, seek }
}
