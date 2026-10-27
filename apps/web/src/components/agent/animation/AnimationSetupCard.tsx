'use client'

import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type {
  AgentAnimationOptions,
  AgentAnimationSetup,
  AgentAnimationSetupView,
  AnimationLookId,
} from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  CARD_CLASS,
  ChipRow,
  COMPOSER_LABEL,
  LABEL_CLASS,
  musicChoice,
  type MusicPick,
  MusicPicker,
} from '../motion/setup-parts'
import { Spinner } from '../Spinner'

import { avatarChoice, type AvatarPick, AvatarPicker, firstAvatarPick } from './AvatarPicker'
import { useAnimationOptions } from './useAnimationOptions'

export type AnimationSetupCardProps = {
  entry: Extract<TranscriptEntry, { kind: 'animation_setup' }>
  onSubmit: (setup: AgentAnimationSetup) => Promise<boolean>
  sessionId: string
}

type Look = AgentAnimationOptions['looks'][number]

const SUBJECT_MAX = 600

/**
 * A Claude Animation chat's first step: the look (2D, 3D or 8-bit), what it's about (or Surprise
 * me: Claude picks a fun fact), the music and the length. Sending it locks the card while
 * ReelMakeEasy readies the project; the chat then opens and the card shows what was chosen.
 */
export function AnimationSetupCard({ entry, onSubmit, sessionId }: AnimationSetupCardProps) {
  if (entry.state === 'chosen' && entry.setup) return <ChosenSetup setup={entry.setup} />
  return <OpenSetup onSubmit={onSubmit} sessionId={sessionId} />
}

