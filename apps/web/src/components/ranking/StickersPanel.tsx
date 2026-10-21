'use client'

import {
  animationOf,
  STICKER_INS,
  STICKER_LOOPS,
  STICKER_OUTS,
} from '@reelmakeeasy/common/ranking/ranking-motion'
import {
  RANKING_STICKER_TEXT_MAX,
  RANKING_STICKERS_MAX,
  RANKING_TITLE_COLORS,
  rankingItemId,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { RANKING_FONT_FACES, RANKING_FONT_IDS } from '@reelmakeeasy/common/ranking/ranking-type'
import type {
  RankingFontId,
  RankingProject,
  RankingSticker,
  RankingStickerAnimation,
} from '@shared/types/api/ranking'
import { cn } from '@shared/ui'
import { useRef, useState } from 'react'

const INPUT =
  'rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none'
const LABEL = 'text-[11px] font-medium tracking-wide text-secondary uppercase'

/** Emoji the trend uses most, one click away. */
const QUICK_EMOJI = ['😂', '💀', '😳', '🔥', '😱', '🤯', '👀', '😭', '🗿', '💯']
/** Captions the trend uses most, one click away. */
const QUICK_TEXT = ['NO WAY', 'WAIT FOR IT', 'BRO 😭', 'HE KNEW', 'CAUGHT 👀', '💀💀💀']

const IN_LABEL: Record<RankingStickerAnimation['in'], string> = {
  fade: 'Fade',
  none: 'Appear',
  pop: 'Pop',
  'slide-down': 'From top',
  'slide-left': 'From left',
  'slide-right': 'From right',
  'slide-up': 'From bottom',
}
const LOOP_LABEL: Record<RankingStickerAnimation['loop'], string> = {
  float: 'Float',
  none: 'Still',
  pulse: 'Pulse',
  shake: 'Vibrate',
}
const OUT_LABEL: Record<RankingStickerAnimation['out'], string> = {
  fade: 'Fade',
  none: 'Stays',
  pop: 'Pop',
}

/** A new sticker in the middle of the clip area, slightly up, with a pop. */
const newSticker = (over: Partial<RankingSticker>): RankingSticker => ({
  animation: { in: 'pop', loop: 'none', out: 'none' },
  color: '#ffffff',
  id: rankingItemId(),
  kind: 'text',
  rank: null,
  rotation: 0,
  size: 0.06,
  x: 0.5,
  y: 0.45,
  ...over,
})

/** What a sticker shows, short: its text, or "Picture". */
const stickerName = (s: RankingSticker) =>
  s.kind === 'image' ? 'Picture' : s.text?.trim() || 'Text'

/**
 * Effects: text, emoji and pictures on the frame. One click adds one, to the rank on screen or
 * the whole short; it is then selected, to drag on the preview and fine-tune here.
 */
export function StickersPanel({
  focusRank,
  onChange,
  onSelect,
  onUploadImage,
  project,
  selected,
}: {
  /** The rank on screen (new stickers go with it, unless "Whole short" is picked). */
  focusRank: null | number
  onChange: (stickers: RankingSticker[]) => void
  onSelect: (id: null | string) => void
  onUploadImage: (file: File) => Promise<null | string>
  project: RankingProject
  /** The sticker being edited (also outlined on the preview). */
  selected: null | string
}) {
  const stickers = project.stickers ?? []
  const [wholeShort, setWholeShort] = useState(false)
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const full = stickers.length >= RANKING_STICKERS_MAX
  const rank = wholeShort || focusRank === null ? null : focusRank
  const add = (over: Partial<RankingSticker>) => {
    const sticker = newSticker({ rank, ...over })
    onChange([...stickers, sticker])
    onSelect(sticker.id)
  }
  const addText = () => {
    if (!text.trim() || full) return
    add({ text: text.trim() })
    setText('')
  }
  const current = stickers.find((s) => s.id === selected) ?? null
  // The stickers on screen with this rank: its own and the whole short's.
  const onScreen = stickers.filter((s) => s.rank === null || s.rank === focusRank)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>Add</span>
          <div className="flex rounded-md bg-black/30 p-0.5 text-xs" role="radiogroup">
            {focusRank !== null && (
              <button
                aria-checked={!wholeShort}
                className={cn(
                  'rounded px-2 py-0.5',
                  wholeShort ? 'text-secondary hover:text-primary' : 'bg-white/15 text-primary',
                )}
                onClick={() => setWholeShort(false)}
                role="radio"
                type="button"
              >
                With #{focusRank}
              </button>
            )}
            <button
              aria-checked={rank === null}
              className={cn(
                'rounded px-2 py-0.5',
                rank === null ? 'bg-white/15 text-primary' : 'text-secondary hover:text-primary',
              )}
              onClick={() => setWholeShort(true)}
              role="radio"
              type="button"
            >
              Whole short
            </button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {QUICK_EMOJI.map((emoji) => (
            <button
              aria-label={`Add ${emoji}`}
              className="flex h-10 items-center justify-center rounded-lg bg-white/5 text-xl transition-colors hover:bg-white/15 disabled:opacity-30"
              disabled={full}
              key={emoji}
              onClick={() => add({ size: 0.08, text: emoji })}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TEXT.map((caption) => (
            <button
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-primary transition-colors hover:bg-white/15 disabled:opacity-30"
              disabled={full}
              key={caption}
              onClick={() => add({ text: caption })}
              type="button"
            >
              {caption}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            aria-label="Your own text"
            className={cn(INPUT, 'min-w-0 flex-1')}
            maxLength={RANKING_STICKER_TEXT_MAX}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addText()
            }}
            placeholder="Your own text or emoji"
            value={text}
          />
          <button
            className="rounded-md bg-white/10 px-3 text-xs font-medium text-primary hover:bg-white/20 disabled:opacity-40"
            disabled={!text.trim() || full}
            onClick={addText}
            type="button"
          >
            Add
          </button>
          <button
            className="rounded-md bg-white/10 px-3 text-xs font-medium text-primary hover:bg-white/20 disabled:opacity-40"
            disabled={uploading || full}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            {uploading ? 'Uploading…' : 'Picture'}
          </button>
          <input
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setUploading(true)
              void onUploadImage(file)
                .then((imageUrl) => imageUrl && add({ imageUrl, kind: 'image', size: 0.3 }))
                .finally(() => setUploading(false))
            }}
            ref={fileRef}
            type="file"
          />
        </div>
        {full && (
          <p className="text-xs text-secondary">
            That's the most stickers a short takes: remove one first.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>
          {focusRank === null ? 'On screen' : `On screen with #${focusRank}`}
        </span>
        {onScreen.length ? (
          <div className="flex flex-wrap gap-1.5">
            {onScreen.map((s) => (
              <button
                className={cn(
                  'flex max-w-[160px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                  s.id === selected
                    ? 'border-white/60 bg-white/15 text-primary'
                    : 'border-white/10 text-secondary hover:text-primary',
                )}
                key={s.id}
                onClick={() => onSelect(s.id === selected ? null : s.id)}
                type="button"
              >
                {s.kind === 'image' && s.imageUrl && (
                  <img alt="" className="size-4 rounded object-contain" src={s.imageUrl} />
                )}
                <span className="truncate font-semibold">{stickerName(s)}</span>
                {s.rank === null && <span className="text-[10px] text-tertiary">all</span>}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-secondary">Nothing yet: add one above.</p>
        )}
      </div>

      {current && (
        <StickerInspector
          key={current.id}
          onChange={(patch) =>
            onChange(stickers.map((s) => (s.id === current.id ? { ...s, ...patch } : s)))
          }
          onRemove={() => {
            onChange(stickers.filter((s) => s.id !== current.id))
            onSelect(null)
          }}
          ranks={project.items.map((item) => item.rank)}
          sticker={current}
        />
      )}
    </div>
  )
}

/** The selected sticker: what it says, where it shows, its size, angle, colour and motion. */
function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function StickerInspector({
  onChange,
  onRemove,
  ranks,
  sticker,
}: {
  onChange: (patch: Partial<RankingSticker>) => void
  onRemove: () => void
  ranks: number[]
  sticker: RankingSticker
}) {
  const animation = animationOf(sticker)
  const setAnimation = (patch: Partial<RankingStickerAnimation>) =>
    onChange({ animation: { ...animation, ...patch } })
  const seconds = (value: string) => (value.trim() === '' ? undefined : Math.max(0, Number(value)))
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/15 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        {sticker.kind === 'text' ? (
          <input
            aria-label="Sticker text"
            className={cn(INPUT, 'min-w-0 flex-1 font-bold')}
            maxLength={RANKING_STICKER_TEXT_MAX}
            onChange={(e) => onChange({ text: e.target.value })}
            style={{ color: sticker.color }}
            value={sticker.text ?? ''}
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-primary">
            {sticker.imageUrl && (
              <img alt="" className="size-8 rounded object-contain" src={sticker.imageUrl} />
            )}
            Picture
          </span>
        )}
        <button
          className="rounded-md px-2 py-1 text-xs text-secondary hover:bg-white/10 hover:text-primary"
          onClick={onRemove}
          type="button"
        >
          Delete
        </button>
      </div>
      <p className="text-xs text-secondary">Drag it on the preview to move it.</p>

      <Field label="Shows">
        <select
          aria-label="Shows with"
          className={cn(INPUT, 'py-0.5 text-xs')}
          onChange={(e) =>
            onChange({ rank: e.target.value === 'all' ? null : Number(e.target.value) })
          }
          value={sticker.rank === null ? 'all' : String(sticker.rank)}
        >
          <option value="all">The whole short</option>
          {ranks.map((rank) => (
            <option key={rank} value={rank}>
              With #{rank}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Size">
        <input
          aria-label="Size"
          className="flex-1"
          max={sticker.kind === 'text' ? 20 : 100}
          min={sticker.kind === 'text' ? 2 : 5}
          onChange={(e) => onChange({ size: Number(e.target.value) / 100 })}
          type="range"
          value={Math.round(sticker.size * 100)}
        />
      </Field>
      <Field label="Angle">
        <input
          aria-label="Angle"
          className="flex-1"
          max={45}
          min={-45}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          type="range"
          value={sticker.rotation}
        />
        <span className="w-8 text-right text-xs text-secondary tabular-nums">
          {sticker.rotation}°
        </span>
      </Field>
      {sticker.kind === 'text' && (
        <>
          <Field label="Colour">
            <div className="flex items-center gap-1.5">
              {RANKING_TITLE_COLORS.map((c) => (
                <button
                  aria-label={`Colour ${c}`}
                  className={cn(
                    'size-5 rounded-full border',
                    c === sticker.color.toLowerCase()
                      ? 'border-white ring-1 ring-white'
                      : 'border-white/30',
                  )}
                  key={c}
                  onClick={() => onChange({ color: c })}
                  style={{ background: c }}
                  type="button"
                />
              ))}
            </div>
          </Field>
          <Field label="Font">
            <select
              aria-label="Sticker font"
              className={cn(INPUT, 'py-0.5 text-xs')}
              onChange={(e) =>
                onChange({ font: (e.target.value || undefined) as RankingFontId | undefined })
              }
              value={sticker.font ?? ''}
            >
              <option value="">Like the labels</option>
              {RANKING_FONT_IDS.map((id) => (
                <option key={id} value={id}>
                  {RANKING_FONT_FACES[id].label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-secondary">
              <input
                checked={!!sticker.italic}
                onChange={(e) => onChange({ italic: e.target.checked })}
                type="checkbox"
              />
              Slant
            </label>
          </Field>
        </>
      )}
      <Chips
        label="In"
        names={IN_LABEL}
        onPick={(v) => setAnimation({ in: v })}
        options={STICKER_INS}
        value={animation.in}
      />
      <Chips
        label="Move"
        names={LOOP_LABEL}
        onPick={(v) => setAnimation({ loop: v })}
        options={STICKER_LOOPS}
        value={animation.loop}
      />
      <Chips
        label="Out"
        names={OUT_LABEL}
        onPick={(v) => setAnimation({ out: v })}
        options={STICKER_OUTS}
        value={animation.out}
      />
      <Field label="When">
        <span className="text-xs text-secondary">from</span>
        <input
          aria-label="Shows from (seconds)"
          className={cn(INPUT, 'w-16 py-0.5 text-xs')}
          min={0}
          onChange={(e) => onChange({ startSec: seconds(e.target.value) })}
          placeholder="0"
          step={0.1}
          type="number"
          value={sticker.startSec ?? ''}
        />
        <span className="text-xs text-secondary">to</span>
        <input
          aria-label="Shows until (seconds)"
          className={cn(INPUT, 'w-16 py-0.5 text-xs')}
          min={0}
          onChange={(e) => onChange({ endSec: seconds(e.target.value) ?? null })}
          placeholder="end"
          step={0.1}
          type="number"
          value={sticker.endSec ?? ''}
        />
        <span className="text-xs text-secondary">s</span>
      </Field>
    </div>
  )
}

/** One choice as a row of chips (a sticker's entrance, movement or exit). */
function Chips<T extends string>({
  label,
  names,
  onPick,
  options,
  value,
}: {
  label: string
  names: Record<T, string>
  onPick: (value: T) => void
  options: readonly T[]
  value: T
}) {
  return (
    <Field label={label}>
      <div aria-label={label} className="flex flex-wrap gap-1" role="radiogroup">
        {options.map((option) => (
          <button
            aria-checked={option === value}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              option === value
                ? 'bg-white text-black'
                : 'bg-white/5 text-secondary hover:bg-white/15 hover:text-primary',
            )}
            key={option}
            onClick={() => onPick(option)}
            role="radio"
            type="button"
          >
            {names[option]}
          </button>
        ))}
      </div>
    </Field>
  )
}
