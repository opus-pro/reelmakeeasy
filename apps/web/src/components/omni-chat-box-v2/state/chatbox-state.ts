import { createBaseState } from '@/lib/jotai-base-state'
import type { JotaiStore } from '@/lib/jotai-types'

export type ChatBoxState = ReturnType<typeof createChatBoxState>

let NEXT_CHAT_BOX_ID = 0

export function createChatBoxState(store: JotaiStore) {
  return {
    ...createBaseState(store),
    id: NEXT_CHAT_BOX_ID++,
  }
}
