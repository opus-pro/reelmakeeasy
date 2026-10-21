'use client'

import {
  AGENT_TOOL_MODES,
  type AgentHarnessName,
  type AgentMode,
  type AgentStatusResponse,
  type AgentTool,
  toolOfMode,
} from '@shared/types/api/agent'
import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { ClipsVertical, Film } from '@/components/icons/core'

import { HARNESS_LABEL, HARNESS_SHORT, harnessChoices, initialHarness } from './agent-harness'
import { Spinner } from './Spinner'

export type WelcomeCardProps = {
  /** The harness the chat runs on once chosen (the session's); null until then. */
  chosenHarness?: AgentHarnessName | null
  /** The tool shown first (a link from Ranking Builder shows Ranking); default Short video. */
  firstTool?: AgentTool | null
  /** The session's mode once the `mode` event arrived; null until then. */
  mode: AgentMode | null
  onChoose: (mode: AgentMode, harness?: AgentHarnessName) => Promise<boolean>
  /** The agent picked in the Agent dialog before the chat opened: no switch, just its name. */
  presetHarness?: AgentHarnessName | null
  /** A mode the page is choosing for the user (Easy, from the home page's first-video prompt,
   *  or Ranking's Easy, from Ranking Builder): shown and locked like a click on it. */
  startingMode?: AgentMode | null
  /** Which harnesses can run the chat (null while loading, or when the check failed). */
  status?: AgentStatusResponse | null
}

type ModeOption = {
  description: (agent: string) => string
  label: string
  mode: AgentMode
  recommended: boolean
}

type ToolOption = {
  icon: React.ComponentType<{ className?: string }>
  key: AgentTool
  label: string
  modes: [ModeOption, ModeOption]
}

const SHORT_VIDEO: ToolOption = {
  icon: Film,
  key: 'short',
  label: 'Short video',
  modes: [
    {
      description: () =>
        'We find a fun fact, a news story or a famous figure. You pick one and a style, and we make the whole video.',
      label: 'Easy (Guided)',
      mode: AGENT_TOOL_MODES.short.easy,
      recommended: true,
    },
    {
      description: (agent) => `Talk with ${agent} about anything for your video.`,
      label: 'Advanced (Free chat)',
      mode: AGENT_TOOL_MODES.short.advanced,
      recommended: false,
    },
  ],
}

/** The tools, each with its Easy (guided) and Advanced (free chat) mode. */
const TOOLS: ToolOption[] = [
  SHORT_VIDEO,
  {
    icon: ClipsVertical,
    key: 'ranking',
    label: 'Ranking',
    modes: [
      {
        description: () =>
          'Answer a few quick questions: a YouTube Short to copy, your sounds, how many ranks, your photos or AI clips. We build the ranking for you.',
        label: 'Easy (Guided)',
        mode: AGENT_TOOL_MODES.ranking.easy,
        recommended: true,
      },
      {
        description: (agent) =>
          `Chat freely with ${agent} about your ranking short, and open it in the editor any time.`,
        label: 'Advanced (Free chat)',
        mode: AGENT_TOOL_MODES.ranking.advanced,
        recommended: false,
      },
    ],
  },
]

/**
 * The first thing in every agent chat, rendered locally (no request needed): what to make (the
 * tool) and how (Easy, guided, or Advanced, free chat). A click posts the mode; the card stays
 * locked (the clicked option spinning) until the `mode` event marks the choice with a check.
 * A refused choice unlocks it again.
 */
export function WelcomeCard({
  chosenHarness,
  firstTool,
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
  const [picked, setPicked] = useState<AgentTool>(firstTool ?? 'short')
  // Once a mode is chosen or starting, the card shows its tool.
  const settled = mode ?? pending
  const toolKey = settled ? toolOfMode(settled) : picked
  const tool = TOOLS.find((t) => t.key === toolKey) ?? SHORT_VIDEO

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
        <p className="text-sm font-semibold text-primary">What would you like to make?</p>
        <p className="text-xs text-secondary">
          {agent} is your creative partner here. New to this? Start with Easy.
        </p>
      </div>
      <div
        aria-label="Tool"
        className="flex w-full gap-1 rounded-lg bg-black/25 p-1"
        role="tablist"
      >
        {TOOLS.map((option) => {
          const selected = option.key === tool.key
          const Icon = option.icon
          return (
            <button
              aria-selected={selected}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-default',
                selected ? 'bg-white/15 text-primary' : 'text-secondary',
                !locked && !selected && 'hover:bg-white/5 hover:text-primary',
                locked && !selected && 'opacity-50',
              )}
              disabled={locked}
              key={option.key}
              onClick={() => setPicked(option.key)}
              role="tab"
              type="button"
            >
              <Icon className="size-4" />
              {option.label}
            </button>
          )
        })}
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
      <div className="flex flex-col gap-1.5" role="tabpanel">
        {tool.modes.map((option) => (
          <ModeButton
            agent={agent}
            key={option.mode}
            locked={locked}
            mode={mode}
            onChoose={(next) => void choose(next)}
            option={option}
            pending={pending}
          />
        ))}
      </div>
    </div>
  )
}

function ModeButton({
  agent,
  locked,
  mode,
  onChoose,
  option,
  pending,
}: {
  agent: string
  locked: boolean
  mode: AgentMode | null
  onChoose: (mode: AgentMode) => void
  option: ModeOption
  pending: AgentMode | null
}) {
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
      onClick={() => onChoose(option.mode)}
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
        <span className="text-xs break-words text-secondary">{option.description(agent)}</span>
      </span>
      {spinning && <Spinner className="mt-1 text-secondary" />}
      {chosen && <span className="text-sm text-accent-green">✓</span>}
    </button>
  )
}
