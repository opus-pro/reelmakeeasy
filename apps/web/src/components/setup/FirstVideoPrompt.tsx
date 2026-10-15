'use client'

import type { SetupStatus } from '@shared/types/api/setup'
import { useEffect, useState } from 'react'

import { useStartAgentSession } from '@/components/agent/useStartAgentSession'

import {
  easyHarness,
  EXAMPLE_IDEA,
  firstVideoAnswered,
  rememberFirstVideoAnswered,
  setupComplete,
  shouldAskFirstVideo,
} from './first-video'
import { FirstVideoDialog } from './FirstVideoDialog'
import { useHasProjects } from './useHasProjects'

export interface FirstVideoPromptProps {
  /** The Get set up card is on screen: never ask over it. */
  cardShowing: boolean
  /** The setup status is being read. */
  checking: boolean
  /** True while the prompt may still open or is open, so the home page holds its tour. */
  onBusyChange?: (busy: boolean) => void
  /** "Try an example" (no agent can run Easy): put this idea in the home box and focus it. */
  onTryExample?: (idea: string) => void
  status: null | SetupStatus
}

/**
 * "Make your first video?" on the home page, for a user with no project yet once setup is
 * complete (on load, or right after the Get set up card's Save). Not now and Go are remembered
 * in this browser; closing it without either only hides it until the next visit. Go opens a new
 * agent chat with Easy already chosen; with no agent ready, Try an example fills in an idea.
 */
export function FirstVideoPrompt({
  cardShowing,
  checking,
  onBusyChange,
  onTryExample,
  status,
}: FirstVideoPromptProps) {
  const [answered, setAnswered] = useState(firstVideoAnswered)
  // Closed without an answer (the close button, Escape, a click outside): hidden for this
  // visit only, so a reload asks again. Only Not now and Go are remembered.
  const [dismissed, setDismissed] = useState(false)
  const { start, starting } = useStartAgentSession({ hard: true })
  const lookForVideos = setupComplete(status) && !cardShowing && !answered
  const { hasProjects, loading } = useHasProjects(lookForVideos)
  const open = !dismissed && shouldAskFirstVideo({ answered, cardShowing, hasProjects, status })
  const busy = open || (!answered && checking && status === null) || (lookForVideos && loading)

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const generation = status?.generation.effective
  if (!status || !generation) return null
  const harness = easyHarness(status)

  const notNow = () => {
    rememberFirstVideoAnswered()
    setAnswered(true)
  }

  const startFirstVideo = async () => {
    rememberFirstVideoAnswered()
    if (!harness) {
      setAnswered(true)
      onTryExample?.(EXAMPLE_IDEA)
      return
    }
    // On success the page is leaving for the chat: keep the dialog until it has.
    if (!(await start(harness, { easy: true }))) setAnswered(true)
  }

  return (
    <FirstVideoDialog
      canStartEasy={harness !== null}
      generation={generation}
      onDismiss={() => setDismissed(true)}
      onNotNow={notNow}
      onStart={() => void startFirstVideo()}
      open={open}
      starting={starting}
    />
  )
}
