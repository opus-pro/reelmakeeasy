'use client'

import type { AgentHarnessName, AgentMode, AgentSession, AgentTool } from '@shared/types/api/agent'
import { useEffect, useRef, useState } from 'react'

/** The agent page's URL marker for "choose this mode for me": `easy` (a short video's Easy, from
 *  the home page's first-video prompt) or a mode's name (`ranking_easy`, from Ranking Builder). */
export const START_EASY_PARAM = 'start'
const EASY = 'easy'
/** The modes a link may choose (Easy's own marker aside). */
const STARTABLE: readonly AgentMode[] = ['free', 'ranking', 'ranking_easy']
/** The agent page's URL marker for the tool its welcome card shows first. */
export const TOOL_PARAM = 'tool'

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
  /** The mode the marker chooses (default: a short video's Easy). */
  start?: AgentMode
}

type Params = null | { get: (name: string) => null | string }

/** A chat's URL on the agent page: `easy` (a short video's Easy) or `start` adds the marker that
 *  chooses that mode once it opens; `tool` picks the tool its welcome card shows first. */
export function agentChatUrl(
  sessionId: string,
  { easy = false, start, tool }: { easy?: boolean; start?: AgentMode; tool?: AgentTool } = {},
): string {
  const mode = start ?? (easy ? 'autonomous' : undefined)
  const marks = [
    `sessionId=${encodeURIComponent(sessionId)}`,
    ...(mode ? [`${START_EASY_PARAM}=${mode === 'autonomous' ? EASY : mode}`] : []),
    ...(tool ? [`${TOOL_PARAM}=${tool}`] : []),
  ]
  return `/agent?${marks.join('&')}`
}

/** The mode the page URL's marker chooses, or null. */
export function startModeOf(params: Params): AgentMode | null {
  const marker = params?.get(START_EASY_PARAM)
  if (marker === EASY) return 'autonomous'
  return STARTABLE.find((m) => m === marker) ?? null
}

/** Whether the page URL carries a marker that chooses a mode. */
export function startsEasy(params: Params): boolean {
  return startModeOf(params) !== null
}

/** The tool the page URL asks the welcome card to show first, or null. */
export function toolOf(params: Params): AgentTool | null {
  const tool = params?.get(TOOL_PARAM)
  return tool === 'ranking' || tool === 'short' ? tool : null
}

/**
 * Chooses the marker's mode (Easy, autonomous, by default) on the chat's agent once, when the URL
 * carries the marker and the
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
  start = 'autonomous',
}: StartEasyInput): AgentMode | null {
  const doneRef = useRef(false)
  const [starting, setStarting] = useState<AgentMode | null>(null)

  useEffect(() => {
    if (!marked || doneRef.current || !session) return
    doneRef.current = true
    onConsumed()
    if (mode ?? session.mode) return
    setStarting(start)
    void chooseMode(start, session.harness).then((ok) => {
      if (!ok) setStarting(null)
    })
  }, [chooseMode, marked, mode, onConsumed, session, start])

  return starting
}
