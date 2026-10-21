'use client'

import type {
  AgentHarnessName,
  AgentMode,
  AgentSession,
  AgentStatusResponse,
  AgentTool,
} from '@shared/types/api/agent'
import { toast } from '@shared/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import { hardNavigate } from '@/util/hard-navigation'

import { anyHarnessReady, unavailableMessage } from './agent-harness'
import { agentChatUrl } from './start-easy'

const START_FAILED_MESSAGE =
  "Couldn't start an Agent session. Check that Codex or Claude Code is signed in, then try again."

/**
 * Starts an agent chat: checks Codex's and Claude Code's live status (`?refresh=1` skips the server's 30 s
 * cache), creates the session and opens it. A not-available result or a failed request
 * shows a toast. `hard`: open it with a full page load (from any page but /agent: /agent is
 * cross-origin isolated only when its document loads with its own headers); otherwise a
 * client navigation (already on /agent). `start` resolves true once the chat is opening, and
 * false at once while another start is under way (one chat per click, however fast the clicks).
 */
export function useStartAgentSession({ hard }: { hard: boolean }) {
  const { fetchApiDomain } = useApi()
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  // Set synchronously: two clicks before React re-renders both see `starting` false.
  const inFlight = useRef(false)

  /** `harness`: the agent picked in the Agent dialog (which already checked it is ready).
   *  `easy`: the chat opens with Easy already chosen (the home page's first-video prompt);
   *  `mode`: with that mode chosen (Ranking Builder's "Make one with the agent"); `tool`: its
   *  welcome card shows that tool first. */
  const start = useCallback(
    async (
      harness?: AgentHarnessName,
      { easy = false, mode, tool }: { easy?: boolean; mode?: AgentMode; tool?: AgentTool } = {},
    ) => {
      if (inFlight.current) return false
      inFlight.current = true
      setStarting(true)
      // Stays true while a full page load leaves, so a second click can't start another chat.
      let leaving = false
      try {
        if (!harness) {
          const { data: status } = await fetchApiDomain<AgentStatusResponse>(
            '/api/agent/status?refresh=1',
            { method: 'GET' },
          )
          if (!anyHarnessReady(status)) {
            toast.error(unavailableMessage(status) || START_FAILED_MESSAGE)
            return false
          }
        }
        const { data: session } = await fetchApiDomain<AgentSession>('/api/agent/sessions', {
          data: harness ? { harness } : {},
          method: 'POST',
        })
        const url = agentChatUrl(session.id, {
          easy,
          ...(mode ? { start: mode } : {}),
          ...(tool ? { tool } : {}),
        })
        if (hard) {
          leaving = true
          hardNavigate(url)
        } else {
          router.push(url)
        }
        return true
      } catch {
        toast.error(START_FAILED_MESSAGE)
        return false
      } finally {
        if (!leaving) {
          inFlight.current = false
          setStarting(false)
        }
      }
    },
    [fetchApiDomain, hard, router],
  )

  return { start, starting }
}
