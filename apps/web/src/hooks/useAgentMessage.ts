import { removeHeadingEndingQuotes } from '@reelmakeeasy/common/agent/remove-quote'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { ChatBoxMessage, RawAgentStreamMessage } from '@shared/types/chat/message'
import { AGENT_NAMES, type AgentName } from '@shared/types/enums/agent-name'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { activeProjectMessageList } from '@/atom/project'

const nsLogger = Logger.get('agent-message')

export const convertToolMessage = (msg: ChatBoxMessage) => {
  const text = (msg as RawAgentStreamMessage).text
  const rawStr = (msg as RawAgentStreamMessage).raw
  let raw = (msg as RawAgentStreamMessage).raw
  if (typeof rawStr === 'string') {
    try {
      raw = JSON.parse(removeHeadingEndingQuotes(rawStr))
    } catch (error) {
      nsLogger.error('Error parsing raw string:', rawStr, error)
    }
  }
  if (text) {
    return { ...msg, text: removeHeadingEndingQuotes(text), raw }
  }
  return { ...msg, raw, text: '' }
}

export function useLastNToolMessageByAgentName(agentName: AgentName, maxLine = 5) {
  const projectMsg = useAtomValue(activeProjectMessageList)
  const msgList = useMemo(() => {
    return projectMsg
      .filter((msg) => msg.role === 'tool' && msg.agentName === agentName)
      .slice(-maxLine)
      .map((msg) => convertToolMessage(msg))
  }, [projectMsg, agentName])

  return { msgList }
}

const useFirstToolMessageByAgentName = (agentName: AgentName) => {
  const projectMsg = useAtomValue(activeProjectMessageList)
  return useMemo(() => {
    return projectMsg
      .filter((msg) => msg.role === 'tool' && msg.agentName === agentName)
      .map((msg) => convertToolMessage(msg))
      .at(0)
  }, [projectMsg, agentName])
}

export const P95_PROCESS_MINUTES_BY_AGENT_NAME: Partial<Record<AgentName, number>> = {
  [AGENT_NAMES.SCRIPT_WRITER]: 4,
  [AGENT_NAMES.HOOK_EXPERT]: 14,
  [AGENT_NAMES.RESEARCHER]: 18,
  [AGENT_NAMES.STORYBOARD_ARTIST]: 28,
  [AGENT_NAMES.MOTION_DESIGNER]: 26,
}

export const getActionProgressByAgentName = (agentName: AgentName, settled = false) => {
  const firstMsg = useFirstToolMessageByAgentName(agentName)
  const { msgList: lastMsgList } = useLastNToolMessageByAgentName(agentName, 1)
  const lastMsg = lastMsgList.at(0)
  if (!firstMsg || !firstMsg.createdAt || !lastMsg || !lastMsg.createdAt) {
    return 0
  }

  if (settled) {
    return 100
  }
  // computed eta time via P195 data, max as 95%
  const startTime = new Date(firstMsg.createdAt).getTime()
  const p95Duration = (P95_PROCESS_MINUTES_BY_AGENT_NAME[agentName] ?? 5) * 60 * 1000
  const etaTime = startTime + p95Duration
  const currentTime = new Date(lastMsg.createdAt).getTime()
  if (currentTime >= etaTime) {
    return 95
  }
  return Math.floor(((currentTime - startTime) / p95Duration) * 100)
}

export const useCheckThinking = () => {
  const msgList = useAtomValue(activeProjectMessageList)
  const lastEntry = msgList.at(-1)
  const lastEntryIsReasoning = lastEntry?.type === 'reasoning'
  const lastEntryIsEvent = lastEntry?.role === 'event'
  const lastEntryIsUser = lastEntry?.role === 'user'

  // Check if msgList ends with embedded-block + consecutive events (optimized with useMemo)
  const shouldHideThinking = useMemo(() => {
    if (msgList.length < 2) {
      return false
    }

    // Quick check: if last entry is not an event, no need to continue
    if (lastEntry?.role !== 'event') {
      return false
    }

    // Limit traversal depth for performance (usually events don't exceed 10-20)
    const maxDepth = Math.min(20, msgList.length - 1)
    let i = msgList.length - 1

    // Skip consecutive events from the end (with depth limit)
    while (i >= 0 && msgList[i]?.role === 'event' && msgList.length - 1 - i < maxDepth) {
      i--
    }

    // Check if the message before consecutive events is embedded-block
    return i >= 0 && msgList[i]?.role === 'embedded-block'
  }, [msgList, lastEntry?.role])

  return (lastEntryIsEvent || lastEntryIsUser || lastEntryIsReasoning) && !shouldHideThinking
}
