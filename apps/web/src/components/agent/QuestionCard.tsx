'use client'

import { splitRecommended } from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type { AgentAnswers, AgentOptionSample, AgentQuestion } from '@shared/types/api/agent'
import { Button, cn, Tooltip } from '@shared/ui'
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from 'react'

import { Info } from '@/components/icons/core'

import { Spinner } from './Spinner'

export type QuestionCardProps = {
  entry: Extract<TranscriptEntry, { kind: 'question' }>
  /** What an expired card says (default: to reply in the chat instead, for a chat that takes
   *  a reply). */
  expiredHint?: string
  onAnswer: (answers: AgentAnswers) => Promise<boolean>
  /** This card's answer was already accepted (from the card or the composer) but
   *  `question_answered` hasn't arrived yet: keep it read-only. */
  submitted?: boolean
}

/** Marks which control was clicked, so only it shows the spinner. */
const OTHER = '\u0000other'
const SUBMIT_ALL = '\u0000submit'
type Pending = null | { key: string; questionId: string }

/**
 * An option's sample clip: a small vertical poster beside the words, and while the card is open
 * a muted looping clip over it that plays only while `playing` (hover or keyboard focus on a
 * computer, a tap on the poster on a phone). Fixed size, so nothing moves when it plays;
 * `object-cover` crops any clip that isn't 9:16. Decorative: the option button carries the name.
 */
function OptionSample({
  live,
  onTap,
  playing,
  sample,
}: {
  /** The card is open: mount the clip (not fetched until it first plays). */
  live: boolean
  onTap: (event: MouseEvent) => void
  playing: boolean
  sample: AgentOptionSample
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const startedRef = useRef(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      startedRef.current = true
      video.play()?.catch(() => setShown(false))
      return
    }
    setShown(false)
    if (!startedRef.current) return
    video.pause()
    video.currentTime = 0
  }, [playing])

  return (
    <span
      aria-hidden="true"
      className="relative h-16 w-9 shrink-0 overflow-hidden rounded-md bg-white/5"
      onClick={onTap}
    >
      <img
        alt=""
        className="pointer-events-none absolute inset-0 size-full max-w-none object-cover"
        decoding="async"
        draggable={false}
        loading="lazy"
        src={sample.posterUrl}
      />
      {live && (
        <video
          className={cn(
            'pointer-events-none absolute inset-0 size-full object-cover transition-opacity',
            shown ? 'opacity-100' : 'opacity-0',
          )}
          disablePictureInPicture
          loop
          muted
          onPlaying={() => setShown(true)}
          playsInline
          preload="none"
          ref={videoRef}
          src={sample.videoUrl}
          tabIndex={-1}
        />
      )}
    </span>
  )
}

/** Codex sends `options: null` for a free-text-only question. */
const optionsOf = (q: AgentQuestion) => q.options ?? []

/** A question with no options can only be answered in text. */
const allowsText = (q: AgentQuestion) => q.isOther || optionsOf(q).length === 0

/**
 * A Codex `requestUserInput` card. With one question, a click (or a typed
 * answer) answers at once; with several, each question takes one selection or
 * text and a Submit button sends them together. The full original label -
 * `(Recommended)` suffix included - is what goes back to Codex. Answered and
 * expired cards are read-only.
 */
