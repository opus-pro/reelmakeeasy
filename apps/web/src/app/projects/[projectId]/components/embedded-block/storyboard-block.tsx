import { EmbeddedStoryboardBlock } from '@shared/types/chat/message-embedded-block'
import { AGENT_NAMES } from '@shared/types/enums/agent-name'

import InnerAgentLogBlock from './inner-agent-log-block'

export default function StoryboardBlock({ msg }: { msg: EmbeddedStoryboardBlock }) {
  const ready = msg.content?.ready ?? false
  return (
    <div className="flex flex-col gap-2">
      <InnerAgentLogBlock agentName={AGENT_NAMES.STORYBOARD_ARTIST} settled={ready} />
    </div>
  )
}
