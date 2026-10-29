'use client'

import {
  VIDEO_DEFAULT_DETAIL,
  VIDEO_DETAIL_LABEL,
  VIDEO_DETAILS,
} from '@reelmakeeasy/common/motion-reel/video-detail'
import type { AgentMotionOptions, AgentMotionSetup, VideoDetail } from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import { attachmentName, uploadAttachment } from '../attachments/attachments'
import { effortLabel } from '../models/chat-model'
import { useSharedChatModel } from '../models/useChatModel'

/** Pieces the Motion Reel and Claude Animation setup cards share: the card and label styles, a
 *  row of chips, the detail level, the effort slider and the music picker. */

export const CARD_CLASS =
  'flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-white/10 bg-fill-secondary/50 p-4'
export const LABEL_CLASS = 'text-xs font-medium tracking-wide text-secondary uppercase'
/** How a chosen setup names music the agent is still to make. */
export const COMPOSER_LABEL: Record<string, string> = {
  composer: 'Composed by Claude, to come',
  'ace-step': 'ACE-Step music, to come',
  'eleven-music': 'ElevenLabs Music, to come',
}

type Composer = AgentMotionOptions['composers'][number]['id']
export type MusicPick =
  | { engine: Composer; kind: 'agent' }
  | { kind: 'library'; trackId: string }
  | { kind: 'none' }
  | { kind: 'upload'; name: string; title: string }

/** The picked music as the setup cards send it. */
export function musicChoice(music: MusicPick): AgentMotionSetup['music'] {
  return music.kind === 'library'
    ? { id: music.trackId, source: 'library' }
    : music.kind === 'upload'
      ? { id: music.name, source: 'upload' }
      : music.kind === 'agent'
        ? { engine: music.engine, source: 'agent' }
        : { source: 'none' }
}

export function ChipRow<T extends number | string>({
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

/** Where a slider stop sits on the track, the ends inset by half the thumb. */
const stopAt = (i: number, stops: number) =>
  `calc(1.375rem + (100% - 2.75rem) * ${stops > 1 ? i / (stops - 1) : 0})`

/**
 * A row of levels as a bar to drag or click (the setup cards' Detail and Effort): the picked
 * level's name (marked when recommended), the ends' names, a dotted track with a stop per level
 * and the thumb on the picked one, and what the level means.
 */
function LevelSlider<T extends string>({
  footnote,
  label,
  levels,
  low,
  meaning,
  onPick,
  recommended,
  selected,
}: {
  /** What more of it costs, under the meaning. */
  footnote: string
  label: string
  /** From least to most. */
  levels: readonly { label: string; value: T }[]
  /** The low end's name ("Faster"); the high end shows the top level's own. */
  low: string
  /** What the picked level means. */
  meaning?: string
  onPick: (value: T) => void
  recommended?: T
  selected: T
}) {
  const index = Math.max(
    0,
    levels.findIndex((l) => l.value === selected),
  )
  const picked = levels[index]
  if (!picked) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className={LABEL_CLASS}>{label}</span>
        <span className="text-sm font-medium text-violet-300">{picked.label}</span>
        {recommended === picked.value && (
          <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
            Recommended
          </span>
        )}
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <span className="flex justify-between text-xs text-secondary">
          <span>{low}</span>
          <span>{levels[levels.length - 1]?.label}</span>
        </span>
        <div className="relative h-11 rounded-xl border border-white/10 bg-black/30">
          <span
            aria-hidden
            className="absolute inset-x-3 inset-y-2.5"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgb(255 255 255 / 0.6) 1px, transparent 1.6px)',
              backgroundSize: '7px 7px',
              maskImage: 'linear-gradient(to right, rgb(0 0 0 / 0.25), #000)',
            }}
          />
          {levels.map((level, i) =>
            i === index ? null : (
              <span
                aria-hidden
                className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70"
                key={level.value}
                style={{ left: stopAt(i, levels.length) }}
              />
            ),
          )}
          <span
            aria-hidden
            className="absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white shadow-[0_0_18px_rgb(255_255_255/0.35)] transition-[left] duration-200"
            style={{ left: stopAt(index, levels.length) }}
          />
          <input
            aria-label={label}
            aria-valuetext={picked.label}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            max={levels.length - 1}
            min={0}
            onChange={(e) => {
              const next = levels[Number(e.target.value)]
              if (next && next.value !== picked.value) onPick(next.value)
            }}
            step={1}
            type="range"
            value={index}
          />
        </div>
      </div>
      {meaning && <span className="text-xs text-secondary">{meaning}</span>}
      <span className="text-xs text-tertiary">{footnote}</span>
    </div>
  )
}

