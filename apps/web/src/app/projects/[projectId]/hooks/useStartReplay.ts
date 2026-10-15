import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import {
  projectReplayFullHistoryAtom,
  projectReplayModeAtom,
  projectReplayStatusAtom,
  ReplayMsg,
  replayMsgListAtom,
} from '@/atom/project'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { mergeChatMessage } from './merge-chat-message'

export function useStartReplay() {
  const setReplayMode = useSetAtom(projectReplayModeAtom)
  const fullHistory = useAtomValue(projectReplayFullHistoryAtom)
  const [replayStatus, setReplayStatus] = useAtom(projectReplayStatusAtom)
  const setReplayMsgList = useSetAtom(replayMsgListAtom)

  const updateState = useRefCallback((p: Partial<typeof replayStatus>) => {
    setReplayStatus((prev) => ({ ...prev, ...p }))
  })

  const renderFrameByIndex = useRefCallback((index: number) => {
    const newList = fullHistory.slice(0, index)
    const mergedList = newList.reduce<ReplayMsg[]>((acc, curr) => mergeChatMessage(acc, curr), [])
    setReplayMsgList(mergedList)
    updateState({ currentFrame: index })
  })

  const getCurrentMs = useRefCallback(() => {
    if (replayStatus.playing && replayStatus.startPlayedAt !== -1) {
      return replayStatus.seekAt + (Date.now() - replayStatus.startPlayedAt)
    }
    return replayStatus.seekAt
  })

  const getIndex = useRefCallback((currentMs: number) => {
    if (currentMs < 0) {
      return 0
    }

    const index = fullHistory.findIndex((msg) => (msg.currentMs ?? 0) >= currentMs)
    // index exceed: return last one
    if (index === -1) {
      return fullHistory.length - 1
    }
    return index
  })

  const renderFrame = useRefCallback(() => {
    const currentMs = getCurrentMs()
    const next = getIndex(currentMs)

    if (next >= fullHistory.length) {
      updateState({ playing: false })
      renderFrameByIndex(fullHistory.length - 1)
    } else if (next < 0) {
      updateState({ playing: false })
      renderFrameByIndex(0)
    } else {
      renderFrameByIndex(next)
    }
  })

  useEffect(() => {
    setReplayMode(true)
  }, [])

  useEffect(() => {
    if (!replayStatus.playing) {
      renderFrame()
    }
  }, [replayStatus.playing, replayStatus.seekAt])

  useEffect(() => {
    if (!replayStatus.playing) {
      return
    }

    const FPS = 30
    const durationMs = 1000 / FPS
    let canceled = false

    const tick = async (): Promise<void> => {
      if (canceled || !replayStatus.playing) {
        return
      }
      renderFrame()
      await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
      void tick()
    }

    void tick()

    return () => {
      canceled = true
    }
  }, [replayStatus.playing, renderFrame])
}
