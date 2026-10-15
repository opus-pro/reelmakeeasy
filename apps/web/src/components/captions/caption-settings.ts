import {
  type CaptionKind,
  captionLookChanged,
  effectiveCaptionStyle,
  type RenderedCaptionStyle,
} from '@reelmakeeasy/common/adapters/caption/caption-look'
import {
  DEFAULT_CAPTION_ACCENT,
  resolveCaptionRenderPref,
} from '@reelmakeeasy/common/adapters/caption/caption-style'
import type { CaptionPresetId, CaptionStyleSettings } from '@shared/types/api/caption-style'

/** Which default caption look a video gets when nobody chose one (the status's `captionKind`). */
export type { CaptionKind }

/**
 * The look a video's settings give, with what was never chosen filled in for its kind: the same
 * record a render writes for the file it delivers (adapters/caption/caption-look.ts).
 */
export { effectiveCaptionStyle }

/** The highlight colours offered as swatches; green is the default. */
export const CAPTION_SWATCHES = [
  { colour: DEFAULT_CAPTION_ACCENT, name: 'Green' },
  { colour: '#FFE500', name: 'Yellow' },
  { colour: '#00E5FF', name: 'Cyan' },
  { colour: '#FF3EA5', name: 'Pink' },
  { colour: '#FF8A00', name: 'Orange' },
] as const

/** The size at 100%: the style's own base size. */
export const DEFAULT_CAPTION_SIZE = 100

/** A caption look with every field filled in, as both renderers draw it. */
export type EffectiveCaptionStyle = RenderedCaptionStyle

/** Loops start in Punch; every other video in Classic. */
export function defaultCaptionPreset(kind: CaptionKind): CaptionPresetId {
  return effectiveCaptionStyle(null, kind).preset
}

/** A ratio as the caption resolver reads it ('9:16'), from the app's CSS form ('9 / 16'). */
export function captionAspectRatio(ratio: null | string | undefined): string {
  return ratio ? ratio.replace(/\s/g, '').replace('/', ':') : '9:16'
}

/** A typed colour as '#RRGGBB' (the '#' may be left out); null when it isn't one. */
export function parseHexColour(input: string): null | string {
  const hex = input.trim().replace(/^#/, '')
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null
}

/**
 * The look draws its highlight in the default green instead of the chosen one: Punch's
 * words are white, so the resolver swaps a near-white highlight out.
 */
export function highlightShownAsDefault(look: EffectiveCaptionStyle): boolean {
  if (look.preset !== 'punch') return false
  const pref = resolveCaptionRenderPref(
    { accent: look.accent, preset: look.preset },
    { aspectRatio: '9:16', kind: 'video' },
  )
  return pref.highlightColor.primary.toUpperCase() !== look.accent
}

/**
 * Whether a file rendered with the `rendered` look draws differently from `latest`, so
 * Download must render it again: the server's rule (`captionLookChanged`), for the video's
 * frame as CSS. Both looks are resolved as the renderers draw them, so an unset field and its
 * default, or two near-white Punch highlights, count as the same. With captions off
 * (`captionsOn`, the switch's latest value) only a loop's highlight shows, on its fact stamps;
 * a plain video shows nothing. A file rendered before saved looks (`rendered` null) has the old
 * default caption: Classic, laid out for a tall frame, loops included.
 */
export function captionStyleNeedsRender(
  rendered: CaptionStyleSettings | null | undefined,
  latest: CaptionStyleSettings | null | undefined,
  {
    aspectRatio,
    captionsOn,
    kind,
  }: { aspectRatio: null | string | undefined; captionsOn: boolean; kind: CaptionKind },
): boolean {
  return captionLookChanged({
    aspectRatio: captionAspectRatio(aspectRatio),
    enableCaption: captionsOn,
    kind,
    rendered,
    wanted: latest,
  })
}
