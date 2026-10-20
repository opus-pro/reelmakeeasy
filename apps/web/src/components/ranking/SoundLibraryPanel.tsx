'use client'

import type { LibrarySound } from '@shared/types/api/sound-library'
import { Button, cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import type { SoundLibrary } from './useSoundLibrary'

const ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.mp4,.mov,.webm'

/** One preview at a time, across the page: playing a sound stops the one before. */
let current: HTMLAudioElement | null = null
export function previewSound(url: string, onEnd?: () => void): HTMLAudioElement {
  current?.pause()
  const audio = new Audio(url)
  audio.onended = () => onEnd?.()
  void audio.play().catch(() => onEnd?.())
  current = audio
  return audio
}
export function stopPreview() {
  current?.pause()
  current = null
}

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
              previewSound(sound.url, () => setPlaying((p) => (p === sound.id ? null : p)))
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
  useEffect(() => setName(sound.name), [sound.name])
  return (
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
      <span className="w-14 text-right text-xs text-secondary tabular-nums">{sound.durationSec.toFixed(1)} s</span>
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
  )
}
