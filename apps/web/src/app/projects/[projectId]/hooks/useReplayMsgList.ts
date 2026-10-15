import { ChatBoxMessage } from '@shared/types/chat/message'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'

import {
  projectReplayFullHistoryAtom,
  projectReplayStatusAtom,
  ReplayMsg,
  ReplayMsgDuration,
  replayMsgListAtom,
} from '@/atom/project'
import { useRefCallback } from '@/hooks/use-ref-callback'

export function calculateMsgReplayDuration(
  list: ChatBoxMessage[],
  durationConfig: ReplayMsgDuration,
): ReplayMsg[] {
  let currentMs = 0
  const count: Record<string, number> = {}
  const keyBlockIndices = Object.values(
    list.reduce<Record<string, number>>((acc, msg, idx) => {
      if (
        (msg.type.startsWith('embedded-') && !msg.type.startsWith('embedded-attachment')) ||
        (msg.type === 'text' && (msg.role === 'agent' || msg.role === 'user')) ||
        msg.type === 'finish'
      ) {
        acc[`${msg.type}-${msg.role || 'system'}-${idx}`] = idx
      }
      return acc
    }, {}),
  )
  const totalStep = keyBlockIndices.length
  const result = list.map((msg, idx) => {
    let configKey: string = msg.type
    if (msg.role === 'tool' && durationConfig.tool !== undefined) {
      configKey = 'tool'
    }

    count[configKey] = (count[configKey] ?? 0) + 1
    const duration = durationConfig[configKey] || durationConfig.default
    currentMs += duration

    // Calculate current step based on how many keyBlockIndices are <= current index
    const step = Math.min(keyBlockIndices.filter((keyIdx) => keyIdx <= idx).length, totalStep)

    return {
      ...msg,
      replayDurationMs: duration,
      currentMs,
      step,
      totalStep,
    }
  })
  Object.keys(count).forEach((key) => {
    const duration = durationConfig[key] || durationConfig.default
    const totalMs = duration * count[key]
    count[`${key}-total-ms`] = totalMs
  })
  // console.log('Count', JSON.stringify(count, null, 2))
  return result
}
export function useReplayMsgList() {
  const fullHistory = useAtomValue(projectReplayFullHistoryAtom)

  const msgList = useAtomValue(replayMsgListAtom)

  const setReplayStatus = useSetAtom(projectReplayStatusAtom)

  const lastMsg = useMemo(() => fullHistory.at(-1), [fullHistory])

  const currentMsg = useMemo(() => msgList.at(-1), [msgList])

  const reset = useRefCallback((playing = false) => {
    setReplayStatus((p) => ({ ...p, current: 0, startPlayedAt: Date.now(), seekAt: 0, playing }))
  })
  const seek = useRefCallback((seekAtMs: number) => {
    setReplayStatus((p) => ({ ...p, current: 0, startPlayedAt: Date.now(), seekAt: seekAtMs }))
  })
  const pause = useRefCallback(() => {
    setReplayStatus((p) => ({ ...p, playing: false }))
  })
  const resume = useRefCallback((seekAtMs?: number) => {
    if (seekAtMs == null) {
      setReplayStatus((p) => ({ ...p, playing: true, startPlayedAt: Date.now() }))
    } else {
      setReplayStatus((p) => ({ ...p, playing: true, startPlayedAt: Date.now(), seekAt: seekAtMs }))
    }
  })

  return {
    lastMsg,
    currentMsg,
    reset,
    seek,
    pause,
    resume,
  }
}
