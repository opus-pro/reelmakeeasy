/**
 * Shared utilities for the anchor-asset pipeline.
 *
 * These helpers are used across Phase A (Plan), Phase B (prompt spec),
 * and Phase C (image generation). Extracting them into this module lets
 * the phase-specific files import cleanly without creating circular
 * dependencies with `anchor-generation.ts`.
 */

import type { Content } from '@reelmakeeasy/common/llm'
import sharp from 'sharp'

import type { createPlannerStorage } from '../persistence'
import type { UploadedAsset } from '../types'

/**
 * MIME types accepted by multimodal LLMs (Gemini + OpenAI) as image input.
 * SVG, application/octet-stream, and other vector / unknown formats trigger
 * a 400 INVALID_ARGUMENT from both providers, which cascades into the
 * anchor-asset-manager's text-only fallback path (slow, lossy).
 *
 * Brand crawler stages inline SVG logos under `image/svg+xml`; this set lets
 * callers filter such assets out of multimodal payloads before the LLM
 * rejects them. SVG brand assets still surface via the BRAND CONCEPT
 * REFERENCES block (rendered from `brand_bank.staged_assets` independently),
 * so the anchor planner can still pick them as `source_asset_id`.
 */
const MULTIMODAL_IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

/**
 * Returns true when `contentType` is compatible with Gemini / OpenAI multimodal
 * image input. Permissive on absent / empty values (mirrors
 * `uploadedAssetToContent`'s `|| 'image/jpeg'` fallback, so an ingestion bug
 * that loses the MIME tag still gets the asset to the model) and normalizes
 * for case + RFC-6838 parameter suffixes (e.g. `image/jpeg; charset=binary`).
 */
export function isMultimodalImageMimeType(contentType: null | string | undefined): boolean {
  if (!contentType) {
    return true
  }
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  return MULTIMODAL_IMAGE_MIME_TYPES.has(normalized)
}

/**
 * Triple-redundant SVG detection: checks MIME (split + lowercased), file_name
 * extension, and file_path extension. Any one match wins. Used by Phase C
 * passthrough + image-gen paths where an SVG whose `content_type` was lost
 * during ingestion must still be rasterized before reaching gemini-3-pro-image
 * (which 400s on `data:image/svg+xml;base64,...` payloads).
 */
export function isSvgAsset(asset: UploadedAsset): boolean {
  const contentType = asset.content_type?.toLowerCase().split(';', 1)[0]?.trim() ?? ''
  return (
    contentType === 'image/svg+xml' ||
    asset.file_name.toLowerCase().endsWith('.svg') ||
    asset.file_path.toLowerCase().endsWith('.svg')
  )
}

/**
 * Rasterize an SVG buffer to PNG via sharp at 300 DPI. Non-SVG buffers pass
 * through unchanged. Centralized so passthrough copy + image-gen source
 * conversion share one raster contract -- both ship a real raster PNG to
 * downstream consumers (keyframe gen, gemini-3-pro-image) instead of
 * the original SVG bytes with a `.png` filename.
 */
export async function rasterizeSvgSourceToPng(
  sourceBuffer: Buffer,
  sourceAsset: UploadedAsset,
): Promise<Buffer> {
  if (!isSvgAsset(sourceAsset)) {
    return sourceBuffer
  }
  return sharp(sourceBuffer, { density: 300 }).png().toBuffer()
}

/**
 * A mark at least this luminous (Rec. 601, 0-255) would vanish on a white
 * matte, so it gets a black one instead. Deliberately high so only clearly
 * light marks flip: dark, mid, and saturated-color logos keep the white
 * background that dark marks rely on.
 */
const LIGHT_MARK_LUMINANCE_THRESHOLD = 170

/**
 * Composite an image that has an alpha channel onto a solid, contrast-aware
 * background and return PNG bytes. Logos ship on transparency in one of two
 * polarities, and a multimodal LLM (and the keyframe generator that grounds on
 * the asset) renders transparency as a flat color, so the wrong matte erases
 * the mark:
 *   - dark-on-transparent (a black wordmark, or an SVG that rasterizes to a
 *     black silhouette) vanishes into black-on-black -> the describer
 *     reports "a completely black image"; flattening onto WHITE rescues it.
 *   - light-on-transparent (a white wordmark for a dark-themed brand)
 *     is the mirror image: flattening onto white makes it white-on-white -> "a
 *     blank white image", and the render has no logo to reproduce; flattening
 *     onto BLACK rescues it.
 * We pick the matte from the mean luminance of the opaque pixels so both
 * polarities stay legible.
 *
 * Returns `changed: false` (and the original bytes) when the image has no
 * alpha channel, so opaque JPEG/PNG inputs stay byte-identical and pay no
 * re-encode cost. Best-effort: any sharp failure returns the original bytes
 * rather than blocking the caller.
 */
