import {
  EmbeddedBlockMessage,
  EmbeddedSourceBlock,
} from '@shared/types/chat/message-embedded-block'
import { AGENT_NAMES } from '@shared/types/enums/agent-name'

import { Files } from '@/components/icons/core'

import { useDisplayMedia } from '../../hooks/useDisplayMedia'

import { useSourceData } from './hooks/useSourceData'
import { ConfirmedTaskBlock } from './confirmed-task-block'

export default function SourceBlock({ msg }: { msg: EmbeddedSourceBlock }) {
  const { playCard } = useDisplayMedia()
  const sourceData = useSourceData()

  const content = msg.content
  const { ready, data } = content
  // for some legacy card, there is no ready field
  const readyWithFallback = ready ?? data.length !== 0

  const handleClick = () => {
    if (!readyWithFallback) {
      return
    }
    playCard(msg as unknown as EmbeddedBlockMessage)
  }

  const textContent = readyWithFallback
    ? `${sourceData.length} related references and articles found`
    : 'Searching the web for references...'

  return (
    <ConfirmedTaskBlock
      agentName={AGENT_NAMES.RESEARCHER}
      icon={<Files className="size-10" />}
      onClick={handleClick}
      ready={readyWithFallback}
      text={textContent}
      title="Assets"
    />
  )
}
