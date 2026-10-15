/**
 * The caption look a user picks per video, saved on the project (`Project.captionStyle`).
 * Every field is optional: absent or null means "never chosen", and
 * `resolveCaptionRenderPref` (libs/shared/common adapters/caption/caption-style.ts)
 * turns it into the full caption render preference both renderers read.
 */
export type CaptionPresetId = 'classic' | 'explainer' | 'punch'

/**
 * The caption fonts that ship in the render font pack (presets `render/fonts.tar.gz`), besides
 * the styles' own Montserrat. Their faces and weights are in CAPTION_PACK_FONTS
 * (libs/shared/common adapters/caption/caption-fonts.ts).
 */
export type CaptionPackFamily =
  | 'Alegreya'
  | 'Anton'
  | 'Dela Gothic One'
  | 'DM Sans'
  | 'PT Serif'
  | 'Roboto'
  | 'Roboto Serif'

/**
 * The font a video's captions are drawn in, whatever the style: a family from the render font
 * pack. A union on `source`, so uploaded fonts can join it later as another member.
 */
export type CaptionFontChoice = { family: CaptionPackFamily; source: 'pack' }

// A type alias, not an interface, like the other Json column shapes (BgmVersion): Prisma's
// InputJsonObject needs the implicit index signature only aliases get.
export type CaptionStyleSettings = {
  /** '#RRGGBB'; null means '#04F827'. */
  accent?: null | string
  /** Null means the style's own font (Montserrat). Fact stamps keep their own font. */
  font?: CaptionFontChoice | null
  /** Caption centre, % of frame height from the top, 10-90; null means the preset's slot default. */
  position?: null | number
  /** Null means the video kind's default (loop: punch, video: classic). */
  preset?: CaptionPresetId | null
  /** % of the preset's base font size, 60-160; null means 100. */
  size?: null | number
}

/** One render pack font the caption font picker offers (`GET /api/caption-fonts`). */
export type CaptionPackFontInfo = {
  family: CaptionPackFamily
  /** One face of the family as a `.ttf` URL, to draw its name in the picker (browser FontFace). */
  sampleUrl: string
  /** The upright weights the pack has for the family, lightest first. */
  weights: number[]
}

/** `GET /api/caption-fonts`. */
export type CaptionFontsResponse = { data: { pack: CaptionPackFontInfo[] } }
