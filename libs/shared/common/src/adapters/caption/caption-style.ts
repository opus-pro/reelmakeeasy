import type {
  CaptionFontChoice,
  CaptionPresetId,
  CaptionStyleSettings,
} from '@shared/types/api/caption-style'
import { z } from 'zod'

import {
  bottomPercentForCaption,
  bottomPercentForCaptionInLandscape,
  topPercentForCaption,
} from './canvas-render-config'
import {
  CAPTION_DEFAULT_FONT_FAMILY,
  CAPTION_PACK_FAMILIES,
  CAPTION_PACK_FONTS,
  captionFontSizeFactor,
  captionPackFace,
} from './caption-fonts'
import type { CaptionRenderReference } from './caption-render-preference.zod'
import { getDefaultCaptionRenderPref } from './default-caption-render-pref'
import type { CaptionAnimationName } from './render.zod'

/**
 * Caption presets and the per-video caption settings (`Project.captionStyle`).
 *
 * A user picks at most five things per video: the preset, the highlight (accent) colour,
 * the height, the size and the font. `resolveCaptionRenderPref` turns those, plus the video's
 * frame and kind, into the full caption render preference that `TextAdapter` hands to
 * both renderers (the editor engine and the export painter), so they draw the same look.
 */

/** The highlight colour when none was chosen: the app's caption green, for every preset. */
export const DEFAULT_CAPTION_ACCENT = '#04F827'

/** The caption centre's allowed height, % of the frame height from the top. */
export const CAPTION_POSITION_RANGE = { max: 90, min: 10 } as const

/** The allowed size, % of the preset's base font size. */
export const CAPTION_SIZE_RANGE = { max: 160, min: 60 } as const

/** Explainer's paper strip, drawn under the caption as its own backing layer. */
export interface CaptionStrip {
  color: string
  /** The strip's text colour. */
  ink: string
  /** Tilt in degrees, clockwise; alternate captions turn the other way. */
  tiltDeg: number
}

/**
 * The caption render preference with the preset-only extras the adapter reads.
 * Classic carries neither extra, so its tracks are built exactly as before.
 */
export interface CaptionRenderPref extends CaptionRenderReference {
  /**
   * 'short': re-chunk the words into 1-3 word captions, each held until the next one,
   * with the accent word lit for the whole caption (Punch, Explainer).
   */
  chunking?: 'short'
  /**
   * The chosen font's face (absent with the style's own font): its file in the render font pack.
   * Data only, never an address: the editor preview loads the pack archive for it
   * (TextAdapter.genCaptionTextTracks' `fontGzipPath`), the export draws the unpacked file.
   */
  fontFace?: CaptionPrefFontFace
  strip?: CaptionStrip
}

/** A chosen caption font's face, as the pref carries it. Uploads can join it later. */
export type CaptionPrefFontFace = { file: string; source: 'pack' }

/** One row of the preset table. */
export interface CaptionPreset {
  /** `font.numericalSize` at 100% (engine design units). */
  baseSize: number
  id: CaptionPresetId
  /** A fresh copy of the preset's pref at its defaults: bottom slot, default highlight. */
  pref: () => CaptionRenderPref
}

// The engine's highlight-colour preset (the active word recoloured, no enlargement).
const HIGHLIGHT_COLOR_ANIMATION: CaptionAnimationName = 'word-level_highlight_color'

const PAPER = '#F6F2E7'
const DARK_INK = '#111111'
const LIGHT_INK = '#FFFFFF'

export const CAPTION_PRESETS: Readonly<Record<CaptionPresetId, CaptionPreset>> = {
  // Today's look, unchanged: green karaoke fill-pop, one line at a time.
  classic: { baseSize: 35, id: 'classic', pref: getDefaultCaptionRenderPref },
  // Dark sentence-case Montserrat Bold on a tilted paper strip, the accent word boxed.
  explainer: {
    baseSize: 40,
    id: 'explainer',
    pref: () => ({
      captionAnimation: {
        bgColor: DEFAULT_CAPTION_ACCENT.toLowerCase(),
        highlightColor: DARK_INK,
        name: 'word-level_simple_bg-highlight',
      },
      captionPosition: 'bottom',
      chunking: 'short',
      enableCaption: true,
      enableCaptionAnimation: true,
      enableHighlight: true,
      enableUppercase: false,
      font: {
        color: DARK_INK,
        family: 'Montserrat',
        numericalSize: 40,
        shadow: { blur: 0, color: '#000000', enabled: false, x: 0, y: 0 },
        size: 'Large',
        stroke: { color: '#000000', enabled: false, width: 0 },
        style: ['700'],
        textDecoration: '',
      },
      highlightColor: { primary: DARK_INK, secondary: DARK_INK },
      layoutAspectRatio: 'portrait',
      lineCount: 3,
      strip: { color: PAPER, ink: DARK_INK, tiltDeg: 1.2 },
    }),
  },
  // Big white uppercase with a heavy black outline, the accent word in the highlight.
  punch: {
    baseSize: 45,
    id: 'punch',
    pref: () => ({
      captionAnimation: {
        highlightColor: DEFAULT_CAPTION_ACCENT.toLowerCase(),
        name: HIGHLIGHT_COLOR_ANIMATION,
      },
      captionPosition: 'bottom',
      chunking: 'short',
      enableCaption: true,
      enableCaptionAnimation: true,
      enableHighlight: true,
      enableUppercase: true,
      font: {
        color: '#ffffff',
        family: 'Montserrat',
        numericalSize: 45,
        shadow: { blur: 2, color: '#000000', enabled: true, x: 2, y: 2 },
        size: 'Large',
        stroke: { color: '#000000', enabled: true, width: 15 },
        style: ['900'],
        textDecoration: '',
      },
      highlightColor: { primary: DEFAULT_CAPTION_ACCENT.toLowerCase(), secondary: '#FFFD03' },
      layoutAspectRatio: 'portrait',
      lineCount: 3,
    }),
  },
}

