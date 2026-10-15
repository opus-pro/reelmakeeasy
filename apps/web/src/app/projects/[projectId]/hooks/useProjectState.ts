import { Logger } from '@reelmakeeasy/common/utils/logger'
import { ChatBoxMessage } from '@shared/types/chat/message'
import { useAtom, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import {
  projectHistoryAtom,
  projectReplayFullHistoryAtom,
  ReplayMsgDuration,
  replayMsgListAtom,
} from '@/atom/project'
import { useProjectId } from '@/contexts/ProjectContext'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { mergeChatMessage } from './merge-chat-message'
import { useFetchHistory } from './useFetchHistory'
import { calculateMsgReplayDuration } from './useReplayMsgList'

const nsLogger = Logger.get('project.project-state')

// The replay duration config has no entries, so every message resolves to an
// undefined duration (matching the previous remote-config fallback).
const NO_REPLAY_DURATION_CONFIG = {} as ReplayMsgDuration

export function useLoadHistoryMessages() {
  const { projectId } = useProjectId()
  const { history, isLoading } = useFetchHistory(projectId)
  const [msgList, setProjectHistory] = useAtom(projectHistoryAtom)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!history || isLoading || loaded) {
      return
    }

    nsLogger.warn('reload for history changes')
    setProjectHistory(
      history.reduce((acc, curr) => mergeChatMessage(acc, curr), [] as ChatBoxMessage[]),
    )
    setLoaded(true)
  }, [history, loaded, isLoading])

  return { msgList, loaded }
}

export function useLoadReplayMessage() {
  const { projectId } = useProjectId()
  const { history } = useFetchHistory(projectId)
  const setFullHistory = useSetAtom(projectReplayFullHistoryAtom)
  const [msgList, setReplayMsgList] = useAtom(replayMsgListAtom)
  const [loaded, setLoaded] = useState(false)
  const loadOnceRef = useRef(false)

  const updateFullHistory = useRefCallback((history: ChatBoxMessage[]) => {
    setFullHistory(calculateMsgReplayDuration(history, NO_REPLAY_DURATION_CONFIG))
  })

  useEffect(() => {
    if (!history) {
      return
    }
    if (loaded) {
      return
    }
    if (loadOnceRef.current) {
      return
    }

    loadOnceRef.current = true

    updateFullHistory(history)
    setReplayMsgList([])
    setLoaded(true)
  }, [history, loaded])

  return { msgList, loaded }
}
