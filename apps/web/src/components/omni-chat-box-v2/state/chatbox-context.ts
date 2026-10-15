import { createContext, useContext } from 'react'

import type { ChatBoxState } from './chatbox-state'

const ChatBoxStateContext = createContext<ChatBoxState | null>(null)

export const ChatBoxStateProvider = ChatBoxStateContext.Provider

export function useChatBoxState(): ChatBoxState {
  const state = useContext(ChatBoxStateContext)
  if (!state) {
    throw new Error('useChatBoxState must be used within ChatBoxStateProvider')
  }
  return state
}