const PRESET_IDS = ['classic', 'explainer', 'punch'] as const satisfies readonly CaptionPresetId[]

const clamp = (value: number, range: { max: number; min: number }) =>
  Math.min(range.max, Math.max(range.min, value))

const FONT_FAMILIES = [CAPTION_DEFAULT_FONT_FAMILY, ...CAPTION_PACK_FAMILIES] as const
const FONT_MESSAGE = `Caption font must be one of ${FONT_FAMILIES.slice(0, -1).join(', ')} or ${FONT_FAMILIES.at(-1)}`
const fontError = () => ({ message: FONT_MESSAGE })

// One schema per field, shared by the strict endpoint check and the lenient read.
const FIELD_SCHEMAS = {
  // A pack family; the styles' own Montserrat is saved as null, so one look has one value.
  font: z
    .object(
      {
        family: z.enum(FONT_FAMILIES, { errorMap: fontError }),
        source: z.literal('pack', { errorMap: fontError }),
      },
      { errorMap: fontError },
    )
    .transform(({ family }): CaptionFontChoice | null =>
      family === CAPTION_DEFAULT_FONT_FAMILY ? null : { family, source: 'pack' },
    )
    .nullable()
    .optional(),
  accent: z
    .string({ invalid_type_error: 'Caption highlight must be a colour like #04F827' })
    .trim()
    .regex(/^#[\da-f]{6}$/i, 'Caption highlight must be a colour like #04F827')
    .transform((hex) => hex.toUpperCase())
    .nullable()
    .optional(),
  position: z
    .number({ invalid_type_error: 'Caption height must be a number from 10 to 90' })
    .finite('Caption height must be a number from 10 to 90')
    .transform((p) => Math.round(clamp(p, CAPTION_POSITION_RANGE) * 10) / 10)
    .nullable()
    .optional(),
  preset: z
    .enum(PRESET_IDS, {
      errorMap: () => ({ message: 'Caption style must be classic, punch or explainer' }),
    })
    .nullable()
    .optional(),
  size: z
    .number({ invalid_type_error: 'Caption size must be a number from 60 to 160' })
    .finite('Caption size must be a number from 60 to 160')
    .transform((s) => Math.round(clamp(s, CAPTION_SIZE_RANGE)))
    .nullable()
    .optional(),
}

const CaptionStyleSettingsSchema = z.object(FIELD_SCHEMAS).strict()

/** A caption settings body the endpoint can't accept; the message is for the user. */
export class CaptionStyleSettingsError extends Error {
  override name = 'CaptionStyleSettingsError'
}

/**
 * Validate caption settings sent by a client. Keeps only the fields sent (null resets
 * one to its default), clamps the height to 10-90 and the size to 60-160, and writes
 * the highlight as upper-case `#RRGGBB`. Throws CaptionStyleSettingsError otherwise.
 */
export function normalizeCaptionStyleSettings(input: unknown): CaptionStyleSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CaptionStyleSettingsError('Caption settings must be an object')
  }
  const parsed = CaptionStyleSettingsSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CaptionStyleSettingsError(
      issue?.code === 'unrecognized_keys'
        ? `Unknown caption setting: ${issue.keys.join(', ')}`
        : (issue?.message ?? 'Caption settings are not valid'),
    )
  }
  return dropUndefined(parsed.data)
}

/**
 * Read saved caption settings (the project's JSON column) field by field. Anything
 * malformed reads as unset, so a bad row falls back to the defaults instead of failing;
 * a font that isn't one this app has reads as the style's own (null).
 */
