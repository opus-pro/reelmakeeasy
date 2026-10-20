'use client'

import type { AgentHarnessName, AgentMode, AgentStatusResponse } from '@shared/types/api/agent'
import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { HARNESS_LABEL, HARNESS_SHORT, harnessChoices, initialHarness } from './agent-harness'
import { Spinner } from './Spinner'

export type WelcomeCardProps = {
  /** The harness the chat runs on once chosen (the session's); null until then. */
  chosenHarness?: AgentHarnessName | null
  /** The session's mode once the `mode` event arrived; null until then. */
  mode: AgentMode | null
  onChoose: (mode: AgentMode, harness?: AgentHarnessName) => Promise<boolean>
  /** The agent picked in the Agent dialog before the chat opened: no switch, just its name. */
  presetHarness?: AgentHarnessName | null
  /** A mode the page is choosing for the user (Easy, from the home page's first-video prompt):
   *  shown and locked like a click on it. */
  startingMode?: AgentMode | null
  /** Which harnesses can run the chat (null while loading, or when the check failed). */
  status?: AgentStatusResponse | null
}

const MODE_OPTIONS: {
  description: (agent: string) => string
  label: string
  mode: AgentMode
  recommended: boolean
}[] = [
  {
    description: () =>
      'We find a fun fact, a news story or a famous figure. You pick one and a style, and we make the whole video.',
    label: 'Easy (Guided)',
    mode: 'autonomous',
    recommended: true,
  },
  {
    description: (agent) => `Talk with ${agent} about anything for your video.`,
    label: 'Advanced (Free chat)',
    mode: 'free',
    recommended: false,
  },
  {
    description: (agent) =>
      `Build a ranking short with ${agent}: paste a YouTube Short to copy its style, attach your clips, and get the meme sounds on every action.`,
    label: 'Ranking short',
    mode: 'ranking',
    recommended: false,
  },
]

/**
 * The first thing in every agent chat, rendered locally (no request needed): how
 * the session should start. A click posts the mode; the card stays locked (the
 * clicked option spinning) until the `mode` event marks the choice with a check.
 * A refused choice unlocks it again.
 */
export function WelcomeCard({
  chosenHarness,
  mode,
  onChoose,
  presetHarness,
  startingMode,
  status,
}: WelcomeCardProps) {
  const [clicked, setClicked] = useState<AgentMode | null>(null)
  const pending = clicked ?? startingMode ?? null
  const choices = harnessChoices(status ?? null)
  const [harness, setHarness] = useState<AgentHarnessName>(() => initialHarness(status ?? null))
  // The status arrives after the first render: preselect once it does, until the user picks.
  const pickedRef = useRef(false)
  useEffect(() => {
    if (!pickedRef.current) setHarness(initialHarness(status ?? null))
  }, [status])
  const agent = HARNESS_SHORT[chosenHarness ?? presetHarness ?? harness]
  // Mirrors `clicked` synchronously, so two clicks in one render can't both choose.
  const inFlightRef = useRef(false)

  const locked = mode !== null || pending !== null

  const choose = async (next: AgentMode) => {
    if (locked || inFlightRef.current) return
    inFlightRef.current = true
    setClicked(next)
    // A preset agent is already on the chat; with none known the server's default is used.
    const ok = await (presetHarness || !choices.length ? onChoose(next) : onChoose(next, harness))
    // On success stay locked until the `mode` event arrives.
    if (!ok) {
      inFlightRef.current = false
      setClicked(null)
    }
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-3 rounded-xl border border-white/10 bg-fill-secondary/50 p-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-primary">What would you like to do?</p>
        <p className="text-xs text-secondary">
          {agent} is your creative partner here. New to this? Start with Easy.
        </p>
      </div>
      {mode === null && presetHarness && (
        <p className="text-xs text-secondary">Running on {HARNESS_LABEL[presetHarness]}</p>
      )}
      {mode === null && !presetHarness && choices.length > 1 && (
        <div className="flex flex-col gap-1">
          <div className="flex w-fit rounded-lg border border-white/10 p-0.5" role="radiogroup">
            {choices.map((choice) => (
              <button
                aria-checked={harness === choice.harness}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  harness === choice.harness
                    ? 'bg-white/15 text-primary'
                    : 'text-secondary hover:text-primary',
                )}
                disabled={locked || !!choice.disabledReason}
                key={choice.harness}
                onClick={() => {
                  pickedRef.current = true
                  setHarness(choice.harness)
                }}
                role="radio"
                title={choice.disabledReason}
                type="button"
              >
                {HARNESS_LABEL[choice.harness]}
              </button>
            ))}
          </div>
          {choices
            .filter((c) => c.disabledReason)
            .map((c) => (
              <p className="text-xs text-secondary" key={c.harness}>
                {c.disabledReason}
              </p>
            ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {MODE_OPTIONS.map((option) => {
          const chosen = mode === option.mode
          const spinning = mode === null && pending === option.mode
          return (
            <button
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                'disabled:cursor-default',
                // Every option has the same border, so the Recommended one never looks chosen;
                // only its badge marks it.
                'border-white/10',
                chosen && 'border-white/40 bg-white/10',
                mode !== null && !chosen && 'opacity-50',
                !locked && 'hover:bg-white/5',
              )}
              disabled={locked}
              key={option.mode}
              onClick={() => void choose(option.mode)}
              type="button"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-primary">{option.label}</span>
                  {option.recommended && (
                    <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
                      Recommended
                    </span>
                  )}
                </span>
                <span className="text-xs break-words text-secondary">
                  {option.description(agent)}
                </span>
              </span>
              {spinning && <Spinner className="mt-1 text-secondary" />}
              {chosen && <span className="text-sm text-accent-green">✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
