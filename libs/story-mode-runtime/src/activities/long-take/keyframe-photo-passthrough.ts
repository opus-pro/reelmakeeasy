/**
 * Article-photo passthrough for keyframes: when a realistic-style
 * news shot depicts the story's real photograph, composite the raw photo onto
 * the frame instead of regenerating it through the image model. The model --
 * even handed the photo as a reference -- redraws faces, text, and detail;
 * compositing the raw asset is the only way to guarantee the photo is not
 * modified at all. Mirrors the brand-logo passthrough.
 *
 * Detection is deliberately strict and scoped to ARTICLE images only (staged
 * under `article-extract/` by the news-article-to-video door): every asset
 * bound to the shot must be a passthrough article photo. Brand assets and
 * mixed bindings fall back to normal generation, unchanged.
 */

import * as fs from 'node:fs'

import { downloadStoredFile } from '@reelmakeeasy/common/storage/stored-files'
import sharp from 'sharp'

import type { LongTakeAnchorMeta } from './anchor-meta'
import { isLogoPassthroughAnchor, resolveLogoCanvasDimensions } from './keyframe-logo-passthrough'

// Anchor-id prefix the planner is instructed to use for article photo anchors
// (prop_article_hero is mandated; additional photos must use prop_article_*).
// Mirrors the LOGO_ANCHOR_ID_PREFIX convention. This is the PRIMARY
// signal: the anchor pipeline copies passthrough images verbatim into the
// project's anchor_assets/final/ directory, so the lookup uri does NOT retain
// the article-extract staging path.
const ARTICLE_ANCHOR_ID_PREFIX = 'prop_article_'
// Fallback marker: the storage staging path produced by extractArticleActivity,
// for lookups that still reference the staged source directly.
const ARTICLE_STAGING_PATH_MARKER = '/article-extract/'

/**
 * A real article photograph we can pass through verbatim: a passthrough Prop
 * whose anchor id follows the planner's prop_article_* convention (or whose
 * uri still points at the article-extract staging path). Logo anchors keep
 * their own passthrough path (white-canvas contain composite).
 */
export function isArticlePhotoPassthroughAnchor(
  assetId: string,
  meta: LongTakeAnchorMeta | string | undefined,
): meta is LongTakeAnchorMeta {
  if (!meta || typeof meta === 'string') {
    return false
  }
  if (meta.type !== 'Prop' || meta.sourcePassthrough !== true) {
    return false
  }
  if (
    !assetId.startsWith(ARTICLE_ANCHOR_ID_PREFIX) &&
    !meta.uri.includes(ARTICLE_STAGING_PATH_MARKER)
  ) {
    return false
  }
  // Checked LAST: isLogoPassthroughAnchor is a type predicate, so its false
  // branch would narrow `meta` to never for any code after it.
  return !isLogoPassthroughAnchor(assetId, meta)
}

/**
 * Raw article-photo URI to pass through when a shot binds ONLY passthrough
 * article photo(s); null otherwise (mixed / empty / non-article bindings ->
 * normal generation, where the photo still rides as a reference image).
 */
export function resolveArticlePhotoPassthroughUri(
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
    if (!isArticlePhotoPassthroughAnchor(assetId, meta)) {
      return null
    }
    if (!firstUri && meta.uri) {
      firstUri = meta.uri
    }
  }
  return firstUri
}

/**
 * Download the raw photo and render it onto a canvas of the shot aspect
 * ratio, written to `outputPath`: a blurred, dimmed cover-fill of the photo
 * as background with the untouched photo contained and centered on top (the
 * standard news/documentary treatment for mismatched aspect ratios). The
 * photo itself is only scaled -- never recolored, cropped, or restyled.
 */
export async function compositePhotoKeyframe(params: {
  aspectRatio: string | undefined
  outputPath: string
  photoUri: string
}): Promise<void> {
  const { aspectRatio, outputPath, photoUri } = params
  const sourcePath = `${outputPath}.photo-src`
  try {
    await downloadStoredFile(photoUri, sourcePath)
    const { height, width } = resolveLogoCanvasDimensions(aspectRatio)
    const background = await sharp(sourcePath)
      .resize(width, height, { fit: 'cover' })
      .blur(24)
      .modulate({ brightness: 0.6 })
      .toBuffer()
    const photo = await sharp(sourcePath).resize(width, height, { fit: 'inside' }).png().toBuffer()
    await sharp(background)
      .composite([{ gravity: 'center', input: photo }])
      .png()
      .toFile(outputPath)
  } finally {
    await fs.promises.rm(sourcePath, { force: true })
  }
}
