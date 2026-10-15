'use client'

import { captionLayoutRatio } from '@reelmakeeasy/common/adapters/caption/caption-look'
import {
  CAPTION_POSITION_RANGE,
  CAPTION_SIZE_RANGE,
  captionSlotPositions,
  readableInk,
} from '@reelmakeeasy/common/adapters/caption/caption-style'
import * as SliderPrimitive from '@radix-ui/react-slider'
import type { CaptionPresetId, CaptionStyleSettings } from '@shared/types/api/caption-style'
import { cn, Input } from '@shared/ui'
import { type ReactNode, useEffect, useId, useState } from 'react'

import { chosenCaptionFamily } from './caption-fonts'
import {
  CAPTION_SWATCHES,
  captionAspectRatio,
  type CaptionKind,
  DEFAULT_CAPTION_SIZE,
  effectiveCaptionStyle,
  highlightShownAsDefault,
  parseHexColour,
} from './caption-settings'
import { CaptionFontPicker } from './CaptionFontPicker'
import { useCaptionSettings } from './useCaptionSettings'

const STYLES: { id: CaptionPresetId; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'punch', label: 'Punch' },
  { id: 'explainer', label: 'Explainer' },
]

const HEX_HINT = 'Type a colour like #04F827'

/**
 * The ring around the picked colour, clear of it. The outline style is an arbitrary property:
 * `cn` follows Tailwind 4, where a bare `outline` is a width, and drops it next to `outline-2`,
 * while this app's Tailwind 3 needs it for the style.
 */
const PICKED_RING = '[outline-style:solid] outline-2 outline-offset-2 outline-white'

/**
 * A video's caption look: style, font, highlight colour, height and size. Changes show in the
 * live previews at once and are saved to the project once they pause (`useCaptionSettings`).
 * Used under the editor's Caption switch and in the chat's Style popover.
 *
 * `captionsOn`: the Captions switch. Off, a loop keeps only its highlight, which still
 * colours the fact stamps; any other video shows nothing.
 * `note`: one plain line under the controls, e.g. when the player above plays the
 * delivered file, which only changes after a render. `loopNote`: one more, for a loop only
 * (e.g. that the preview above doesn't draw its fact stamps).
 */
export function CaptionSettingsPanel({
  aspectRatio,
  captionsOn = true,
  className,
  disabled = false,
  loopNote,
  note,
  projectId,
}: {
  /** The video's frame, as CSS ('9 / 16') or '9:16'. */
  aspectRatio: null | string | undefined
  captionsOn?: boolean
  className?: string
  disabled?: boolean
  loopNote?: string
  note?: string
  projectId: string
}) {
  const { accentSuggestion, change, kind, settings, settled } = useCaptionSettings(projectId)
  return (
    <CaptionStyleControls
      accentSuggestion={accentSuggestion}
      aspectRatio={aspectRatio}
      captionsOn={captionsOn}
      className={className}
      // Until the saved look is read, a pick could undo it.
      disabled={disabled || !settled}
      kind={kind}
      loopNote={loopNote}
      note={note}
      onChange={change}
      settings={settings}
    />
  )
}