export async function flattenAlphaToContrastingPng(
  buffer: Buffer,
): Promise<{ buffer: Buffer; changed: boolean }> {
  try {
    const metadata = await sharp(buffer).metadata()
    if (!metadata.hasAlpha) {
      return { buffer, changed: false }
    }
    const background = (await opaqueContentIsLight(buffer))
      ? { b: 0, g: 0, r: 0 }
      : { b: 255, g: 255, r: 255 }
    const flattened = await sharp(buffer).flatten({ background }).png().toBuffer()
    return { buffer: flattened, changed: true }
  } catch {
    return { buffer, changed: false }
  }
}

/**
 * Mean luminance (Rec. 601) of the sufficiently-opaque pixels, used to choose a
 * contrasting matte. Fully-transparent pixels are skipped so the mark's own
 * color -- not the empty canvas -- decides the polarity. Sampled on a
 * downscaled copy to bound cost on large uploads; a coarse mean is all the
 * light/dark decision needs. A fully transparent image has no mark to preserve
 * and reports `false`, keeping the white default.
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
    const alpha = data[i + channels - 1]
    if (alpha < 16) {
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

/**
 * Downscale an image so its longest edge is at most `maxLongEdge`, preserving
 * aspect ratio and never enlarging. Gemini tiles image input into 768x768
 * tiles (~258 tokens each), so resolution beyond what a short factual caption
 * needs only inflates tile count -> tokens -> latency & cost with no quality
 * gain. Best-effort: any sharp failure (undecodable bytes, missing dimensions)
 * returns the original buffer rather than blocking the caller. Output format
 * follows the input (sharp default), so the caller's MIME stays correct.
 */
export async function downscaleToLongEdge(
  buffer: Buffer,
  maxLongEdge: number,
): Promise<{ buffer: Buffer; changed: boolean }> {
  try {
    const { height, width } = await sharp(buffer).metadata()
    const longEdge = Math.max(width ?? 0, height ?? 0)
    if (longEdge === 0 || longEdge <= maxLongEdge) {
      return { buffer, changed: false }
    }
    const resized = await sharp(buffer)
      // Bake EXIF orientation into the pixels before we re-encode: the resize
      // drops the metadata, so without this a phone JPEG that stored its
      // rotation only in the Orientation tag would reach the vision model
      // sideways.
      .rotate()
      .resize({ fit: 'inside', height: maxLongEdge, width: maxLongEdge, withoutEnlargement: true })
      .toBuffer()
    return { buffer: resized, changed: true }
  } catch {
    return { buffer, changed: false }
  }
}

/**
 * Convert an unsafe identifier into a safe filename stem. Strips any
 * character that isn't alphanumeric, dot, underscore, or dash. Empty
 * results fall back to `anchor_asset`.
 */
export function toSafeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'anchor_asset'
}

/**
 * Read an uploaded asset from planner storage and convert it to a
 * base64 data URL ready to drop into an LLM `contents: Content[]`
 * array. Centralized here so Plan (multimodal upload), Phase B prompt
 * spec, and Phase C image gen all produce identical image content
 * blocks.
 *
 * SVG sources are rasterized to PNG inline via sharp so the Phase C image-gen
 * path (gemini-3-pro-image, gemini-2.5-flash-image) accepts the
 * payload -- both models 400 INVALID_ARGUMENT on `data:image/svg+xml;...`.
 * Phase A / Phase B don't hit this branch in practice because
 * `isMultimodalImageMimeType` filters SVG out before they reach here, but
 * the rasterization is safe to run there too (identity transform on non-SVG).
 *
 * `options.maxLongEdge` (Phase A asset-manager only) caps the
 * longest edge before base64 so the recognition-only asset-manager call
 * stops paying for full-res Gemini tiles. When it actually resizes (image
 * over the cap) `downscaleToLongEdge` preserves the input format (so the
 * computed MIME stays correct) and bakes EXIF orientation into the pixels;
 * an image already within the cap returns unchanged -- byte-for-byte the
 * same as the full-res Phase B / Phase C path, which omits this option.
 */
export async function uploadedAssetToContent(
  asset: UploadedAsset,
  storage: ReturnType<typeof createPlannerStorage>,
  options?: { maxLongEdge?: number },
): Promise<Content> {
  const rawBuffer = await storage.readFile(asset.file_path)
  const rasterBuffer = await rasterizeSvgSourceToPng(rawBuffer, asset)
  const imageBuffer = options?.maxLongEdge
    ? (await downscaleToLongEdge(rasterBuffer, options.maxLongEdge)).buffer
    : rasterBuffer
  // SVG sources become PNG after raster, so override the MIME accordingly.
  // Otherwise normalize before falling through to image/jpeg so whitespace-only
  // or parameterized content_types ("image/png ;  q=0.9") don't survive into
  // the data URL and trigger a provider 400.
  const mimeType = isSvgAsset(asset)
    ? 'image/png'
    : asset.content_type?.split(';', 1)[0]?.trim().toLowerCase() || 'image/jpeg'
  return {
    type: 'image_url',
    imageUrl: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
  }
}

/**
 * Bounded-parallel array mapper. Runs up to `concurrency` workers
 * pulling from a shared cursor so each worker starts the next pending
 * item as soon as it finishes. Guarantees result order matches input
 * order regardless of completion order.
 */
export async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return []
  }

  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<TResult>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) {
        return
      }
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: boundedConcurrency }, () => worker()))
  return results
}
