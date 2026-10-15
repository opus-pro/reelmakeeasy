'use client'

import type { CaptionFontChoice, CaptionPackFamily } from '@shared/types/api/caption-style'
import { cn } from '@shared/ui'
import { useId, useRef, useState } from 'react'

import { CheckMark, ChevronDownSmall } from '@/components/icons/core'

import { CAPTION_PACK_FAMILIES, STYLE_DEFAULT_FONT } from './caption-fonts'
import { useCaptionFontSamples } from './useCaptionFonts'

const rowClass =
  'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-primary transition-colors hover:bg-fill-hover'

/**
 * The caption font: the style's own (Montserrat) or one of the built-in fonts, one per video.
 * A button with the current font's name opens the list in place (it works the same in the
 * editor and inside the chat's Style popover, and on a phone); each name is drawn in its own
 * font once its sample is in. A pick closes the list and calls `onPick` (null: the style's own).
 */
export function CaptionFontPicker({
  disabled,
  family,
  onPick,
}: {
  disabled: boolean
  /** The built-in font chosen; null for the style's own. */
  family: CaptionPackFamily | null
  onPick: (font: CaptionFontChoice | null) => void
}) {
  const [open, setOpen] = useState(false)
  const drawn = useCaptionFontSamples(open)
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const name = family ?? 'Style default'

  const pick = (font: CaptionFontChoice | null) => {
    setOpen(false)
    onPick(font)
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-label={`Caption font: ${name}`}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-white/10 px-3 text-left text-sm text-primary transition-colors hover:bg-fill-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        ref={toggleRef}
        type="button"
      >
        <FontName
          className="min-w-0 flex-1 truncate"
          name={name}
          sample={family && drawn[family]}
        />
        {!family && <span className="shrink-0 text-xs text-secondary">{STYLE_DEFAULT_FONT}</span>}
        <ChevronDownSmall
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          aria-label="Caption fonts"
          // Capped, so the chat's Style popover still fits a phone's screen with it open.
          className="flex max-h-[min(16rem,45vh)] flex-col overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl bg-black/20 p-1"
          id={listId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            setOpen(false)
            toggleRef.current?.focus()
          }}
          role="group"
        >
          <FontRow
            label="Style default"
            note={STYLE_DEFAULT_FONT}
            onPick={() => pick(null)}
            selected={family === null}
          />
          {CAPTION_PACK_FAMILIES.map((f) => (
            <FontRow
              key={f}
              label={f}
              onPick={() => pick({ family: f, source: 'pack' })}
              sample={drawn[f]}
              selected={family === f}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FontRow({
  label,
  note,
  onPick,
  sample,
  selected,
}: {
  label: string
  note?: string
  onPick: () => void
  sample?: string
  selected: boolean
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={cn(rowClass, selected && 'bg-fill-hover')}
      onClick={onPick}
      type="button"
    >
      <FontName className="min-w-0 flex-1 truncate text-[15px]" name={label} sample={sample} />
      {note && <span className="shrink-0 text-xs text-secondary">{note}</span>}
      {selected && <CheckMark className="size-4 shrink-0 text-primary" />}
    </button>
  )
}

/** A font's name, in that font once its sample is in (`sample`: its CSS family). */
function FontName({
  className,
  name,
  sample,
}: {
  className?: string
  name: string
  sample?: null | string
}) {
  if (!sample) return <span className={className}>{name}</span>
  return (
    <span className={className} data-font-sample style={{ fontFamily: sample, fontWeight: 400 }}>
      {name}
    </span>
  )
}
