'use client'

import {
  RANKING_STICKER_TEXT_MAX,
  RANKING_STICKERS_MAX,
  RANKING_TITLE_COLORS,
  rankingItemId,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { animationOf, STICKER_INS, STICKER_LOOPS, STICKER_OUTS } from '@reelmakeeasy/common/ranking/ranking-motion'
import { RANKING_FONT_FACES, RANKING_FONT_IDS } from '@reelmakeeasy/common/ranking/ranking-type'
import type { RankingFontId, RankingProject, RankingSticker, RankingStickerAnimation } from '@shared/types/api/ranking'
import { Button, cn } from '@shared/ui'
import { useRef, useState } from 'react'

const SECTION = 'flex flex-col gap-2 rounded-xl border border-white/10 bg-fill-secondary/40 p-3'
const HEADING = 'text-xs font-semibold tracking-wide text-secondary uppercase'
const INPUT =
  'rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none'

/** Emoji the trend uses most, one click away. */
const QUICK_EMOJI = ['😂', '💀', '😳', '🔥', '😱', '🤯', '👀', '😭', '🗿', '💯']

const IN_LABEL: Record<RankingStickerAnimation['in'], string> = {
  fade: 'Fade in',
  none: 'Just appears',
  pop: 'Pop in',
  'slide-down': 'Slide from top',
  'slide-left': 'Slide from left',
  'slide-right': 'Slide from right',
  'slide-up': 'Slide from bottom',
}
const LOOP_LABEL: Record<RankingStickerAnimation['loop'], string> = {
  float: 'Float',
  none: 'Still',
  pulse: 'Pulse',
  shake: 'Vibrate',
}
const OUT_LABEL: Record<RankingStickerAnimation['out'], string> = {
  fade: 'Fade out',
  none: 'Stays to the end',
  pop: 'Pop out',
}

/** A new sticker in the middle of the clip area, slightly up. */
const newSticker = (over: Partial<RankingSticker>): RankingSticker => ({
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

/**
 * Text, emoji and pictures on the frame. Each one shows over the whole short or only while one
 * rank plays; drag it on the preview to place it, and set its size and angle here.
 */
export function StickersPanel({
  onChange,
  onUploadImage,
  project,
}: {
  onChange: (stickers: RankingSticker[]) => void
  onUploadImage: (file: File) => Promise<null | string>
  project: RankingProject
}) {
  const stickers = project.stickers ?? []
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const full = stickers.length >= RANKING_STICKERS_MAX
  const add = (sticker: RankingSticker) => onChange([...stickers, sticker])
  const set = (id: string, patch: Partial<RankingSticker>) =>
    onChange(stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between">
        <span className={HEADING}>Stickers</span>
        <span className="text-xs text-secondary">drag them on the preview</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          aria-label="Sticker text"
          className={cn(INPUT, 'min-w-0 flex-1')}
          maxLength={RANKING_STICKER_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() && !full) {
              add(newSticker({ text: text.trim() }))
              setText('')
            }
          }}
          placeholder="Text or emoji, e.g. NO WAY 💀"
          value={text}
        />
        <Button
          disabled={!text.trim() || full}
          onClick={() => {
            add(newSticker({ text: text.trim() }))
            setText('')
          }}
          size="sm"
          variant="secondary"
        >
          Add text
        </Button>
        <Button disabled={uploading || full} onClick={() => fileRef.current?.click()} size="sm" variant="secondary">
          {uploading ? 'Uploading…' : 'Add picture'}
        </Button>
        <input
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setUploading(true)
            void onUploadImage(file)
              .then((imageUrl) => imageUrl && add(newSticker({ imageUrl, kind: 'image', size: 0.3 })))
              .finally(() => setUploading(false))
          }}
          ref={fileRef}
          type="file"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_EMOJI.map((emoji) => (
          <button
            className="rounded-md bg-white/5 px-1.5 py-0.5 text-lg hover:bg-white/15 disabled:opacity-30"
            disabled={full}
            key={emoji}
            onClick={() => add(newSticker({ size: 0.08, text: emoji }))}
            title={`Add ${emoji}`}
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>
      {stickers.map((sticker) => (
        <StickerRow
          key={sticker.id}
          onChange={(patch) => set(sticker.id, patch)}
          onRemove={() => onChange(stickers.filter((s) => s.id !== sticker.id))}
          ranks={project.items.map((item) => item.rank)}
          sticker={sticker}
        />
      ))}
    </section>
  )
}

function StickerRow({
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
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 p-2 text-xs text-secondary">
      {sticker.kind === 'text' ? (
        <input
          aria-label="Sticker text"
          className={cn(INPUT, 'w-36 font-bold')}
          maxLength={RANKING_STICKER_TEXT_MAX}
          onChange={(e) => onChange({ text: e.target.value })}
          style={{ color: sticker.color }}
          value={sticker.text ?? ''}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- the user's own picture, from the API
        <img alt="" className="size-8 rounded object-contain" src={sticker.imageUrl} />
      )}
      <label className="flex items-center gap-1">
        Shows
        <select
          className={cn(INPUT, 'py-0.5 text-xs')}
          onChange={(e) => onChange({ rank: e.target.value === 'all' ? null : Number(e.target.value) })}
          value={sticker.rank === null ? 'all' : String(sticker.rank)}
        >
          <option value="all">whole short</option>
          {ranks.map((rank) => (
            <option key={rank} value={rank}>
              with #{rank}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        Size
        <input
          className="w-20"
          max={sticker.kind === 'text' ? 20 : 100}
          min={sticker.kind === 'text' ? 2 : 5}
          onChange={(e) => onChange({ size: Number(e.target.value) / 100 })}
          type="range"
          value={Math.round(sticker.size * 100)}
        />
      </label>
      {sticker.kind === 'text' && (
        <>
          <select
            aria-label="Sticker font"
            className={cn(INPUT, 'py-0.5 text-xs')}
            onChange={(e) => onChange({ font: (e.target.value || undefined) as RankingFontId | undefined })}
            value={sticker.font ?? ''}
          >
            <option value="">Labels’ font</option>
            {RANKING_FONT_IDS.map((id) => (
              <option key={id} value={id}>
                {RANKING_FONT_FACES[id].label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input checked={!!sticker.italic} onChange={(e) => onChange({ italic: e.target.checked })} type="checkbox" />
            Slant
          </label>
        </>
      )}
      <label className="flex items-center gap-1">
        Angle
        <input
          className="w-16"
          max={45}
          min={-45}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          type="range"
          value={sticker.rotation}
        />
      </label>
      {sticker.kind === 'text' && (
        <div className="flex items-center gap-1">
          {RANKING_TITLE_COLORS.map((c) => (
            <button
              aria-label={`Colour ${c}`}
              className={cn(
                'size-4 rounded-full border',
                c === sticker.color.toLowerCase() ? 'border-white ring-1 ring-white' : 'border-white/30',
              )}
              key={c}
              onClick={() => onChange({ color: c })}
              style={{ background: c }}
              type="button"
            />
          ))}
        </div>
      )}
      <button aria-label="Remove sticker" className="ml-auto hover:text-primary" onClick={onRemove} type="button">
        ✕
      </button>
      <StickerMotion onChange={onChange} sticker={sticker} />
    </div>
  )
}

/** When a sticker shows (seconds into its rank's clip, or the short) and how it moves. */
function StickerMotion({
  onChange,
  sticker,
}: {
  onChange: (patch: Partial<RankingSticker>) => void
  sticker: RankingSticker
}) {
  const animation = animationOf(sticker)
  const setAnimation = (patch: Partial<RankingStickerAnimation>) => onChange({ animation: { ...animation, ...patch } })
  const seconds = (value: string) => (value.trim() === '' ? undefined : Math.max(0, Number(value)))
  const select = <T extends string>(label: string, value: T, options: T[], names: Record<T, string>, set: (v: T) => void) => (
    <select aria-label={label} className={cn(INPUT, 'py-0.5 text-xs')} onChange={(e) => set(e.target.value as T)} value={value}>
      {options.map((o) => (
        <option key={o} value={o}>
          {names[o]}
        </option>
      ))}
    </select>
  )
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5">
      {select('Entrance', animation.in, STICKER_INS, IN_LABEL, (v) => setAnimation({ in: v }))}
      {select('Movement', animation.loop, STICKER_LOOPS, LOOP_LABEL, (v) => setAnimation({ loop: v }))}
      {select('Exit', animation.out, STICKER_OUTS, OUT_LABEL, (v) => setAnimation({ out: v }))}
      <label className="flex items-center gap-1">
        from
        <input
          aria-label="Shows from (seconds)"
          className={cn(INPUT, 'w-14 py-0.5 text-xs')}
          min={0}
          onChange={(e) => onChange({ startSec: seconds(e.target.value) })}
          placeholder="0"
          step={0.1}
          type="number"
          value={sticker.startSec ?? ''}
        />
      </label>
      <label className="flex items-center gap-1">
        to
        <input
          aria-label="Shows until (seconds)"
          className={cn(INPUT, 'w-14 py-0.5 text-xs')}
          min={0}
          onChange={(e) => onChange({ endSec: seconds(e.target.value) ?? null })}
          placeholder="end"
          step={0.1}
          type="number"
          value={sticker.endSec ?? ''}
        />
        s
      </label>
    </div>
  )
}
