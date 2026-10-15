import type { CaptionPackFamily } from '@shared/types/api/caption-style'

/**
 * The caption fonts a video can pick besides its style's own Montserrat: families that ship in
 * the render font pack (presets `render/fonts.tar.gz`), which the export painter unpacks and the
 * editor preview loads as one archive (the fact stamps' PT Serif comes from it too). Browser-safe:
 * no file access here.
 *
 * Neither renderer fakes a bold or an italic: both draw the nearest real face of a family. So a
 * style's weight is snapped to one the family really has (`captionPackFace`) before either sees
 * it, and both draw the same face.
 */

/** The styles' own font, and the preview's fallback after a chosen family. */
export const CAPTION_DEFAULT_FONT_FAMILY = 'Montserrat'

/** Montserrat's capital height (OS/2 sCapHeight per em): a size of 100% means this in any font. */
export const MONTSERRAT_CAP_HEIGHT = 0.7

/** The render font pack archive, in the preset pack (`RENDER_PRESETS.fonts`). */
export const RENDER_FONTS_ARCHIVE = 'render/fonts.tar.gz'

/** One upright face of a pack family: its file in the pack's `fonts/` and its OS/2 weight. */
export interface CaptionPackFace {
  file: string
  weight: number
}

/** A pack family: its upright faces, lightest first, and its capital height per em. */
export interface CaptionPackFont {
  capHeight: number
  faces: readonly CaptionPackFace[]
  family: CaptionPackFamily
}

const face = (file: string, weight: number): CaptionPackFace => ({ file, weight })

/**
 * The pack families' upright faces and capital heights, read from the v006 pack's files (the
 * table test measures them again whenever the pack is installed). Italics are left out: caption
 * styles are never italic. Inter waits: it is a variable font, which the export can only draw at
 * Regular.
 */
export const CAPTION_PACK_FONTS: Readonly<Record<CaptionPackFamily, CaptionPackFont>> = {
  Alegreya: {
    capHeight: 0.637,
    faces: [
      face('Alegreya-Regular.ttf', 400),
      face('Alegreya-Medium.ttf', 500),
      face('Alegreya-SemiBold.ttf', 600),
      face('Alegreya-Bold.ttf', 700),
      face('Alegreya-ExtraBold.ttf', 800),
      face('Alegreya-Black.ttf', 900),
    ],
    family: 'Alegreya',
  },
  Anton: { capHeight: 0.8594, faces: [face('Anton-Regular.ttf', 400)], family: 'Anton' },
  'DM Sans': {
    capHeight: 0.7,
    faces: [
      face('DMSans-Regular.ttf', 400),
      face('DMSans-Medium.ttf', 500),
      face('DMSans-Bold.ttf', 700),
    ],
    family: 'DM Sans',
  },
  'Dela Gothic One': {
    capHeight: 0.726,
    faces: [face('DelaGothicOne-Regular.ttf', 400)],
    family: 'Dela Gothic One',
  },
  'PT Serif': {
    capHeight: 0.7,
    faces: [face('PTSerif-Regular.ttf', 400), face('PTSerif-Bold.ttf', 700)],
    family: 'PT Serif',
  },
  Roboto: {
    capHeight: 0.7109,
    faces: [
      face('Roboto-Light.ttf', 300),
      face('Roboto-Regular.ttf', 400),
      face('Roboto-Medium.ttf', 500),
      face('Roboto-SemiBold.ttf', 600),
      face('Roboto-Bold.ttf', 700),
      face('Roboto-Black.ttf', 900),
    ],
    family: 'Roboto',
  },
  'Roboto Serif': {
    capHeight: 0.71,
    faces: [
      face('RobotoSerif-Regular.ttf', 400),
      face('RobotoSerif-Medium.ttf', 500),
      face('RobotoSerif-SemiBold.ttf', 600),
    ],
    family: 'Roboto Serif',
  },
}

/** The pack families in the order the font picker lists them: sans, display, then serif. */
export const CAPTION_PACK_FAMILIES = [
  'Anton',
  'DM Sans',
  'Dela Gothic One',
  'Roboto',
  'Alegreya',
  'PT Serif',
  'Roboto Serif',
] as const satisfies readonly CaptionPackFamily[]

/** Whether `family` is one of the pack families, spelled exactly. */
export function isCaptionPackFamily(family: unknown): family is CaptionPackFamily {
  return (CAPTION_PACK_FAMILIES as readonly unknown[]).includes(family)
}

/** The nearest of `weights` to `target`, the heavier one on a tie (as the export painter picks). */
export function snapCaptionFontWeight(weights: readonly number[], target: number): number {
  return [...weights].sort(
    (a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a,
  )[0] as number
}

/** The face of a pack family both renderers draw for a style's weight. */
export function captionPackFace(family: CaptionPackFamily, weight: number): CaptionPackFace {
  const { faces } = CAPTION_PACK_FONTS[family]
  const snapped = snapCaptionFontWeight(
    faces.map((f) => f.weight),
    weight,
  )
  return faces.find((f) => f.weight === snapped) as CaptionPackFace
}

/** The size factor that keeps capital letters as tall as Montserrat's, within 0.8 to 1.15. */
export function captionFontSizeFactor(capHeight: null | number | undefined): number {
  if (!capHeight || capHeight <= 0) return 1
  return Math.min(1.15, Math.max(0.8, MONTSERRAT_CAP_HEIGHT / capHeight))
}

/**
 * The render font pack archive's URL under the served preset pack (`<api>/api/presets/<version>`,
 * the web app's NEXT_PUBLIC_PRESET_PACK_URL): where the editor preview loads a pack family from.
 * Every layer that loads the pack must use this same string: the engine fetches each archive name
 * once per page, and every new one costs it memory it never gives back.
 */
export function renderFontsArchiveUrl(presetPackUrl: string): string {
  return `${presetPackUrl.replace(/\/+$/, '')}/${RENDER_FONTS_ARCHIVE}`
}