const DETAIL_LEVELS = VIDEO_DETAILS.map((value) => ({ label: VIDEO_DETAIL_LABEL[value], value }))

/** What each detail level means on screen. */
const DETAIL_TEXT: Record<VideoDetail, string> = {
  high: 'Rich: layered depth, textured light, follow-through on every move, and particles on the big moments.',
  low: 'Clean and simple: a few bold shapes per scene, flat colours and simple cuts.',
  medium:
    'Polished: more on screen, eased moves, a drifting background and small particle accents.',
  xhigh: 'Film grade: fine parts, thousands of particles, and scenes that break apart and re-form.',
}

/** How much detail the agent builds in, and what it costs. */
export function DetailPicker({
  detail,
  onPick,
}: {
  detail: VideoDetail
  onPick: (detail: VideoDetail) => void
}) {
  return (
    <LevelSlider
      footnote="More detail takes longer and uses more tokens, and looks better."
      label="Detail"
      levels={DETAIL_LEVELS}
      low="Simpler"
      meaning={DETAIL_TEXT[detail]}
      onPick={onPick}
      recommended={VIDEO_DEFAULT_DETAIL}
      selected={detail}
    />
  )
}

/** What each thinking level means while the agent builds a code video. */
const EFFORT_TEXT: Record<string, (agent: string) => string> = {
  high: (agent) =>
    `${agent} thinks longer before each step: better timing and scenes, and a longer build.`,
  medium: (agent) =>
    `${agent} thinks briefly before each step: the quickest build, and the lightest on your plan.`,
  xhigh: (agent) =>
    `${agent} thinks hardest before each step: the best plan, timing and finish, and the longest build.`,
}

/**
 * How hard the agent thinks while it builds (its thinking level), from Faster up to the highest
 * level a code video offers (Extra high). It reads and sets the chat's model, so the model bar
 * under the chat box shows the same level. Hidden until the model list loads, and when the
 * model has fewer than two levels.
 */
export function EffortSlider() {
  const model = useSharedChatModel()
  const state = model?.state
  const current = state?.current
  // The level just picked, shown at once while the pick is saved.
  const [picked, setPicked] = useState<null | string>(null)
  useEffect(() => {
    if (picked && (current?.effort === picked || model?.error)) setPicked(null)
  }, [current?.effort, model?.error, picked])
  const efforts = state?.models.find((m) => m.id === current?.model)?.efforts ?? []
  if (!model || !state || !current?.effort || efforts.length < 2) return null
  const effort = picked ?? current.effort
  const agent = state.harness === 'claude' ? 'Claude' : 'Codex'
  return (
    <LevelSlider
      footnote={`More effort uses more of your ${agent} plan (a longer build) for a better video.`}
      label="Effort"
      levels={efforts.map((value) => ({ label: effortLabel(value), value }))}
      low="Faster"
      meaning={EFFORT_TEXT[effort]?.(agent)}
      onPick={(next) => {
        setPicked(next)
        void model.pick({ effort: next, model: current.model })
      }}
      {...(state.recommended?.effort ? { recommended: state.recommended.effort } : {})}
      selected={effort}
    />
  )
}

export function MusicPicker({
  agentName = 'the agent',
  composers,
  music,
  onPick,
  sessionId,
  tracks,
}: {
  /** Who makes the music when the user asks for it ("Let the agent make it"). */
  agentName?: string
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
              onPick({ engine: composers[0]?.id ?? 'eleven-music', kind: 'agent' })
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
          <option value="agent">Let {agentName} make it</option>
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

function TrackPreview({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  // A new track: the player loads it from the start.
  useEffect(() => ref.current?.load(), [src])
  return <audio className="h-8 w-full max-w-sm" controls preload="none" ref={ref} src={src} />
}
