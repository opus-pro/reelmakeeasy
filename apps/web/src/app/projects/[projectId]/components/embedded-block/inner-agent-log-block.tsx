import { RawAgentStreamMessage } from '@shared/types/chat/message'
import { AgentName } from '@shared/types/enums/agent-name'
import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'

import { projectReplayModeAtom } from '@/atom/project'
import { CheckMark, ChevronDownSmall, QuestionLoading } from '@/components/icons/core'
import {
  getActionProgressByAgentName,
  useLastNToolMessageByAgentName,
} from '@/hooks/useAgentMessage'

interface InnerAgentLogBlockProps {
  agentName: AgentName
  maxLines?: number
  settled?: boolean
}
interface StepStatus {
  id: string
  status: 'completed' | 'pending'
  text: string
  type: 'tool-call' | 'tool-result'
}

export default function InnerAgentLogBlock({
  agentName,
  maxLines = 5,
  settled = false,
}: InnerAgentLogBlockProps) {
  const replayMode = useAtomValue(projectReplayModeAtom)
  const { msgList } = useLastNToolMessageByAgentName(agentName, maxLines * 2)
  const percent = getActionProgressByAgentName(agentName, settled)
  const [expanded, setExpanded] = useState(settled)
  const logStepsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setExpanded(!settled)
  }, [settled])

  // Convert messages to steps with status
  const steps = useMemo<StepStatus[]>(() => {
    const init: StepStatus[] = []
    return (
      msgList
        .filter((i) => (i as RawAgentStreamMessage).text)
        .map((i, index) => {
          const item = i as RawAgentStreamMessage
          const id = item.raw?.toolCallId || `step-${index}`
          const type = item.raw?.type
          const status = type === 'tool-result' ? 'completed' : 'pending'
          return {
            id,
            text: item.text || '',
            type,
            status,
          } as StepStatus
        })
        .filter((i) => (settled ? i.status === 'completed' : true))
        // remove duplicate id, pick the completed one
        .reduce((acc, curr) => {
          const foundIndex = acc.findIndex((i) => i.id === curr.id)
          if (foundIndex !== -1) {
            const found = acc[foundIndex]
            if (found.status === 'completed') {
              return acc
            }
            return [...acc.slice(0, foundIndex), curr, ...acc.slice(foundIndex + 1)]
          }

          return [...acc, curr]
        }, init)
    )
  }, [msgList, settled])

  const lastStep = steps.slice(-1)?.[0]

  useEffect(() => {
    const container = logStepsContainerRef.current
    if (!container || !expanded) {
      return
    }
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    })
  }, [steps.length, expanded])

  if (!steps.length) {
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-col w-full h-full text-sm',
        replayMode && expanded && 'max-h-[100px] overflow-hidden',
      )}
    >
      <div
        className="text-secondary flex cursor-pointer flex-row items-center justify-start leading-5 text-xs hover:text-white transition-colors duration-200 group/header"
        onClick={() => setExpanded(!expanded)}
      >
        <span>Executing</span>
        <div className="ml-1 shrink-0">{percent}%</div>
        <ChevronDownSmall
          className={cn(
            'w-[12px] h-[12px] inline-block transition-all duration-300 mx-0.5 flex-shrink-0 group-hover/header:text-white pointer-events-none',
            expanded ? 'rotate-0' : '-rotate-90',
          )}
        />
        {!expanded && percent !== 100 && <div className="flex-1 truncate">{lastStep?.text}</div>}
      </div>
      <div
        className={cn('relative transition-all duration-300', expanded && 'mt-1')}
        style={
          expanded ? { height: Math.min(steps.length, 5) * 20 + 5 } : { height: 0, opacity: 0 }
        }
      >
        <div className="h-full overflow-y-auto scrollbar-hide pb-2" ref={logStepsContainerRef}>
          {steps.map((step) => (
            <div
              className={cn('flex w-full flex-1 items-center justify-center gap-1 text-secondary')}
              key={step.id}
            >
              <div>
                {step.status === 'completed' && <CheckMark className="size-4.5" />}
                {step.status === 'pending' && <QuestionLoading className="size-4.5 animate-spin" />}
              </div>
              <div
                className={cn('flex-1 text-xs transition-opacity duration-300 truncate leading-5')}
              >
                {step.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
