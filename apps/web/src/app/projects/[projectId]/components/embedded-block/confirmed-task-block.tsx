import { AgentName } from '@shared/types/enums/agent-name'
import { cn } from '@shared/ui'
import { memo } from 'react'

import { FileText, SemiArrowRightSmall } from '@/components/icons/core'

import InnerAgentLogBlock from './inner-agent-log-block'

interface TaskIconContainerProps {
  icon?: React.ReactNode
}

/**
 * Icon container component for task blocks
 */
const TaskIconContainer: React.FC<TaskIconContainerProps> = memo(({ icon }) => {
  return (
    <div className="relative shrink-0 flex items-center justify-center text-secondary">
      {icon || <FileText className="size-6" />}
    </div>
  )
})

TaskIconContainer.displayName = 'TaskIconContainer'

interface TaskTitleAndTextProps {
  lineClamp?: 1 | 3
  text?: React.ReactNode | string
  title?: string
}

/**
 * Title and text component for task blocks
 */
const TaskTitleAndText: React.FC<TaskTitleAndTextProps> = memo(({ lineClamp = 3, text, title }) => {
  return (
    <div className={cn('flex flex-col flex-1 min-w-0 justify-center')}>
      <p className="text-primary font-medium text-sm leading-[17px]">{title}</p>
      {typeof text === 'string' ? (
        <p
          className={cn(
            'text-secondary text-xs leading-5 truncate',
            lineClamp === 1 ? 'line-clamp-1' : 'line-clamp-3',
          )}
        >
          {text}
        </p>
      ) : (
        text
      )}
    </div>
  )
})

TaskTitleAndText.displayName = 'TaskTitleAndText'

interface ConfirmedTaskBlockProps {
  agentName?: AgentName
  icon?: React.ReactNode
  onClick?: () => void
  ready?: boolean
  text?: React.ReactNode | string
  title?: string
}

/**
 * Confirmed task block component - compact horizontal layout for confirmed tasks
 * Used by SourceBlock and other components that only need confirmed state
 */
export const ConfirmedTaskBlock: React.FC<ConfirmedTaskBlockProps> = memo(
  ({ agentName, icon, onClick, ready, text, title = 'Transcript' }) => {
    return (
      <div className="flex flex-col gap-2">
        {agentName && <InnerAgentLogBlock agentName={agentName} settled={ready} />}
        {ready && (
          <div
            className={cn(
              'bg-fill-secondary hover:bg-fill-hover overflow-clip relative rounded-xl w-full cursor-pointer',
              'flex flex-row items-center gap-3 px-4 py-3',
            )}
            onClick={onClick}
          >
            <TaskIconContainer icon={icon} />
            <TaskTitleAndText lineClamp={1} text={text} title={title} />
            <div className="shrink-0 flex items-center">
              <SemiArrowRightSmall className="size-4 text-secondary" />
            </div>
          </div>
        )}
      </div>
    )
  },
)

ConfirmedTaskBlock.displayName = 'ConfirmedTaskBlock'
