'use client'

import type { SetupOption, SetupStatus } from '@shared/types/api/setup'
import { Button, cn } from '@shared/ui'
import { type ReactNode, useState } from 'react'

import { Spinner } from '@/components/agent/Spinner'

import {
  asksGeneration,
  GENERATION_BLURB,
  harnessRows,
  initialChoices,
  keyRows,
  NO_VIDEO_KEY,
  NO_WRITER,
  RESTART_HINT,
  savePlan,
  type SetupChoices,
  staleChoiceMessages,
  videoKeyMissing,
  writerMissing,
} from './setup-status'
import type { SetupStatusState } from './useSetupStatus'

/** The user's picks, tied to the status they were made on (a new status starts over). */
interface Picked {
  choices: SetupChoices
  status: SetupStatus
}

/** The card's answers: the user's picks for this status, else where the card starts. */
function currentChoices(status: null | SetupStatus, picked: null | Picked): null | SetupChoices {
  if (status === null) return null
  return picked?.status === status ? picked.choices : initialChoices(status)
}

/** A titled block of the card. */
function Part({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      {children}
    </div>
  )
}

/** A label with its state on the right. */
function Line({ label, tone, value }: { label: string; tone: 'muted' | 'ok'; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
      <span className="text-sm text-primary">{label}</span>
      <span
        className={cn(
          'text-right text-xs break-words',
          tone === 'ok' ? 'font-medium text-accent-green' : 'text-secondary',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/** A short note in the warning colour. */
function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-accent-orange">{children}</p>
}

/** One question's options as radio buttons; options that can't be used are greyed out with why. */
function Choices<T extends string>({
  describe,
  label,
  onPick,
  options,
  picked,
}: {
  describe?: (id: T) => string
  label: string
  onPick: (id: T) => void
  options: SetupOption<T>[]
  picked: null | T
}) {
  return (
    <div aria-label={label} className="flex flex-col gap-1.5" role="radiogroup">
      {options.map((option) => {
        const checked = option.available && picked === option.id
        return (
          <button
            aria-checked={checked}
            className={cn(
              'flex flex-col gap-0.5 rounded-lg border border-white/10 px-3 py-2.5 text-left transition-colors',
              'disabled:cursor-not-allowed',
              option.available && 'hover:bg-white/5',
              checked && 'border-white/30 bg-white/5',
              !option.available && 'opacity-50',
            )}
            disabled={!option.available}
            key={option.id}
            onClick={() => onPick(option.id)}
            role="radio"
            type="button"
          >
            <span className="text-sm font-semibold text-primary">{option.label}</span>
            {describe && <span className="text-xs text-secondary">{describe(option.id)}</span>}
            {!option.available && option.reason && (
              <span className="text-xs break-words text-secondary">{option.reason}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * "Get set up": the keys ReelMakeEasy found, Codex and Claude Code, which AI writes and plans,
 * and (with both fal and Gemini) who makes the videos. Keys stay in .env; this only picks.
 */
export function SetupCard({
  className,
  onSaved,
  state,
}: {
  className?: string
  onSaved?: () => void
  state: SetupStatusState
}) {
  const { error, loading, recheck, save, saving, status } = state
  const [picked, setPicked] = useState<null | Picked>(null)
  const choices = currentChoices(status, picked)
  const plan = status && choices ? savePlan(status, choices) : {}
  const pick = (next: Partial<SetupChoices>) => {
    if (status && choices) setPicked({ choices: { ...choices, ...next }, status })
  }
  const onSave = async () => {
    if (await save(plan)) onSaved?.()
  }

  return (
    <section
      aria-labelledby="setup-card-title"
      className={cn(
        'flex w-full flex-col gap-5 rounded-2xl border border-white/10 bg-menu-background p-5 text-left',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-primary" id="setup-card-title">
          Get set up
        </h2>
        <p className="text-xs text-secondary">
          ReelMakeEasy uses the keys in .env and the AI apps signed in on this computer. Pick who
          does what.
        </p>
      </div>
      {status === null && loading && <Spinner className="text-secondary" />}
      {status && choices && (
        <>
          <Part title="Keys found">
            {keyRows(status, choices.generation).map((row) => (
              <Line key={row.id} label={row.label} tone={row.tone} value={row.value} />
            ))}
            {videoKeyMissing(status) && <Note>{NO_VIDEO_KEY}</Note>}
          </Part>
          <Part title="AI apps on this computer">
            {harnessRows(status).map((row) => (
              <Line
                key={row.harness}
                label={row.label}
                tone={row.state === 'ready' ? 'ok' : 'muted'}
                value={row.state === 'ready' ? '✓ Ready' : (row.reason ?? 'Not ready')}
              />
            ))}
          </Part>
          <Part title="Which AI writes and plans your videos?">
            <Choices
              label="Which AI writes and plans your videos?"
              onPick={(llm) => pick({ llm })}
              options={status.llm.options}
              picked={choices.llm}
            />
            {writerMissing(status) && <Note>{NO_WRITER}</Note>}
          </Part>
          {asksGeneration(status) && (
            <Part title="Who makes the pictures, clips and voice?">
              <Choices
                describe={(id) => GENERATION_BLURB[id]}
                label="Who makes the pictures, clips and voice?"
                onPick={(generation) => pick({ generation })}
                options={status.generation.options}
                picked={choices.generation}
              />
            </Part>
          )}
          {staleChoiceMessages(status).map((message) => (
            <Note key={message}>{message}</Note>
          ))}
        </>
      )}
      {error && <Note>{error}</Note>}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={Object.keys(plan).length === 0 || saving}
            loading={saving}
            onClick={() => void onSave()}
            variant="primary"
          >
            Save
          </Button>
          <Button disabled={loading || saving} onClick={() => void recheck()} variant="secondary">
            {loading && status ? 'Checking...' : 'Check again'}
          </Button>
        </div>
        <p className="text-xs text-secondary">{RESTART_HINT}</p>
      </div>
    </section>
  )
}
