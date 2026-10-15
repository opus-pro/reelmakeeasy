import { EmbeddedBlockMessage } from './message-embedded-block'
import { PatchEventMessage } from './message-patch-event'
import { ChatBoxFrontEndExtra } from './shared'

export type AgentStreamMessage = ChatBoxFrontEndExtra & {
  agentName?: string

  /** only for embedded-block */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: any
  id?: string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any
  role: 'agent' | 'embedded-block' | 'tool' | 'user'
  text?: string
  toolName?: string
  type:
    | 'confirm-timer'
    | 'finish'
    | 'reasoning'
    | 'source'
    | 'text'
    | 'text-delta'
    | 'tool-call'
    | 'tool-result'
    | 'UserIntentTag'
}
export type ChatBoxMessage = AgentStreamMessage | EmbeddedBlockMessage | PatchEventMessage
export type RawAgentStreamMessage = OmitDates<AgentStreamMessage>
export type RawChatBoxMessage =
  | RawAgentStreamMessage
  | RawEmbeddedBlockMessage
  | RawPatchEventMessage
export type RawEmbeddedBlockMessage = OmitDates<EmbeddedBlockMessage>
export type RawPatchEventMessage = OmitDates<PatchEventMessage>

type OmitDates<T> = Omit<T, 'createdAt' | 'updatedAt'>