/** The controls themselves: what `settings` give, and `onChange` with the fields changed. */
export function CaptionStyleControls({
  accentSuggestion,
  aspectRatio,
  captionsOn = true,
  className,
  disabled = false,
  kind,
  loopNote,
  note,
  onChange,
  settings,
}: {
  accentSuggestion: null | string
  aspectRatio: null | string | undefined
  captionsOn?: boolean
  className?: string
  disabled?: boolean
  kind: CaptionKind
  loopNote?: string
  note?: string
  onChange: (patch: CaptionStyleSettings) => void
  settings: CaptionStyleSettings | null
}) {
  const look = effectiveCaptionStyle(settings, kind)
  // The named heights of the frame the captions are laid out for (a loop's is 9:16).
  const slots = captionSlotPositions(captionLayoutRatio(kind, captionAspectRatio(aspectRatio)))
  const suggestion = accentSuggestion ? parseHexColour(accentSuggestion) : null
  // A suggestion that is one of the swatches marks that swatch rather than repeating it.
  const suggestionIsSwatch = CAPTION_SWATCHES.some((s) => s.colour === suggestion)
  // The saved position is the caption centre's distance from the top; the slider shows its
  // height from the bottom, so more height (to the right) is higher on the frame.
  const heightOf = (position: number) => 100 - position
  const height = heightOf(look.position ?? slots.bottom)
  // Captions off: only a loop's fact stamps still show the highlight.
  if (!captionsOn && kind !== 'loop') return null

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {captionsOn && (
        <Section label="Style">
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map(({ id, label }) => (
              <button
                aria-pressed={look.preset === id}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-xs font-medium text-primary transition-colors hover:bg-fill-hover disabled:cursor-not-allowed disabled:opacity-50',
                  look.preset === id && 'bg-fill-hover ring-2 ring-inset ring-white',
                )}
                disabled={disabled}
                key={id}
                onClick={() => onChange({ preset: id })}
                type="button"
              >
                <StylePreview accent={look.accent} preset={id} />
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* One font per video: it stays when the style changes. Fact stamps keep their own. */}
      {captionsOn && (
        <Section label="Font">
          <CaptionFontPicker
            disabled={disabled}
            family={chosenCaptionFamily(settings)}
            onPick={(font) => onChange({ font })}
          />
        </Section>
      )}

      <Section label="Highlight">
        <div className="flex flex-wrap items-center gap-2.5">
          {CAPTION_SWATCHES.map(({ colour, name }) => (
            <Swatch
              colour={colour}
              disabled={disabled}
              key={name}
              name={colour === suggestion ? `${name} (suggested)` : name}
              onPick={() => onChange({ accent: colour })}
              selected={look.accent === colour}
            />
          ))}
          {suggestion && !suggestionIsSwatch && (
            <Swatch
              colour={suggestion}
              disabled={disabled}
              name="Suggested"
              onPick={() => onChange({ accent: suggestion })}
              selected={look.accent === suggestion}
              showName
            />
          )}
        </div>
        <CustomColour
          accent={look.accent}
          disabled={disabled}
          onPick={(accent) => onChange({ accent })}
        />
        {highlightShownAsDefault(look) && (
          <p className="text-xs text-secondary">
            Punch&apos;s words are white, so a very light highlight shows in green.
          </p>
        )}
      </Section>

      {captionsOn ? (
        <>
          <PercentSlider
            disabled={disabled}
            label="Height"
            max={heightOf(CAPTION_POSITION_RANGE.min)}
            min={heightOf(CAPTION_POSITION_RANGE.max)}
            onChange={(next) => onChange({ position: heightOf(next) })}
            onReset={() => onChange({ position: null })}
            resetDisabled={look.position === null}
            sliderLabel="Caption height"
            ticks={[
              // The style's own height: picking it puts the height back to the default.
              {
                label: 'Bottom',
                onPick: () => onChange({ position: null }),
                value: heightOf(slots.bottom),
              },
              {
                label: 'Middle',
                onPick: () => onChange({ position: slots.middle }),
                value: heightOf(slots.middle),
              },
              {
                label: 'Top',
                onPick: () => onChange({ position: slots.top }),
                value: heightOf(slots.top),
              },
            ]}
            value={height}
            valueLabel={`${Math.round(height)}%`}
            valueText={`${Math.round(height)}% from the bottom`}
          />

          <PercentSlider
            disabled={disabled}
            label="Size"
            max={CAPTION_SIZE_RANGE.max}
            min={CAPTION_SIZE_RANGE.min}
            onChange={(size) => onChange({ size })}
            onReset={() => onChange({ size: null })}
            resetDisabled={look.size === DEFAULT_CAPTION_SIZE}
            sliderLabel="Caption size"
            value={look.size}
            valueLabel={`${look.size}%`}
            valueText={`${look.size}%`}
          />
        </>
      ) : (
        <p className="text-xs text-secondary">
          Captions are off. The highlight still colours the fact stamps.
        </p>
      )}

      {loopNote && kind === 'loop' && <p className="text-xs text-secondary">{loopNote}</p>}
      {note && <p className="text-xs text-secondary">{note}</p>}
    </div>
  )
}

function Section({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-secondary">{label}</span>
      {children}
    </div>
  )
}

/** A tiny sample of each style, in the chosen highlight. */
function StylePreview({ accent, preset }: { accent: string; preset: CaptionPresetId }) {
  const outline = (px: number) => ({ paintOrder: 'stroke fill', WebkitTextStroke: `${px}px #000` })
  return (
    <span
      aria-hidden
      className="flex h-12 w-full items-center justify-center overflow-hidden rounded-lg bg-black/60 px-1 text-center leading-none"
    >
      {preset === 'classic' && (
        <span className="text-[10px] font-black uppercase text-white" style={outline(2)}>
          Honey <span style={{ color: accent }}>never</span>
        </span>
      )}
      {preset === 'punch' && (
        <span
          className="text-[13px] font-black uppercase leading-[1.05] text-white"
          style={outline(3)}
        >
          Honey
          <br />
          <span style={{ color: accent }}>never</span>
        </span>
      )}
      {preset === 'explainer' && (
        <span className="inline-block rotate-[-1.2deg] bg-[#F6F2E7] px-1 py-0.5 text-[10px] font-bold text-[#111111]">
          Honey{' '}
          <span
            className="rounded-[3px] px-0.5"
            style={{ backgroundColor: accent, color: readableInk(accent) }}
          >
            never
          </span>
        </span>
      )}
    </span>
  )
}

