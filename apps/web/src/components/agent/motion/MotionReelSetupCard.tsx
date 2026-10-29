'use client'

import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import {
  VIDEO_DEFAULT_DETAIL,
  VIDEO_DETAIL_LABEL,
} from '@reelmakeeasy/common/motion-reel/video-detail'
import type {
  AgentMotionOptions,
  AgentMotionSetup,
  AgentMotionSetupView,
  VideoDetail,
} from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import { attachmentName, uploadAttachment } from '../attachments/attachments'
import { Spinner } from '../Spinner'

import { DetailPicker } from './setup-parts'
import { useMotionReelOptions } from './useMotionReelOptions'

export type MotionReelSetupCardProps = {
  entry: Extract<TranscriptEntry, { kind: 'motion_setup' }>
  onSubmit: (setup: AgentMotionSetup) => Promise<boolean>
  sessionId: string
}

type Composer = AgentMotionOptions['composers'][number]['id']
type MusicPick =
  | { engine: Composer; kind: 'agent' }
  | { kind: 'library'; trackId: string }
  | { kind: 'none' }
  | { kind: 'upload'; name: string; title: string }
type Ratio = AgentMotionSetup['ratio']
type ReelType = AgentMotionOptions['types'][number]
type ReferenceKind = 'none' | 'website' | 'youtube'

const CARD_CLASS =
  'flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-white/10 bg-fill-secondary/50 p-4'
const LABEL_CLASS = 'text-xs font-medium tracking-wide text-secondary uppercase'
const SUBJECT_MAX = 600
/** How a chosen setup names music the agent is still to make. */
const COMPOSER_LABEL: Record<string, string> = {
  'ace-step': 'ACE-Step music, to come',
  composer: 'Music the agent composes, to come',
  'eleven-music': 'ElevenLabs Music, to come',
}
/** Ideas under "What's it about?": a click puts the text in the box, and the kind of reel and
 *  length it names when the setup offers them. */
const EXAMPLES: { label: string; lengthSec?: number; text: string; type?: ReelType['id'] }[] = [
  {
    label: 'About yourself, Claude',
    lengthSec: 15,
    text: 'Make a 15-second motion reel about yourself, Claude',
    type: 'showreel',
  },
  {
    label: 'A ReelMakeEasy launch',
    lengthSec: 30,
    text: 'A 30-second product launch for ReelMakeEasy: make shorts on your own computer',
    type: 'launch',
  },
  {
    label: 'Kinetic type and particles',
    text: 'A motion reel that shows off kinetic type and particles',
    type: 'showreel',
  },
]
const RATIO_LABEL: Record<Ratio, string> = {
  '16:9': '16:9 wide',
  '1:1': '1:1 square',
  '9:16': '9:16 tall',
}

/**
 * A Motion Reel chat's first step: the kind of reel (a product launch or a motion reel; the agent
 * decides the look), what the reel is about, an optional
 * reference (a YouTube video or a website to take the look from), the length, the frame and the
 * music. Sending it locks the card while ReelMakeEasy readies the project; the chat then opens
 * and the card shows what was chosen.
 */
export function MotionReelSetupCard({ entry, onSubmit, sessionId }: MotionReelSetupCardProps) {
  if (entry.state === 'chosen' && entry.setup) return <ChosenSetup setup={entry.setup} />
  return <OpenSetup onSubmit={onSubmit} sessionId={sessionId} />
}

