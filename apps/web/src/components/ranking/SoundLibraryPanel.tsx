'use client'

import { type LibrarySound, soundPlayback } from '@shared/types/api/sound-library'
import { Button, cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { previewSound, stopPreview } from './sound-player'
import type { SoundLibrary } from './useSoundLibrary'

const ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.mp4,.mov,.webm'

/**
 * The sound library: the user's own effects and beds. Upload (several at once), play, rename,
 * star (starred ones stay on top), remove; each shows how often exports used it.
 */
export function SoundLibraryPanel({ library }: { library: SoundLibrary }) {
  const { error, sounds, upload, uploading } = library
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<null | string>(null)
  useEffect(() => stopPreview, [])

  const shown = (sounds ?? []).filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="flex w-full max-w-[880px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={uploading > 0} onClick={() => fileRef.current?.click()}>
          {uploading > 0 ? `Uploading ${uploading}…` : 'Upload sounds'}
        </Button>
        <input
          accept={ACCEPT}
          className="hidden"
          multiple
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void upload(files)
          }}
          ref={fileRef}
          type="file"
        />
        <input
          aria-label="Search sounds"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={sounds?.length ? `Search ${sounds.length} sounds` : 'Search sounds'}
          value={query}
        />
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
      {sounds === null && <p className="text-sm text-secondary">Loading…</p>}
      {sounds?.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-secondary">
          No sounds yet. Upload the effects and short music you use in your rankings (mp3, wav, m4a…).
        </p>
      )}
      <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10">
        {shown.map((sound) => (
          <SoundRow
            key={sound.id}
            library={library}
            onPlay={() => {
              if (playing === sound.id) {
                stopPreview()
                setPlaying(null)
                return
              }
              setPlaying(sound.id)
              previewSound(sound, () => setPlaying((p) => (p === sound.id ? null : p)))
            }}
            playing={playing === sound.id}
            sound={sound}
          />
        ))}
      </div>
    </div>
  )
}

function SoundRow({
  library,
  onPlay,
  playing,
  sound,
}: {
  library: SoundLibrary
  onPlay: () => void
  playing: boolean
  sound: LibrarySound
}) {
  const [name, setName] = useState(sound.name)
  const [adjusting, setAdjusting] = useState(false)
  useEffect(() => setName(sound.name), [sound.name])
  const { endSec, startSec, volume } = soundPlayback(sound)
  const trimmed = startSec > 0 || endSec < sound.durationSec - 0.01
  return (
    <div className="flex flex-col">
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        aria-label={playing ? `Stop ${sound.name}` : `Play ${sound.name}`}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full text-sm',
          playing ? 'bg-white text-black' : 'bg-white/10 text-primary hover:bg-white/20',
        )}
        onClick={onPlay}
        type="button"
      >
        {playing ? '■' : '▶'}
      </button>
      <input
        aria-label="Sound name"
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-primary hover:border-white/10 focus:border-white/30 focus:outline-none"
        maxLength={80}
        onBlur={() => name.trim() && name !== sound.name && void library.update(sound.id, { name })}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        value={name}
      />
      <span className="w-20 text-right text-xs text-secondary tabular-nums" title={trimmed ? `Plays ${startSec.toFixed(1)}–${endSec.toFixed(1)} s` : undefined}>
        {trimmed ? `${(endSec - startSec).toFixed(1)} of ` : ''}
        {sound.durationSec.toFixed(1)} s
      </span>
      {volume !== 1 && <span className="w-10 text-right text-xs text-secondary tabular-nums">{Math.round(volume * 100)}%</span>}
      <button
        aria-expanded={adjusting}
        className={cn('text-xs underline-offset-2 hover:text-primary', adjusting ? 'text-primary underline' : 'text-secondary')}
        onClick={() => setAdjusting((a) => !a)}
        type="button"
      >
        Adjust
      </button>
      <span className="w-16 text-right text-xs text-secondary tabular-nums" title="Exports that used it">
        {sound.uses ? `used ${sound.uses}×` : 'unused'}
      </span>
      <button
        aria-label={sound.favorite ? `Unstar ${sound.name}` : `Star ${sound.name}`}
        aria-pressed={sound.favorite}
        className={cn('text-lg', sound.favorite ? 'text-[#ffd400]' : 'text-white/30 hover:text-white/70')}
        onClick={() => void library.update(sound.id, { favorite: !sound.favorite })}
        type="button"
      >
        ★
      </button>
      <button
        aria-label={`Remove ${sound.name}`}
        className="text-sm text-secondary hover:text-primary"
        onClick={() => {
          if (window.confirm(`Remove “${sound.name}” from your library?`)) void library.remove(sound.id)
        }}
        type="button"
      >
        ✕
      </button>
    </div>
    {adjusting && <SoundAdjust library={library} sound={sound} />}
    </div>
  )
}

/** A sound's part and level: from/to (seconds) and volume (0-200%), saved as they change. */
function SoundAdjust({ library, sound }: { library: SoundLibrary; sound: LibrarySound }) {
  const playback = soundPlayback(sound)
  const [start, setStart] = useState(playback.startSec)
  const [end, setEnd] = useState(playback.endSec)
  const [volume, setVolume] = useState(playback.volume)
  const save = (patch: { trimEndSec?: null | number; trimStartSec?: number; volume?: number }) =>
    void library.update(sound.id, patch)
  const commitTrim = (s: number, e: number) => {
    const startSec = Math.max(0, Math.min(s, sound.durationSec - 0.1))
    const endSec = Math.min(sound.durationSec, Math.max(startSec + 0.1, e))
    setStart(round1(startSec))
    setEnd(round1(endSec))
    save({ trimEndSec: endSec >= sound.durationSec - 0.01 ? null : round1(endSec), trimStartSec: round1(startSec) })
  }
  const field =
    'w-16 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-xs text-primary focus:border-white/30 focus:outline-none'
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white/[0.03] px-3 py-2 pl-14 text-xs text-secondary">
      <span>Play</span>
      <label className="flex items-center gap-1">
        from
        <input className={field} max={sound.durationSec} min={0} onBlur={() => commitTrim(start, end)} onChange={(e) => setStart(Number(e.target.value))} step={0.1} type="number" value={start} />
      </label>
      <label className="flex items-center gap-1">
        to
        <input className={field} max={sound.durationSec} min={0} onBlur={() => commitTrim(start, end)} onChange={(e) => setEnd(Number(e.target.value))} step={0.1} type="number" value={end} />
        <span>of {sound.durationSec.toFixed(1)} s</span>
      </label>
      <button className="underline hover:text-primary" onClick={() => commitTrim(0, sound.durationSec)} type="button">
        Whole sound
      </button>
      <label className="flex items-center gap-2">
        Volume
        <input
          aria-label={`${sound.name} volume`}
          className="w-28"
          max={200}
          min={0}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          onPointerUp={() => save({ volume })}
          onKeyUp={() => save({ volume })}
          type="range"
          value={Math.round(volume * 100)}
        />
        <span className="w-10 tabular-nums">{Math.round(volume * 100)}%</span>
      </label>
    </div>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10
