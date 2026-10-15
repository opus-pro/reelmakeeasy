/**
 * Logo passthrough for keyframes: when a shot depicts ONLY the real
 * brand logo, composite the user's raw logo image onto the frame instead of
 * regenerating it through the image model. The model -- even handed the logo as
 * a reference and told to match it -- redraws and recolors it. Compositing the
 * raw asset is the only way to guarantee the logo is not modified at all.
 *
 * Detection is deliberately strict: every asset bound to the shot must be a
 * real, user-sourced, passthrough logo anchor. Any other asset (a product, a
 * scene prop, a person) falls back to normal generation, where the brand-logo
 * prompt guard still applies.
 */

import * as fs from 'node:fs'

import { downloadStoredFile } from '@reelmakeeasy/common/storage/stored-files'
import sharp from 'sharp'

import type { LongTakeAnchorMeta } from './anchor-meta'

const LOGO_ANCHOR_ID_PREFIX = 'prop_logo'
const LOGO_KEYWORD_REGEX = /\blogos?\b/i
const LOGO_CANVAS_LONG_EDGE = 1536
const TRANSPARENT = { alpha: 0, b: 0, g: 0, r: 0 } as const
const BLACK = { b: 0, g: 0, r: 0 } as const
const WHITE = { b: 255, g: 255, r: 255 } as const
// A mark at least this luminous (Rec. 601, 0-255) vanishes on a white matte, so
// it gets a black one. Kept in sync with uip-planner-runtime's
// flattenAlphaToContrastingPng; inlined here (sharp-only) so this activity does
// not pull the uip-planner-runtime barrel into its module graph.
const LIGHT_MARK_LUMINANCE_THRESHOLD = 170

/**
 * A real brand logo we can pass through verbatim: a user-file-sourced
 * passthrough Prop whose id/keyword marks it a logo (mirrors the manifest
 * `prop_logo_*` / "Company Logo" convention). Other passthrough props (a
 * scraped product photo, a building) are excluded.
 */
export function isLogoPassthroughAnchor(
  assetId: string,
  meta: LongTakeAnchorMeta | string | undefined,
): meta is LongTakeAnchorMeta {
  if (!meta || typeof meta === 'string') {
    return false
  }
  if (meta.type !== 'Prop' || meta.sourcePassthrough !== true || meta.source !== 'USER_FILE') {
    return false
  }
  return assetId.startsWith(LOGO_ANCHOR_ID_PREFIX) || LOGO_KEYWORD_REGEX.test(meta.keyword)
}

/**
 * Raw logo URI to passthrough when a shot binds ONLY real logo anchor(s);
 * null otherwise (mixed/empty/non-logo bindings -> normal generation).
 */
export function resolveLogoPassthroughUri(
  usedAssetIds: string[] | undefined,
  anchorLookup: ReadonlyMap<string, LongTakeAnchorMeta>,
): null | string {
  const deduped = [...new Set((usedAssetIds || []).map((id) => id?.trim()).filter(Boolean))]
  if (deduped.length === 0) {
    return null
  }
  let firstUri: null | string = null
  for (const assetId of deduped) {
    const meta = anchorLookup.get(assetId)
    if (!isLogoPassthroughAnchor(assetId, meta)) {
      return null
    }
    if (!firstUri && meta.uri) {
      firstUri = meta.uri
    }
  }
  return firstUri
}

/** Canvas dimensions for the shot aspect ratio, long edge fixed. */
export function resolveLogoCanvasDimensions(aspectRatio: string | undefined): {
  height: number
  width: number
} {
  const [w, h] = String(aspectRatio ?? '2:3')
    .split(':')
    .map(Number)
  if (!w || !h || w <= 0 || h <= 0) {
    return { height: LOGO_CANVAS_LONG_EDGE, width: Math.round((LOGO_CANVAS_LONG_EDGE * 2) / 3) }
  }
  return w >= h
    ? { height: Math.round((LOGO_CANVAS_LONG_EDGE * h) / w), width: LOGO_CANVAS_LONG_EDGE }
    : { height: LOGO_CANVAS_LONG_EDGE, width: Math.round((LOGO_CANVAS_LONG_EDGE * w) / h) }
}

/**
 * Download the raw logo and fit it (contain, centered) onto a solid,
 * contrast-aware canvas of the shot aspect ratio, written to `outputPath`. The
 * logo is padded onto a transparent canvas, then flattened onto the matte that
 * keeps it legible -- white behind a dark mark, black behind a light one.
 * Without this a white-on-transparent logo flattened onto white
 * lands as a blank frame. The logo is only scaled and padded -- never recolored
 * or restyled.
 */
export async function compositeLogoKeyframe(params: {
  aspectRatio: string | undefined
  logoUri: string
  outputPath: string
}): Promise<void> {
  const { aspectRatio, logoUri, outputPath } = params
  const sourcePath = `${outputPath}.logo-src`
  try {
    await downloadStoredFile(logoUri, sourcePath)
    const { height, width } = resolveLogoCanvasDimensions(aspectRatio)
    // Pad onto a transparent canvas so the logo's own pixels (not the padding)
    // decide the matte, then flatten onto the contrasting color and drop alpha.
    const padded = await sharp(sourcePath)
      .resize(width, height, { background: TRANSPARENT, fit: 'contain' })
      .ensureAlpha()
      .png()
      .toBuffer()
    const background = (await opaqueContentIsLight(padded)) ? BLACK : WHITE
    await sharp(padded).flatten({ background }).png().toFile(outputPath)
  } finally {
    await fs.promises.rm(sourcePath, { force: true })
  }
}

/**
 * Mean luminance (Rec. 601) of the sufficiently-opaque pixels; true when the
 * mark is light enough to need a dark matte. Transparent padding is skipped so
 * only the logo's own color decides. Sampled on a downscaled copy to bound cost.
 */
async function opaqueContentIsLight(buffer: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buffer)
    .resize({ fit: 'inside', height: 256, width: 256, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = info.channels
  let luminanceSum = 0
  let opaqueCount = 0
  for (let i = 0; i + channels <= data.length; i += channels) {
    if (data[i + channels - 1] < 16) {
      continue
    }
    luminanceSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    opaqueCount += 1
  }
  if (opaqueCount === 0) {
    return false
  }
  return luminanceSum / opaqueCount >= LIGHT_MARK_LUMINANCE_THRESHOLD
}
