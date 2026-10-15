'use client'

import type { ChatModelChoice, ChatModelState } from '@shared/types/api/agent'
import { useCallback, useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'

import { getChatModel, setChatModel, setDefaultChatModel } from './chat-model'

/** A chat's model: what it runs on, what its harness offers, and the picks that change it. */
export type ChatModel = ReturnType<typeof useChatModel>

export function useChatModel(sessionId: null | string | undefined, enabled: boolean) {
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
  }, [enabled, fetchApiDomain, run, sessionId])

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