export function readCaptionStyleSettings(value: unknown): CaptionStyleSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const raw = value as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(FIELD_SCHEMAS)) {
    if (raw[key] === undefined) continue
    const parsed = schema.safeParse(raw[key])
    if (parsed.success) settings[key] = parsed.data
    else if (key === 'font') settings[key] = null
  }
  return settings as CaptionStyleSettings
}

/**
 * The caption render preference for a video: its preset (or the kind's default: Punch
 * for loops, Classic otherwise), highlight, height and size, laid out for its frame.
 * Null settings on a 9:16 video give exactly `getDefaultCaptionRenderPref()`.
 */
export function resolveCaptionRenderPref(
  settings: CaptionStyleSettings | null | undefined,
  opts: { aspectRatio: string; kind: 'loop' | 'video' },
): CaptionRenderPref {
  const chosen = readCaptionStyleSettings(settings) ?? {}
  const presetId = chosen.preset ?? (opts.kind === 'loop' ? 'punch' : 'classic')
  const preset = CAPTION_PRESETS[presetId]
  const pref = preset.pref()

  pref.layoutAspectRatio = layoutAspectRatioOf(opts.aspectRatio)
  applyAccent(pref, presetId, chosen.accent ?? DEFAULT_CAPTION_ACCENT)
  const font = chosen.font ? CAPTION_PACK_FONTS[chosen.font.family] : undefined
  if (chosen.size != null || font) {
    // A chosen font's capitals are made as tall as Montserrat's, the outline with them.
    const k = ((chosen.size ?? 100) / 100) * (font ? captionFontSizeFactor(font.capHeight) : 1)
    pref.font.numericalSize = Math.round(preset.baseSize * k)
    pref.font.stroke.width = Math.round(pref.font.stroke.width * k)
  }
  if (font) {
    // The style's weight snapped to one the family has, never italic: neither renderer fakes one.
    const weight = Number(pref.font.style.find((s) => s !== 'italic'))
    const face = captionPackFace(font.family, weight)
    pref.font.family = font.family
    pref.font.style = [String(face.weight)]
    pref.fontFace = { file: face.file, source: 'pack' }
  }
  if (chosen.position != null) {
    pref.captionPosition = 'custom'
    pref.captionCustomStyle = {
      // The engine's centre-based ratio (-1 bottom .. 1 top), passed raw by TextAdapter.
      rect: {
        hPct: 1,
        type: 'CPct',
        wPct: 1,
        xPct: 0,
        yPct: round4(1 - (2 * chosen.position) / 100),
      },
    }
  }
  return pref
}

/** The named caption heights on a frame (caption centre, % from the top), for slider ticks. */
export function captionSlotPositions(aspectRatio: string): {
  bottom: number
  middle: number
  top: number
} {
  const bottomFromBottom =
    layoutAspectRatioOf(aspectRatio) === 'landscape'
      ? bottomPercentForCaptionInLandscape
      : bottomPercentForCaption
  return {
    bottom: Math.round((100 - bottomFromBottom) * 10) / 10,
    middle: 50,
    top: Math.round((100 - topPercentForCaption) * 10) / 10,
  }
}

/** Near-black or white, whichever has the higher contrast ratio (WCAG) on `fill`. */
export function readableInk(fill: string): string {
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const background = luminance(fill)
  return contrast(background, luminance(DARK_INK)) >= contrast(background, luminance(LIGHT_INK))
    ? DARK_INK
    : LIGHT_INK
}

/** Put the highlight where the preset shows it. */
function applyAccent(pref: CaptionRenderPref, presetId: CaptionPresetId, accent: string): void {
  const animation = pref.captionAnimation
  if (presetId === 'explainer') {
    // The box behind the accent word takes the highlight; its text takes readable ink.
    const ink = readableInk(accent).toLowerCase()
    if (animation) {
      animation.bgColor = accent.toLowerCase()
      animation.highlightColor = ink
    }
    pref.highlightColor.primary = ink
    return
  }
  // Punch's words are white: a near-white highlight would vanish, so it gets the default.
  const colour = (
    presetId === 'punch' && isNearWhite(accent) ? DEFAULT_CAPTION_ACCENT : accent
  ).toLowerCase()
  if (animation) animation.highlightColor = colour
  pref.highlightColor.primary = colour
}

const dropUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T

/** Light grey to white: every channel bright. Pale tints of a colour count too. */
function isNearWhite(hex: string): boolean {
  return [1, 3, 5].every((i) => Number.parseInt(hex.slice(i, i + 2), 16) >= 200)
}

function layoutAspectRatioOf(aspectRatio: string): CaptionRenderReference['layoutAspectRatio'] {
  if (aspectRatio === '16:9') return 'landscape'
  if (aspectRatio === '1:1') return 'square'
  if (aspectRatio === '4:5') return 'four_five'
  return 'portrait'
}

/** Relative luminance (0-1) of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