function ChosenSetup({ setup }: { setup: AgentAnimationSetupView }) {
  const facts = [
    setup.lookLabel,
    ...(setup.avatarName ? [`Avatar: ${setup.avatarName}`] : []),
    `${setup.lengthSec} s`,
    setup.musicTitle
      ? `♪ ${setup.musicTitle}`
      : setup.music.source === 'agent'
        ? `♪ ${COMPOSER_LABEL[setup.music.engine] ?? 'Its own music'}`
        : 'No music',
  ]
  return (
    <div className={cn(CARD_CLASS, 'gap-2')}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-primary">Claude Animation</span>
        <span className="text-sm text-accent-green">✓</span>
      </div>
      <p className="text-sm break-words text-primary">
        {setup.subject ?? 'A fun fact Claude picks'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {facts.map((fact) => (
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-secondary" key={fact}>
            {fact}
          </span>
        ))}
      </div>
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-primary">Set up your animation</p>
      <p className="text-xs text-secondary">
        Claude draws and animates every frame in code, with voices. No AI video model.
      </p>
    </div>
  )
}

function OpenSetup({ onSubmit, sessionId }: Omit<AnimationSetupCardProps, 'entry'>) {
  const { error, options, retry } = useAnimationOptions()
  if (!options)
    return (
      <div className={CARD_CLASS}>
        <Header />
        {error ? (
          <Button className="w-fit" onClick={retry} size="sm" variant="secondary">
            Couldn&apos;t load the looks. Try again
          </Button>
        ) : (
          <Spinner className="text-secondary" />
        )}
      </div>
    )
  return <SetupForm onSubmit={onSubmit} options={options} sessionId={sessionId} />
}

function defaultMusic(options: AgentAnimationOptions, look: Look | undefined): MusicPick {
  const trackId = look?.defaultTrackId ?? options.tracks[0]?.id
  return trackId ? { kind: 'library', trackId } : { kind: 'none' }
}

function SetupForm({
  onSubmit,
  options,
  sessionId,
}: Omit<AnimationSetupCardProps, 'entry'> & { options: AgentAnimationOptions }) {
  const first = options.looks.find((l) => !l.disabledReason) ?? options.looks[0]
  const [lookId, setLookId] = useState<AnimationLookId | undefined>(first?.id)
  const look = options.looks.find((l) => l.id === lookId)
  const [subject, setSubject] = useState('')
  const [surprise, setSurprise] = useState(false)
  const [lengthSec, setLengthSec] = useState(first?.defaultLengthSec ?? 30)
  const [music, setMusic] = useState<MusicPick>(() => defaultMusic(options, first))
  const [musicTouched, setMusicTouched] = useState(false)
  const [avatar, setAvatar] = useState<AvatarPick>(() => firstAvatarPick(options.avatars))
  const talkingHead = lookId === 'avatar'
  const avatarSent = talkingHead ? avatarChoice(avatar) : null
  const [pending, setPending] = useState(false)
  const inFlightRef = useRef(false)

  // A length of the user's own (seconds, as typed); empty: one of the suggested lengths.
  const [custom, setCustom] = useState('')
  const typed = Number(custom)
  const customOk =
    Number.isInteger(typed) && typed >= options.minLengthSec && typed <= options.maxLengthSec
  const length = custom.trim() ? typed : lengthSec

  const pickLook = (next: Look) => {
    setLookId(next.id)
    // The look's own track follows it, until the user picks the music themselves.
    if (!musicTouched) setMusic(defaultMusic(options, next))
  }
  const pickMusic = (next: MusicPick) => {
    setMusicTouched(true)
    setMusic(next)
  }

  const lengthOk = !custom.trim() || customOk
  const avatarOk = !talkingHead || !!avatarSent
  const ready =
    !!look && !look.disabledReason && (surprise || !!subject.trim()) && lengthOk && avatarOk
  const submit = async () => {
    if (!ready || !look || inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    const ok = await onSubmit({
      ...(avatarSent ? { avatar: avatarSent } : {}),
      lengthSec: length,
      lookId: look.id,
      music: musicChoice(music),
      subject: surprise ? null : subject.trim(),
    })
    // On success stay locked until the chat opens (`animation_setup`) or the card comes back.
    if (!ok) {
      inFlightRef.current = false
      setPending(false)
    }
  }

  return (
    <div className={CARD_CLASS}>
      <Header />
      <fieldset className="flex flex-col gap-4" disabled={pending}>
        <LookGrid looks={options.looks} onPick={pickLook} selected={lookId} />
        {talkingHead && (
          <AvatarPicker
            avatars={options.avatars}
            onPick={setAvatar}
            pick={avatar}
            sessionId={sessionId}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS} htmlFor="animation-subject">
            What&apos;s it about?
          </label>
          <textarea
            className="min-h-[72px] resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none disabled:opacity-40"
            disabled={surprise}
            id="animation-subject"
            maxLength={SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={
              talkingHead ? 'e.g. Why we yawn, told by me' : 'e.g. Why honey never goes bad'
            }
            value={subject}
          />
          <button
            aria-checked={surprise}
            className={cn(
              'flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
              surprise
                ? 'border-white/50 bg-white/15 text-primary'
                : 'border-white/10 text-secondary hover:text-primary',
            )}
            onClick={() => setSurprise((v) => !v)}
            role="checkbox"
            type="button"
          >
            <Sparkles className="size-3.5" />
            Surprise me: Claude picks a fun fact
          </button>
        </div>
        {look && (
          <div className="flex flex-wrap items-end gap-3">
            <ChipRow
              label="Length"
              onPick={(value) => {
                setLengthSec(value)
                setCustom('')
              }}
              options={look.lengths.map((value) => ({ label: `${value} s`, value }))}
              selected={custom.trim() ? -1 : lengthSec}
            />
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              or
              <input
                aria-label="Custom length in seconds"
                className="w-20 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
                max={options.maxLengthSec}
                min={options.minLengthSec}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Custom"
                type="number"
                value={custom}
              />
              s
            </label>
          </div>
        )}
        <MusicPicker
          agentName="Claude"
          composers={options.composers}
          music={music}
          onPick={pickMusic}
          sessionId={sessionId}
          tracks={options.tracks}
        />
      </fieldset>
      <div className="flex items-center gap-3">
        <Button disabled={!ready || pending} onClick={() => void submit()} size="sm">
          {pending ? 'Getting it ready…' : 'Build it'}
        </Button>
        {pending && <Spinner className="text-secondary" />}
        {!ready && !pending && !look?.disabledReason && (
          <span className="text-xs text-secondary">
            {!lengthOk
              ? `Pick a length from ${options.minLengthSec} to ${options.maxLengthSec} seconds.`
              : !avatarOk
                ? 'Add a photo and a name for the new avatar.'
                : "Say what it's about, or pick Surprise me."}
          </span>
        )}
      </div>
    </div>
  )
}

function LookGrid({
  looks,
  onPick,
  selected,
}: {
  looks: Look[]
  onPick: (look: Look) => void
  selected: AnimationLookId | undefined
}) {
  const current = looks.find((l) => l.id === selected)
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Look</span>
      <div className="grid grid-cols-4 gap-2" role="radiogroup">
        {looks.map((look) => (
          <button
            aria-checked={look.id === selected}
            aria-label={look.label}
            className={cn(
              'group flex flex-col overflow-hidden rounded-lg border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              look.id === selected
                ? 'border-white/70 ring-1 ring-white/50'
                : 'border-white/10 hover:border-white/30',
            )}
            disabled={!!look.disabledReason}
            key={look.id}
            onClick={() => onPick(look)}
            role="radio"
            title={look.disabledReason ?? look.description}
            type="button"
          >
            <LookPreview look={look} />
            <span className="px-2 py-1.5 text-xs leading-tight font-medium text-primary">
              {look.label}
            </span>
          </button>
        ))}
      </div>
      {current && <p className="text-xs text-secondary">{current.description}</p>}
      {looks
        .filter((l) => l.disabledReason)
        .map((l) => (
          <p className="text-xs text-amber-400" key={l.id}>
            {l.label}: <span>{l.disabledReason}</span>
          </p>
        ))}
    </div>
  )
}

/** A look's looping preview, or (until the preset pack has one) its name on a plain tile. */
function LookPreview({ look }: { look: Look }) {
  if (look.previewUrl)
    return (
      <video
        autoPlay
        className="aspect-[9/16] max-h-40 w-full bg-black object-cover"
        loop
        muted
        playsInline
        src={look.previewUrl}
      />
    )
  return (
    <span className="flex aspect-[9/16] max-h-40 w-full items-center justify-center bg-white/[0.04] text-2xl font-semibold text-white/30">
      {look.label}
    </span>
  )
}
