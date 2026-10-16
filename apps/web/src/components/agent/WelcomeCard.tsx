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
import {
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  ListOrdered,
  MessagesSquare,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
  /** Easy first; Advanced when the tool has one. */
  modes: [ModeOption, ...ModeOption[]]
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

/** The tools, each with its Easy (guided) mode and, most, an Advanced (free chat) one. */
const TOOLS: ToolOption[] = [
  SHORT_VIDEO,
  {
    icon: ListOrdered,
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
  {
    icon: Clapperboard,
    key: 'motion',
    label: 'Motion Reel',
    modes: [
      {
        description: (agent) =>
          `Motion graphics on the beat: a launch, a showreel, a website demo. Pick a style and the music, and ${agent} plans it and builds it in Remotion, on this computer. Needs Claude Opus or GPT Astra.`,
        label: 'Guided',
        mode: AGENT_TOOL_MODES.motion.easy,
        recommended: true,
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
    <div className="flex w-full max-w-xl flex-col gap-3.5 rounded-xl bg-white/5 p-4 ring-1 ring-white/10 ring-inset">
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-primary">What would you like to make?</p>
        <p className="text-xs text-secondary">
          {agent} is your creative partner here. New to this? Start with Easy.
        </p>
      </div>
      <div
        aria-label="Tool"
        className={cn(
          'flex w-full gap-0.5 rounded-sm bg-white/[0.06] p-0.5',
          locked && 'pointer-events-none',
        )}
        role="tablist"
      >
        {TOOLS.map((option) => {
          const selected = option.key === tool.key
          const Icon = option.icon
          return (
            <button
              aria-selected={selected}
              className={cn(
                'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xs text-[13px] font-medium transition-colors disabled:cursor-default',
                selected
                  ? 'bg-white/[0.14] text-primary shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
                  : 'text-secondary',
                !locked && !selected && 'hover:text-primary',
                locked && !selected && 'opacity-45',
              )}
              disabled={locked}
              key={option.key}
              onClick={() => setPicked(option.key)}
              role="tab"
              type="button"
            >
              <Icon className="size-[15px]" />
              {option.label}
            </button>
          )
        })}
      </div>
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
      {(presetHarness || mode !== null) && (
        <p className="border-t border-white/[0.08] pt-3 text-xs text-white/40">
          Running on {HARNESS_LABEL[chosenHarness ?? presetHarness ?? harness]}
        </p>
      )}
      {mode === null && !presetHarness && choices.length > 1 && (
        <div className="flex flex-col gap-1 border-t border-white/[0.08] pt-3">
          <div className="flex items-center gap-2 text-xs text-white/40">
            Runs on
            <div className="flex rounded-xs bg-white/[0.06] p-0.5" role="radiogroup">
              {choices.map((choice) => (
                <button
                  aria-checked={harness === choice.harness}
                  className={cn(
                    'h-6 rounded-xxs px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    harness === choice.harness
                      ? 'bg-white/[0.14] text-primary'
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
  // Once one is picked (or being picked), the other fades.
  const faded = (mode ?? pending) !== null && !chosen && !spinning
  const Icon = option.recommended ? WandSparkles : MessagesSquare
  return (
    <button
      className={cn(
        'flex items-center gap-3 rounded-sm p-3 text-left ring-1 ring-white/10 transition-colors ring-inset',
        'disabled:cursor-default',
        chosen && 'bg-white/10 ring-white/40',
        faded && 'opacity-40',
        !locked && 'hover:bg-white/[0.04]',
      )}
      disabled={locked}
      onClick={() => onChoose(option.mode)}
      type="button"
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center self-start rounded-[9px]',
          option.recommended
            ? 'bg-accent-green/15 text-accent-green'
            : 'bg-white/[0.06] text-secondary',
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-primary">{option.label}</span>
          {option.recommended && (
            <span className="flex h-[18px] items-center rounded bg-accent-green/15 px-1.5 text-[10px] font-semibold text-accent-green">
              Recommended
            </span>
          )}
        </span>
        <span className="text-xs leading-[1.45] break-words text-secondary">
          {option.description(agent)}
        </span>
      </span>
      {spinning ? (
        <Spinner className="text-secondary" />
      ) : chosen ? (
        <Check aria-label="Chosen" className="size-[18px] text-accent-green" />
      ) : (
        <ArrowRight aria-hidden className="size-4 text-white/40" />
      )}
    </button>
  )
}
