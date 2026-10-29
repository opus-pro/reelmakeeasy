'use client'

import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import {
  VIDEO_DEFAULT_DETAIL,
  VIDEO_DETAIL_LABEL,
} from '@reelmakeeasy/common/motion-reel/video-detail'
import type {
  AgentAnimationOptions,
  AgentAnimationSetup,
  AgentAnimationSetupView,
  AnimationStyleId,
  VideoDetail,
} from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  CARD_CLASS,
  ChipRow,
  COMPOSER_LABEL,
  DetailPicker,
  EffortSlider,
  LABEL_CLASS,
  musicChoice,
  type MusicPick,
  MusicPicker,
} from '../motion/setup-parts'
import { Spinner } from '../Spinner'

import {
  avatarChoice,
  type AvatarPick,
  AvatarPicker,
  firstAvatarPick,
  fitAvatarPick,
} from './AvatarPicker'
import { useAnimationOptions } from './useAnimationOptions'

export type AnimationSetupCardProps = {
  entry: Extract<TranscriptEntry, { kind: 'animation_setup' }>
  onSubmit: (setup: AgentAnimationSetup) => Promise<boolean>
  sessionId: string
}

type Look = AgentAnimationOptions['looks'][number]
/** A style the card offers (2D, 3D, Pixel art), with its Avatar explainer version. */
type Style = Look & { id: AnimationStyleId; withAvatar: NonNullable<Look['withAvatar']> }

const isStyle = (look: Look): look is Style => !!look.withAvatar

const SUBJECT_MAX = 600

/**
 * A Claude Animation chat's first step: the style (2D, 3D or Pixel art) and whether the user's
 * avatar hosts it (Avatar explainer: every style switches to its version with the avatar, and the
 * avatar picker shows), what it's about (or Surprise me: Claude picks a fun fact), the music, the
 * length and the detail. Sending it locks the card while ReelMakeEasy readies the project; the
 * chat then opens and the card shows what was chosen.
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
    ...(setup.detail ? [`${VIDEO_DETAIL_LABEL[setup.detail]} detail`] : []),
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
  // A look without a track of its own (an Avatar video): Claude composes it.
  if (look && look.defaultTrackId === null && options.composers.some((c) => c.id === 'composer'))
    return { engine: 'composer', kind: 'agent' }
  const trackId = look?.defaultTrackId ?? options.tracks[0]?.id
  return trackId ? { kind: 'library', trackId } : { kind: 'none' }
}

function SetupForm({
  onSubmit,
  options,
  sessionId,
}: Omit<AnimationSetupCardProps, 'entry'> & { options: AgentAnimationOptions }) {
  const styles = options.looks.filter(isStyle)
  const hostLook = options.looks.find((l) => l.id === 'avatar')
  const first = styles.find((l) => !l.disabledReason) ?? styles[0]
  const [styleId, setStyleId] = useState<AnimationStyleId | undefined>(first?.id)
  const [withAvatar, setWithAvatar] = useState(false)
  const style = styles.find((l) => l.id === styleId)
  // The look sent: the style, or with "Avatar explainer" ticked the avatar look in that style.
  const look = withAvatar ? hostLook : style
  const [subject, setSubject] = useState('')
  const [surprise, setSurprise] = useState(false)
  const [lengthSec, setLengthSec] = useState(first?.defaultLengthSec ?? 30)
  const [detail, setDetail] = useState<VideoDetail>(VIDEO_DEFAULT_DETAIL)
  const [music, setMusic] = useState<MusicPick>(() => defaultMusic(options, first))
  const [musicTouched, setMusicTouched] = useState(false)
  const [avatar, setAvatar] = useState<AvatarPick>(() =>
    firstAvatarPick(options.avatars, first?.withAvatar.avatarStyles),
  )
  const talkingHead = withAvatar
  const avatarSent = talkingHead ? avatarChoice(avatar) : null
  const [pending, setPending] = useState(false)
  const inFlightRef = useRef(false)

  // A length of the user's own (seconds, as typed); empty: one of the suggested lengths.
  const [custom, setCustom] = useState('')
  const typed = Number(custom)
  const customOk =
    Number.isInteger(typed) && typed >= options.minLengthSec && typed <= options.maxLengthSec
  const length = custom.trim() ? typed : lengthSec

  const pickStyle = (next: Style) => {
    setStyleId(next.id)
    setAvatar((current) => fitAvatarPick(current, options.avatars, next.withAvatar.avatarStyles))
    // The look's own track follows it, until the user picks the music themselves.
    if (!musicTouched) setMusic(defaultMusic(options, withAvatar ? hostLook : next))
  }
  const pickAvatarExplainer = (on: boolean) => {
    setWithAvatar(on)
    if (!musicTouched) setMusic(defaultMusic(options, on ? hostLook : style))
  }
  const pickMusic = (next: MusicPick) => {
    setMusicTouched(true)
    setMusic(next)
  }

  const lengthOk = !custom.trim() || customOk
  const avatarOk = !talkingHead || !!avatarSent
  // A style's own reason (2D's characters need designed voices) doesn't hold with the avatar.
  const blocked = !withAvatar && !!style?.disabledReason
  const ready =
    !!look && !!style && !blocked && (surprise || !!subject.trim()) && lengthOk && avatarOk
  const submit = async () => {
    if (!ready || !look || !style || inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    const ok = await onSubmit({
      ...(avatarSent ? { avatar: avatarSent } : {}),
      detail,
      lengthSec: length,
      lookId: look.id,
      music: musicChoice(music),
      ...(withAvatar ? { stage: style.id } : {}),
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
        <AvatarExplainerCheck checked={withAvatar} onChange={pickAvatarExplainer} />
        <StyleGrid onPick={pickStyle} selected={styleId} styles={styles} withAvatar={withAvatar} />
        {talkingHead && style && (
          <AvatarPicker
            avatars={options.avatars}
            onPick={setAvatar}
            pick={avatar}
            sessionId={sessionId}
            styles={style.withAvatar.avatarStyles}
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
        <DetailPicker detail={detail} onPick={setDetail} />
        <EffortSlider />
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
        {!ready && !pending && !blocked && (
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

/** "Avatar explainer": ticked, the user's avatar hosts the video in whichever style is picked. */
function AvatarExplainerCheck({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex max-w-md cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
        checked ? 'border-violet-300/60 bg-violet-400/10' : 'border-white/10 hover:border-white/25',
      )}
    >
      <input
        checked={checked}
        className="size-4 shrink-0 accent-violet-400"
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-primary">Avatar explainer</span>
        <span className="text-xs text-secondary">
          Your avatar hosts it, in whichever style you pick.
        </span>
      </span>
    </label>
  )
}

