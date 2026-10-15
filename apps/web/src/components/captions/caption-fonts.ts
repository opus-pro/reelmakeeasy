import type { CaptionPackFamily } from '@shared/types/api/caption-style'

/** The style's own caption font, offered first as "Style default". */
export const STYLE_DEFAULT_FONT = 'Montserrat'

/** The built-in caption fonts (all in the render pack), in the order the Font list shows them. */
export const CAPTION_PACK_FAMILIES: readonly CaptionPackFamily[] = [
  'Anton',
  'DM Sans',
  'Dela Gothic One',
  'Roboto',
  'Alegreya',
  'PT Serif',
  'Roboto Serif',
]

export function isCaptionPackFamily(value: unknown): value is CaptionPackFamily {
  return CAPTION_PACK_FAMILIES.includes(value as CaptionPackFamily)
}

/**
 * The built-in font a video's captions use, from its settings; null for the style's own font
 * (nothing chosen, or a choice this list doesn't know).
 */
export function chosenCaptionFamily(settings: unknown): CaptionPackFamily | null {
  const font = (settings as null | undefined | { font?: unknown })?.font
  if (!font || typeof font !== 'object') return null
  const { family, source } = font as { family?: unknown; source?: unknown }
  return source === 'pack' && isCaptionPackFamily(family) ? family : null
}

/**
 * The CSS family a font's sample is added to the page under ('ly-cap-dm-sans'): a name of the
 * app's own, so a sample never stands in for the font itself anywhere else on the page.
 */
export function sampleFontFamily(family: CaptionPackFamily): string {
  return `ly-cap-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/** A sample's address as the API gives it, read against the API; null unless it is http(s). */
export function captionFontSampleUrl(sampleUrl: string, apiOrigin: string): null | string {
  if (!sampleUrl) return null
  try {
    const url = new URL(sampleUrl, apiOrigin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** Each family's sample load, once per page; a failed one is dropped so the next open retries. */
const samples = new Map<CaptionPackFamily, Promise<boolean>>()
const loaded = new Set<CaptionPackFamily>()

/** The family's sample is in the page, so its name can be drawn in it. */
export function isCaptionFontSampleLoaded(family: CaptionPackFamily): boolean {
  return loaded.has(family)
}

/**
 * Adds a font's sample to the page with the browser's FontFace API (never CSS text, so no
 * name or address can break out of it), once per page. Resolves true once it can be drawn;
 * false when it failed or the browser has no FontFace, and the name stays in the app's font.
 */
export function loadCaptionFontSample(family: CaptionPackFamily, url: string): Promise<boolean> {
  const known = samples.get(family)
  if (known) return known
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return Promise.resolve(false)
  }
  const load = (async () => {
    try {
      const face = new FontFace(sampleFontFamily(family), `url(${JSON.stringify(url)})`)
      await face.load()
      document.fonts.add(face)
      loaded.add(family)
      return true
    } catch {
      samples.delete(family)
      return false
    }
  })()
  samples.set(family, load)
  return load
}

/** Forgets every sample (tests). */
export function forgetCaptionFontSamples(): void {
  samples.clear()
  loaded.clear()
}
