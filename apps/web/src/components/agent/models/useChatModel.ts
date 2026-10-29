'use client'

import type { ChatModelChoice, ChatModelState } from '@shared/types/api/agent'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'

import { getChatModel, setChatModel, setDefaultChatModel } from './chat-model'

/** A chat's model: what it runs on, what its harness offers, and the picks that change it. */
export type ChatModel = ReturnType<typeof useChatModel>

const ChatModelContext = createContext<ChatModel | null>(null)

/** The open chat's model, shared by the model bar and a setup card's Effort slider so a pick in
 *  one shows in the other. */
export const ChatModelProvider = ChatModelContext.Provider

/** The open chat's model, or null outside a `ChatModelProvider`. */
export const useSharedChatModel = (): ChatModel | null => useContext(ChatModelContext)

/** `key` changes when the chat's agent or mode does (a Claude Animation moves a Codex chat to
 *  Claude Code; a Motion Reel pins its model): the model is asked again then. */
export function useChatModel(sessionId: null | string | undefined, enabled: boolean, key = '') {
  const { fetchApiDomain } = useApi()
  const [state, setState] = useState<ChatModelState | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (work: () => Promise<ChatModelState>) => {
    setBusy(true)
    try {
      setState(await work())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    setState(null)
    if (!sessionId || !enabled) return
    void run(() => getChatModel(fetchApiDomain, sessionId))
  }, [enabled, fetchApiDomain, key, run, sessionId])

  const id = sessionId ?? ''
  return {
    busy,
    error,
    pick: (choice: ChatModelChoice | null) => run(() => setChatModel(fetchApiDomain, id, choice)),
    refresh: () => run(() => getChatModel(fetchApiDomain, id, true)),
    setDefault: (choice: ChatModelChoice | null) =>
      run(() => setDefaultChatModel(fetchApiDomain, id, choice)),
    state,
  }
}
