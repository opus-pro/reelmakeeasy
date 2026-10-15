'use client'

import type { AgentResumeAction } from '@shared/types/api/agent'
import { Button } from '@shared/ui'
import { useRef, useState } from 'react'

import { Spinner } from './Spinner'

export const RESUME_LINE =
  'ReelMakeEasy restarted before your video was made. Your answers are saved.'
export const RESUME_BUTTON = 'Pick up where you left off'

/**
 * The line and button for picking up a chat a restart cut off, saying what the click does
 * (`action`, from the API's view of the chat): a click that starts a paid run at once says so,
 * with the loop's price as its card showed it. Anything else asks a card first: the plain words.
 */
export function resumeWords(action: AgentResumeAction | undefined): {
  button: string
  line: string
} {
  if (action?.kind === 'make_loop') {
    const price = action.costUsd === undefined ? '' : `: about $${action.costUsd.toFixed(2)}`
    return {
      button: 'Make it now',
      line: `Your loop wasn't started before ReelMakeEasy stopped. Picking up makes it now${price}.`,
    }
  }
  if (action?.kind === 'start_video') {
    return {
      button: 'Start the video',
      line: "Your video wasn't started before ReelMakeEasy stopped. Picking up starts it now.",
    }
  }
  return { button: RESUME_BUTTON, line: RESUME_LINE }
}

/** Under an Easy chat a restart cut off: one button that carries it on from where it stopped. */
export function ResumeCard({
  action,
  onResume,
}: {
  action?: AgentResumeAction
  onResume: () => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  // Mirrors `busy` synchronously, so a double click picks up once.
  const busyRef = useRef(false)
  const words = resumeWords(action)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
      <p className="text-sm text-primary">{words.line}</p>
      <Button
        className="h-9 shrink-0 rounded-lg px-3"
        disabled={busy}
        onClick={() => {
          if (busyRef.current) return
          busyRef.current = true
          setBusy(true)
          void onResume().finally(() => {
            busyRef.current = false
            setBusy(false)
          })
        }}
        type="button"
      >
        {busy && <Spinner className="mr-1.5" />}
        {words.button}
      </Button>
    </div>
  )
}