/** The styles as tiles: each one's clip, or its Avatar explainer clip while that is ticked. */
function StyleGrid({
  onPick,
  selected,
  styles,
  withAvatar,
}: {
  onPick: (style: Style) => void
  selected: AnimationStyleId | undefined
  styles: Style[]
  withAvatar: boolean
}) {
  const current = styles.find((l) => l.id === selected)
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Style</span>
      <div className="grid max-w-md grid-cols-3 gap-2" role="radiogroup">
        {styles.map((style) => {
          const disabled = !withAvatar && !!style.disabledReason
          return (
            <button
              aria-checked={style.id === selected}
              aria-label={style.label}
              className={cn(
                'group flex flex-col overflow-hidden rounded-lg border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                style.id === selected
                  ? 'border-white/70 ring-1 ring-white/50'
                  : 'border-white/10 hover:border-white/30',
              )}
              disabled={disabled}
              key={style.id}
              onClick={() => onPick(style)}
              role="radio"
              title={disabled ? style.disabledReason : style.description}
              type="button"
            >
              <span className="relative">
                <LookPreview
                  label={style.label}
                  previewUrl={
                    withAvatar
                      ? (style.withAvatar.previewUrl ?? style.previewUrl)
                      : style.previewUrl
                  }
                />
                {withAvatar && (
                  <span className="absolute top-1.5 left-1.5 rounded bg-violet-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    + avatar
                  </span>
                )}
              </span>
              <span className="px-2 py-1.5 text-xs leading-tight font-medium text-primary">
                {style.label}
              </span>
            </button>
          )
        })}
      </div>
      {current && (
        <p className="text-xs text-secondary">
          {withAvatar ? current.withAvatar.description : current.description}
        </p>
      )}
      {!withAvatar &&
        styles
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
function LookPreview({ label, previewUrl }: { label: string; previewUrl: null | string }) {
  if (previewUrl)
    return (
      <video
        autoPlay
        className="aspect-[9/16] w-full bg-black object-cover"
        loop
        muted
        playsInline
        src={previewUrl}
      />
    )
  return (
    <span className="flex aspect-[9/16] w-full items-center justify-center bg-white/[0.04] text-2xl font-semibold text-white/30">
      {label}
    </span>
  )
}