function ChosenSetup({ setup }: { setup: AgentMotionSetupView }) {
  const facts = [
    setup.typeLabel,
    `${Math.round(setup.reelSec)} s · ${setup.bars} bars at ${Math.round(setup.bpm)} BPM`,
    setup.ratio,
    ...(setup.detail ? [`${VIDEO_DETAIL_LABEL[setup.detail]} detail`] : []),
    setup.musicTitle
      ? `♪ ${setup.musicTitle}`
      : setup.music.source === 'agent'
        ? `♪ ${COMPOSER_LABEL[setup.music.engine] ?? 'Its own music'}`
        : 'No music',
    ...(setup.reference
      ? [setup.reference.kind === 'youtube' ? 'Video reference' : 'Website reference']
      : []),
  ]
  return (
    <div className={cn(CARD_CLASS, 'gap-2')}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-primary">Motion Reel</span>
        <span className="text-sm text-accent-green">✓</span>
      </div>
      <p className="text-sm break-words text-primary">{setup.subject}</p>
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

function defaultMusic(options: AgentMotionOptions): MusicPick {
  const trackId = options.tracks[0]?.id
  return trackId ? { kind: 'library', trackId } : { kind: 'none' }
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-primary">Set up your Motion Reel</p>
      <p className="text-xs text-secondary">
        Pick the kind of reel and say what it&apos;s about. Every cut, move and sound lands on the
        music&apos;s beat.
      </p>
    </div>
  )
}

function OpenSetup({ onSubmit, sessionId }: Omit<MotionReelSetupCardProps, 'entry'>) {
  const { error, options, retry } = useMotionReelOptions()
  if (!options)
    return (
      <div className={CARD_CLASS}>
        <Header />
        {error ? (
          <Button className="w-fit" onClick={retry} size="sm" variant="secondary">
            Couldn&apos;t load the setup. Try again
          </Button>
        ) : (
          <Spinner className="text-secondary" />
        )}
      </div>
    )
  return <SetupForm onSubmit={onSubmit} options={options} sessionId={sessionId} />
}

function SetupForm({
  onSubmit,
  options,
  sessionId,
}: Omit<MotionReelSetupCardProps, 'entry'> & { options: AgentMotionOptions }) {
  const [type, setType] = useState<ReelType['id'] | undefined>(options.types[0]?.id)
  const [subject, setSubject] = useState('')
  const [lengthSec, setLengthSec] = useState(options.defaultLengthSec)
  const [ratio, setRatio] = useState<Ratio>(options.defaultRatio)
  const [detail, setDetail] = useState<VideoDetail>(VIDEO_DEFAULT_DETAIL)
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>('none')
  const [referenceUrl, setReferenceUrl] = useState('')
  const [music, setMusic] = useState<MusicPick>(() => defaultMusic(options))
  const [pending, setPending] = useState(false)
  const inFlightRef = useRef(false)

  const ready = !!subject.trim() && !!type && (referenceKind === 'none' || !!referenceUrl.trim())
  const submit = async () => {
    if (!ready || !type || inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    const ok = await onSubmit({
      detail,
      lengthSec,
      music:
        music.kind === 'library'
          ? { id: music.trackId, source: 'library' }
          : music.kind === 'upload'
            ? { id: music.name, source: 'upload' }
            : music.kind === 'agent'
              ? { engine: music.engine, source: 'agent' }
              : { source: 'none' },
      ratio,
      ...(referenceKind === 'none'
        ? {}
        : { reference: { kind: referenceKind, url: referenceUrl.trim() } }),
      subject: subject.trim(),
      type,
    })
    // On success stay locked until the chat opens (`motion_setup`) or the card comes back.
    if (!ok) {
      inFlightRef.current = false
      setPending(false)
    }
  }

  return (
    <div className={CARD_CLASS}>
      <Header />
      <fieldset className="flex flex-col gap-4" disabled={pending}>
        <TypePicker onPick={setType} selected={type} types={options.types} />
        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>What&apos;s it about?</span>
          <textarea
            className="min-h-[72px] resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
            maxLength={SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Describe your reel…"
            value={subject}
          />
        </label>
        <div aria-label="Examples" className="-mt-2 flex flex-wrap gap-1.5" role="group">
          {EXAMPLES.map((example) => (
            <button
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-secondary transition-colors hover:border-white/30 hover:text-primary"
              key={example.label}
              onClick={() => {
                setSubject(example.text)
                if (example.type && options.types.some((t) => t.id === example.type))
                  setType(example.type)
                if (example.lengthSec && options.lengths.includes(example.lengthSec))
                  setLengthSec(example.lengthSec)
              }}
              title={example.text}
              type="button"
            >
              {example.label}
            </button>
          ))}
        </div>
        <ReferenceField
          kind={referenceKind}
          onKind={setReferenceKind}
          onUrl={setReferenceUrl}
          url={referenceUrl}
        />
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <ChipRow
            label="Length"
            onPick={setLengthSec}
            options={options.lengths.map((value) => ({ label: `${value} s`, value }))}
            selected={lengthSec}
          />
          <ChipRow
            label="Frame"
            onPick={setRatio}
            options={options.ratios.map((value) => ({ label: RATIO_LABEL[value], value }))}
            selected={ratio}
          />
        </div>
        <DetailPicker detail={detail} onPick={setDetail} />
        <MusicPicker
          composers={options.composers}
          music={music}
          onPick={setMusic}
          sessionId={sessionId}
          tracks={options.tracks}
        />
      </fieldset>
      <div className="flex items-center gap-3">
        <Button disabled={!ready || pending} onClick={() => void submit()} size="sm">
          {pending ? 'Getting it ready…' : 'Build my reel'}
        </Button>
        {pending && <Spinner className="text-secondary" />}
        {!ready && !pending && (
          <span className="text-xs text-secondary">
            {subject.trim()
              ? 'Paste the reference link, or pick None.'
              : 'Say what the reel is about.'}
          </span>
        )}
      </div>
    </div>
  )
}

/** A row of choices, one of them picked. */
function ChipRow<T extends number | string>({
  label,
  onPick,
  options,
  selected,
}: {
  label: string
  onPick: (value: T) => void
  options: { label: string; value: T }[]
  selected: T
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {options.map((option) => (
          <button
            aria-checked={option.value === selected}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors',
              option.value === selected
                ? 'border-white/50 bg-white/15 text-primary'
                : 'border-white/10 text-secondary hover:text-primary',
            )}
            key={String(option.value)}
            onClick={() => onPick(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function MusicPicker({
  composers,
  music,
  onPick,
  sessionId,
  tracks,
}: {
  composers: AgentMotionOptions['composers']
  music: MusicPick
  onPick: (music: MusicPick) => void
  sessionId: string
  tracks: AgentMotionOptions['tracks']
}) {
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<null | string>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedTrack =
    music.kind === 'library' ? tracks.find((t) => t.id === music.trackId) : undefined

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const attachment = await uploadAttachment(apiOrigin, sessionId, file, attachmentName(file))
      onPick({ kind: 'upload', name: attachment.name, title: file.name })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Music</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-primary focus:border-white/30 focus:outline-none"
          onChange={(e) => {
            const value = e.target.value
            if (value === 'none') onPick({ kind: 'none' })
            else if (value === 'agent')
              onPick({ engine: composers[0]?.id ?? 'composer', kind: 'agent' })
            else if (value !== 'upload') onPick({ kind: 'library', trackId: value })
          }}
          value={music.kind === 'library' ? music.trackId : music.kind}
        >
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.title} · {track.bpm} BPM
            </option>
          ))}
          {music.kind === 'upload' && <option value="upload">{music.title}</option>}
          <option value="agent">Let the agent make it</option>
          <option value="none">No music</option>
        </select>
        <Button
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          size="sm"
          variant="secondary"
        >
          {uploading ? 'Uploading…' : 'Use my own'}
        </Button>
        <input
          accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0])
            e.target.value = ''
          }}
          ref={fileRef}
          type="file"
        />
      </div>
      {music.kind === 'agent' && (
        <div
          aria-label="How the agent makes it"
          className="flex flex-col gap-1.5"
          role="radiogroup"
        >
          {composers.map((c, i) => (
            <button
              aria-checked={music.engine === c.id}
              className={cn(
                'flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                music.engine === c.id
                  ? 'border-white/50 bg-white/10'
                  : 'border-white/10 hover:border-white/25',
              )}
              key={c.id}
              onClick={() => onPick({ engine: c.id, kind: 'agent' })}
              role="radio"
              type="button"
            >
              <span className="flex items-center gap-2 text-xs font-medium text-primary">
                {c.label}
                <span className="font-normal text-secondary">{c.cost}</span>
                {i === 0 && (
                  <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
                    Recommended
                  </span>
                )}
              </span>
              <span className="text-xs text-secondary">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      {selectedTrack && <TrackPreview src={selectedTrack.previewUrl} />}
      {uploadError && <p className="text-xs text-amber-400">{uploadError}</p>}
    </div>
  )
}

function ReferenceField({
  kind,
  onKind,
  onUrl,
  url,
}: {
  kind: ReferenceKind
  onKind: (kind: ReferenceKind) => void
  onUrl: (url: string) => void
  url: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Reference (optional)</span>
      <ChipRow
        label=""
        onPick={onKind}
        options={[
          { label: 'None', value: 'none' as const },
          { label: 'Copy a YouTube video’s style', value: 'youtube' as const },
          { label: 'Use a website', value: 'website' as const },
        ]}
        selected={kind}
      />
      {kind !== 'none' && (
        <input
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
          onChange={(e) => onUrl(e.target.value)}
          placeholder={
            kind === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://your-product.com'
          }
          type="url"
          value={url}
        />
      )}
      {kind === 'youtube' && (
        <p className="text-xs text-secondary">
          The reel takes its look and rhythm, never its footage or words.
        </p>
      )}
      {kind === 'website' && (
        <p className="text-xs text-secondary">
          Its colours and fonts, and its screenshots when it&apos;s your own site.
        </p>
      )}
    </div>
  )
}

function TrackPreview({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  // A new track: the player loads it from the start.
  useEffect(() => ref.current?.load(), [src])
  return <audio className="h-8 w-full max-w-sm" controls preload="none" ref={ref} src={src} />
}

function TypePicker({
  onPick,
  selected,
  types,
}: {
  onPick: (type: ReelType['id']) => void
  selected: ReelType['id'] | undefined
  types: ReelType[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Kind of reel</span>
      <div aria-label="Kind of reel" className="grid grid-cols-2 gap-2" role="radiogroup">
        {types.map((type) => (
          <button
            aria-checked={type.id === selected}
            className={cn(
              'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
              type.id === selected
                ? 'border-white/70 bg-white/10 ring-1 ring-white/50'
                : 'border-white/10 hover:border-white/30',
            )}
            key={type.id}
            onClick={() => onPick(type.id)}
            role="radio"
            type="button"
          >
            <span className="text-sm font-medium text-primary">{type.label}</span>
            <span className="text-xs text-secondary">{type.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
