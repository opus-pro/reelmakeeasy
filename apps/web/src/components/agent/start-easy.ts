'use client'

import type { AgentHarnessName, AgentMode, AgentSession } from '@shared/types/api/agent'
import { useEffect, useRef, useState } from 'react'

/** The agent page's URL marker for "choose Easy for me" (the home page's first-video prompt). */
export const START_EASY_PARAM = 'start'
const EASY = 'easy'

/** What `useStartEasyOnce` reads from the agent page. */
export interface StartEasyInput {
  chooseMode: (mode: AgentMode, harness?: AgentHarnessName) => Promise<boolean>
  /** The URL carries the Easy marker. */
  marked: boolean
  /** The chat's mode as far as the page knows (the stream's, else the session's); null before. */
  mode: AgentMode | null
  /** Called once the marker has done its job: the page drops it, so a reload doesn't choose. */
  onConsumed: () => void
  /** The loaded session; null until its first read lands. */
  session: AgentSession | null
}

/** A chat's URL on the agent page; `easy` adds the marker that chooses Easy once it opens. */
export function agentChatUrl(sessionId: string, { easy = false }: { easy?: boolean } = {}): string {
  const url = `/agent?sessionId=${encodeURIComponent(sessionId)}`
  return easy ? `${url}&${START_EASY_PARAM}=${EASY}` : url
}

/** Whether the page URL carries the Easy marker. */
export function startsEasy(params: null | { get: (name: string) => null | string }): boolean {
  return params?.get(START_EASY_PARAM) === EASY
}

/**
 * Chooses Easy (autonomous) on the chat's agent once, when the URL carries the marker and the
 * loaded session has no mode yet; either way the marker is then dropped. Returns the mode being
 * started, for the welcome card to show as picked: null when none is, or when the API refused it
 * (the user then picks on the card).
 */
export function useStartEasyOnce({
  chooseMode,
  marked,
  mode,
  onConsumed,
  session,
}: StartEasyInput): AgentMode | null {
  const doneRef = useRef(false)
  const [starting, setStarting] = useState<AgentMode | null>(null)

  useEffect(() => {
    if (!marked || doneRef.current || !session) return
    doneRef.current = true
    onConsumed()
    if (mode ?? session.mode) return
    setStarting('autonomous')
    void chooseMode('autonomous', session.harness).then((ok) => {
      if (!ok) setStarting(null)
    })
  }, [chooseMode, marked, mode, onConsumed, session])

  return starting
}