function Swatch({
  colour,
  disabled,
  name,
  onPick,
  selected,
  showName = false,
}: {
  colour: string
  disabled: boolean
  name: string
  onPick: () => void
  selected: boolean
  showName?: boolean
}) {
  return (
    <button
      aria-label={name}
      aria-pressed={selected}
      className="flex items-center gap-1.5 text-xs text-secondary disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onPick}
      title={name}
      type="button"
    >
      <span
        className={cn(
          'size-6 shrink-0 rounded-full border border-white/20',
          selected && PICKED_RING,
        )}
        style={{ backgroundColor: colour }}
      />
      {showName && <span aria-hidden>{name}</span>}
    </button>
  )
}

/** Any colour: the browser's picker, or a typed code (checked when the field is left). */
function CustomColour({
  accent,
  disabled,
  onPick,
}: {
  accent: string
  disabled: boolean
  onPick: (accent: string) => void
}) {
  const [text, setText] = useState(accent)
  const [invalid, setInvalid] = useState(false)
  // A swatch or the picker changed the colour: show its code.
  useEffect(() => {
    setText(accent)
    setInvalid(false)
  }, [accent])

  const isCustom = !CAPTION_SWATCHES.some((s) => s.colour === accent)
  const commit = () => {
    const parsed = parseHexColour(text)
    setInvalid(!parsed)
    if (parsed && parsed !== accent) onPick(parsed)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label
          className={cn(
            'relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-white/20',
            isCustom && PICKED_RING,
            disabled && 'cursor-not-allowed opacity-50',
          )}
          style={{
            background:
              'conic-gradient(#ff3ea5, #ff8a00, #ffe500, #04f827, #00e5ff, #7b61ff, #ff3ea5)',
          }}
          title="Pick a colour"
        >
          <input
            aria-label="Pick a colour"
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            disabled={disabled}
            onChange={(event) => {
              const parsed = parseHexColour(event.target.value)
              if (parsed) onPick(parsed)
            }}
            type="color"
            value={accent.toLowerCase()}
          />
        </label>
        <Input
          aria-invalid={invalid}
          aria-label="Colour code"
          className="h-7 w-24 px-2 text-xs"
          classNames={{ input: 'text-xs sm:text-xs font-mono uppercase' }}
          disabled={disabled}
          maxLength={7}
          onBlur={commit}
          onChange={(value) => {
            setText(value)
            const parsed = parseHexColour(value)
            if (parsed) {
              setInvalid(false)
              if (parsed !== accent) onPick(parsed)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
          spellCheck={false}
          value={text}
        />
      </div>
      {invalid && (
        <p className="text-xs text-secondary" role="alert">
          {HEX_HINT}
        </p>
      )}
    </div>
  )
}

/**
 * A labelled percentage slider with its value and Reset. Moves show at once (`onChange`);
 * the caller's save waits for them to pause. `ticks` name points under the track; each
 * one is a button that jumps there.
 */
function PercentSlider({
  disabled,
  label,
  max,
  min,
  onChange,
  onReset,
  resetDisabled,
  sliderLabel,
  ticks,
  value,
  valueLabel,
  valueText,
}: {
  disabled: boolean
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  onReset: () => void
  resetDisabled: boolean
  sliderLabel: string
  ticks?: { label: string; onPick: () => void; value: number }[]
  value: number
  /** The value as shown beside the label. */
  valueLabel: string
  /** The value as a screen reader says it. */
  valueText: string
}) {
  const labelId = useId()
  // A tick's label is centred under its point, kept clear of the panel's edges.
  const at = (v: number) => `${Math.min(92, Math.max(8, ((v - min) / (max - min)) * 100))}%`
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-secondary" id={labelId}>
          {label}
        </span>
        <span className="text-xs tabular-nums text-primary">{valueLabel}</span>
        <button
          aria-label={`Reset ${label.toLowerCase()}`}
          className="text-xs text-primary underline underline-offset-2 hover:text-secondary disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
          disabled={disabled || resetDisabled}
          onClick={onReset}
          type="button"
        >
          Reset
        </button>
      </div>
      <SliderPrimitive.Root
        aria-labelledby={labelId}
        className="relative flex h-4 w-full cursor-pointer touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        disabled={disabled}
        max={max}
        min={min}
        onValueChange={([v]) => onChange(v)}
        step={1}
        value={[value]}
      >
        <SliderPrimitive.Track className="relative h-[4px] grow overflow-hidden rounded-full bg-fill-hover">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={sliderLabel}
          aria-valuetext={valueText}
          className="block size-3 rounded-full bg-fill shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </SliderPrimitive.Root>
      {ticks && (
        <div className="relative h-4">
          {ticks.map((tick) => (
            <button
              className="absolute -translate-x-1/2 text-[11px] text-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              key={tick.label}
              onClick={tick.onPick}
              style={{ left: at(tick.value) }}
              type="button"
            >
              {tick.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