export function QuestionCard({
  entry,
  expiredHint = 'This question expired. Reply in the chat instead.',
  onAnswer,
  submitted = false,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending>(null)
  /** The option whose sample clip plays (`<question id>\u0000<index>`). */
  const [playingKey, setPlayingKey] = useState<null | string>(null)
  /**
   * The last pointer pressed: a touch tap on a sample plays it rather than answering, and focus
   * after a tap doesn't play. Any key press clears it, so keyboard focus plays again.
   */
  const pointerRef = useRef('')
  // Mirrors `pending` synchronously, so two clicks in one render can't both answer.
  const inFlightRef = useRef(false)

  const open = entry.state === 'open'
  const expired = entry.state === 'expired'
  const single = entry.questions.length === 1
  // Once the card is no longer open nothing is in flight, whatever `pending` says.
  const inFlight = open && pending !== null
  const locked = !open || submitted || inFlight

  // A key press means keyboard use: focus plays clips again after a tap.
  useEffect(() => {
    if (!open) return
    const keyPressed = () => {
      pointerRef.current = ''
    }
    window.addEventListener('keydown', keyPressed, true)
    return () => window.removeEventListener('keydown', keyPressed, true)
  }, [open])

  const submit = async (answers: AgentAnswers, next: NonNullable<Pending>) => {
    if (locked || inFlightRef.current) return
    inFlightRef.current = true
    setPending(next)
    const ok = await onAnswer(answers)
    // On success keep everything disabled until `question_answered` flips the card.
    if (!ok) {
      inFlightRef.current = false
      setPending(null)
    }
  }

  const answerFor = (q: AgentQuestion): string | undefined => {
    const text = texts[q.id]?.trim()
    return selected[q.id] ?? (text ? text : undefined)
  }

  const allAnswered = entry.questions.every((q) => answerFor(q) !== undefined)

  const handleOption = (q: AgentQuestion, label: string) => {
    if (single) {
      void submit({ [q.id]: [label] }, { key: label, questionId: q.id })
      return
    }
    setSelected((s) => ({ ...s, [q.id]: label }))
    setTexts((t) => ({ ...t, [q.id]: '' }))
  }

  const handleText = (q: AgentQuestion, value: string) => {
    setTexts((t) => ({ ...t, [q.id]: value }))
    if (!single && value.trim()) {
      setSelected((s) => {
        const { [q.id]: _dropped, ...rest } = s
        return rest
      })
    }
  }

  const handleTextSubmit = (event: FormEvent, q: AgentQuestion) => {
    event.preventDefault()
    if (!single) {
      if (allAnswered) handleSubmitAll()
      return
    }
    const text = texts[q.id]?.trim()
    if (text) void submit({ [q.id]: [text] }, { key: OTHER, questionId: q.id })
  }

  const handleSubmitAll = () => {
    const answers: AgentAnswers = {}
    for (const q of entry.questions) {
      const value = answerFor(q)
      if (value === undefined) return
      answers[q.id] = [value]
    }
    void submit(answers, { key: SUBMIT_ALL, questionId: '' })
  }

  return (
    <div
      className={cn(
        'flex w-full max-w-xl flex-col gap-4 rounded-xl border border-white/10 bg-fill-secondary/50 p-3',
        expired && 'opacity-60',
      )}
    >
      {entry.questions.map((q) => {
        const given = entry.answers?.[q.id] ?? []
        const labels = new Set(optionsOf(q).map((o) => o.label))
        const typed = entry.state === 'answered' ? given.filter((a) => !labels.has(a)) : []
        return (
          <div className="flex flex-col gap-2" key={q.id}>
            {q.header && (
              <div className="flex items-center gap-1.5">
                <span className="w-fit rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-secondary uppercase">
                  {q.header}
                </span>
                {q.info && (
                  <Tooltip
                    className="bg-overlay rounded-xs px-2 py-1 text-xs text-primary backdrop-blur-xl"
                    content={q.info}
                    side="top"
                  >
                    <button
                      aria-label={`What is ${q.header.toLowerCase()}?`}
                      className="flex size-4 items-center justify-center rounded-full text-secondary hover:text-primary"
                      type="button"
                    >
                      <Info aria-hidden className="size-3.5" />
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            <p className="text-sm break-words text-primary">{q.question}</p>
            {optionsOf(q).length > 0 && (
              <div className="flex flex-col gap-1.5">
                {optionsOf(q).map((option, index) => {
                  const { recommended, text } = splitRecommended(option.label)
                  const chosen =
                    entry.state === 'answered'
                      ? given.includes(option.label)
                      : selected[q.id] === option.label
                  const spinning =
                    inFlight && pending?.questionId === q.id && pending.key === option.label
                  const sampleKey = `${q.id}\u0000${index}`
                  const playable = open && option.sample !== undefined
                  const stopSample = () => setPlayingKey((k) => (k === sampleKey ? null : k))
                  return (
                    <button
                      className={cn(
                        'flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                        'disabled:cursor-default',
                        // Same border for every option, so the recommended one never looks
                        // already chosen; only its badge marks it.
                        'border-white/10',
                        chosen && 'border-white/40 bg-white/10',
                        !locked && 'hover:bg-white/5',
                      )}
                      disabled={locked}
                      key={`${index}-${option.label}`}
                      onClick={() => handleOption(q, option.label)}
                      {...(playable && {
                        // Keep `pointerRef` here: Android Chrome focuses a tapped button, so the
                        // old option blurs between a tap's pointerdown and its click.
                        onBlur: stopSample,
                        onFocus: () => {
                          if (pointerRef.current !== 'touch') setPlayingKey(sampleKey)
                        },
                        onPointerDown: (e) => {
                          pointerRef.current = e.pointerType
                        },
                        onPointerEnter: (e) => {
                          if (e.pointerType !== 'touch') setPlayingKey(sampleKey)
                        },
                        onPointerLeave: (e) => {
                          if (e.pointerType !== 'touch') stopSample()
                        },
                      })}
                      type="button"
                    >
                      {option.sample && (
                        <OptionSample
                          live={open}
                          onTap={(e) => {
                            if (!playable || pointerRef.current !== 'touch') return
                            e.stopPropagation()
                            setPlayingKey((k) => (k === sampleKey ? null : sampleKey))
                          }}
                          playing={playable && playingKey === sampleKey}
                          sample={option.sample}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="min-w-0 text-sm font-semibold break-words text-primary">
                            {text}
                          </span>
                          {recommended && (
                            <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
                              Recommended
                            </span>
                          )}
                        </span>
                        {option.description && (
                          <span className="text-xs break-words text-secondary">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {spinning && <Spinner className="mt-1 text-secondary" />}
                      {chosen && entry.state === 'answered' && (
                        <span className="text-sm text-accent-green">✓</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            {open && allowsText(q) && (
              <form className="flex items-center gap-1.5" onSubmit={(e) => handleTextSubmit(e, q)}>
                <input
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-background px-3 text-sm text-primary outline-none placeholder:text-secondary focus:border-white/30 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                  disabled={locked}
                  onChange={(e) => handleText(q, e.target.value)}
                  placeholder="Something else…"
                  type={q.isSecret ? 'password' : 'text'}
                  value={texts[q.id] ?? ''}
                />
                {single && (
                  <button
                    aria-label="Send answer"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-secondary hover:bg-white/5 disabled:opacity-40"
                    disabled={locked || !texts[q.id]?.trim()}
                    type="submit"
                  >
                    {inFlight && pending?.questionId === q.id && pending.key === OTHER ? (
                      <Spinner />
                    ) : (
                      '→'
                    )}
                  </button>
                )}
              </form>
            )}
            {typed.length > 0 && (
              <p className="text-xs break-words text-secondary">
                You wrote: <span className="text-primary">{typed.join(', ')}</span>
              </p>
            )}
          </div>
        )
      })}
      {open && !single && (
        <Button
          className="h-9 w-fit self-end rounded-lg px-4"
          disabled={locked || !allAnswered}
          onClick={handleSubmitAll}
          type="button"
        >
          {inFlight && pending?.key === SUBMIT_ALL && <Spinner className="mr-1.5" />}
          Submit
        </Button>
      )}
      {expired && <p className="text-xs text-secondary">{expiredHint}</p>}
    </div>
  )
}
