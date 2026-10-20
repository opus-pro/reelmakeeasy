'use client'

import {
  DEFAULT_RANKING_SOUNDS,
  DEFAULT_RANKING_TRANSITION,
  RANKING_TRANSITION_MAX_SEC,
  RANKING_TRANSITION_MIN_SEC,
  RANKING_TRANSITION_TEXT_MAX,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingSounds, RankingTransition } from '@shared/types/api/ranking'
import type { LibrarySound } from '@shared/types/api/sound-library'
import { cn } from '@shared/ui'

import { previewSound } from './SoundLibraryPanel'

const SECTION = 'flex flex-col gap-2 rounded-xl border border-white/10 bg-fill-secondary/40 p-3'
const HEADING = 'text-xs font-semibold tracking-wide text-secondary uppercase'
const INPUT =
  'rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none'

/** A sound from the library (favourites first, as the library sorts them), with a play button. */
export function SoundPicker({
  label,
  onChange,
  sounds,
  value,
}: {
  label: string
  onChange: (id: null | string) => void
  sounds: LibrarySound[]
  value: null | string
}) {
  const chosen = sounds.find((s) => s.id === value)
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-secondary">
      <span className="w-24">{label}</span>
      <select
        className={cn(INPUT, 'min-w-0 flex-1')}
        onChange={(e) => onChange(e.target.value || null)}
        value={chosen ? chosen.id : ''}
      >
        <option value="">None</option>
        {sounds.map((s) => (
          <option key={s.id} value={s.id}>
            {s.favorite ? '★ ' : ''}
            {s.name} · {s.durationSec.toFixed(1)} s
          </option>
        ))}
      </select>
      <button
        aria-label={`Play ${label}`}
        className="rounded-md bg-white/10 px-2 py-1 text-primary hover:bg-white/20 disabled:opacity-30"
        disabled={!chosen}
        onClick={(e) => {
          e.preventDefault()
          if (chosen) previewSound(chosen.url)
        }}
        type="button"
      >
        ▶
      </button>
    </label>
  )
}

/** The short's sounds: one that plays on every reveal, and a music bed under everything. */
export function SoundsPanel({
  onChange,
  onOpenLibrary,
  sounds,
  value,
}: {
  onChange: (sounds: RankingSounds) => void
  onOpenLibrary: () => void
  sounds: LibrarySound[]
  value: RankingSounds | undefined
}) {
  const v = value ?? DEFAULT_RANKING_SOUNDS
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between">
        <span className={HEADING}>Sound</span>
        <button className="text-xs text-secondary underline hover:text-primary" onClick={onOpenLibrary} type="button">
          Sound library
        </button>
      </div>
      {sounds.length === 0 && (
        <p className="text-xs text-secondary">Upload sound effects and music to your sound library to use them here.</p>
      )}
      <SoundPicker label="On each reveal" onChange={(reveal) => onChange({ ...v, reveal })} sounds={sounds} value={v.reveal} />
      <SoundPicker label="Background" onChange={(music) => onChange({ ...v, music })} sounds={sounds} value={v.music} />
      {v.music && (
        <label className="flex items-center gap-2 text-xs text-secondary">
          <span className="w-24">Music level</span>
          <input
            className="flex-1"
            max={100}
            min={0}
            onChange={(e) => onChange({ ...v, musicVolume: Number(e.target.value) / 100 })}
            type="range"
            value={Math.round(v.musicVolume * 100)}
          />
          <span className="w-10 text-right tabular-nums">{Math.round(v.musicVolume * 100)}%</span>
        </label>
      )}
    </section>
  )
}

/** The slide between ranks: on or off, its text, colours, length and sound. */
export function TransitionPanel({
  onChange,
  sounds,
  value,
}: {
  onChange: (transition: RankingTransition) => void
  sounds: LibrarySound[]
  value: RankingTransition | undefined
}) {
  const v = value ?? DEFAULT_RANKING_TRANSITION
  return (
    <section className={SECTION}>
      <label className="flex items-center justify-between">
        <span className={HEADING}>Transition between ranks</span>
        <input checked={v.enabled} onChange={(e) => onChange({ ...v, enabled: e.target.checked })} type="checkbox" />
      </label>
      {v.enabled && (
        <>
          <label className="flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="w-24">Text</span>
            <input
              className={cn(INPUT, 'min-w-0 flex-1')}
              maxLength={RANKING_TRANSITION_TEXT_MAX}
              onChange={(e) => onChange({ ...v, text: e.target.value })}
              placeholder="Number {rank}…"
              value={v.text}
            />
          </label>
          <p className="pl-[104px] text-xs text-secondary">{'{rank}'} becomes the next rank’s number.</p>
          <div className="flex flex-wrap items-center gap-4 text-xs text-secondary">
            <label className="flex items-center gap-1.5">
              <input
                className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
                onChange={(e) => onChange({ ...v, background: e.target.value })}
                type="color"
                value={v.background}
              />
              Background
            </label>
            <label className="flex items-center gap-1.5">
              <input
                className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
                onChange={(e) => onChange({ ...v, textColor: e.target.value })}
                type="color"
                value={v.textColor}
              />
              Text
            </label>
            <label className="flex items-center gap-1.5">
              Length
              <input
                className="w-24"
                max={RANKING_TRANSITION_MAX_SEC}
                min={RANKING_TRANSITION_MIN_SEC}
                onChange={(e) => onChange({ ...v, durationSec: Number(e.target.value) })}
                step={0.1}
                type="range"
                value={v.durationSec}
              />
              <span className="tabular-nums">{v.durationSec.toFixed(1)} s</span>
            </label>
          </div>
          <SoundPicker label="Sound" onChange={(sound) => onChange({ ...v, sound })} sounds={sounds} value={v.sound} />
        </>
      )}
    </section>
  )
}
