'use client'

import type { AgentMotionOptions, AgentMotionSetup } from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import { attachmentName, uploadAttachment } from '../attachments/attachments'

/** Pieces the Motion Reel and Claude Animation setup cards share: the card and label styles, a
 *  row of chips, and the music picker. */

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
