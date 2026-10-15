/**
 * Upstream SVG -> PNG raster for the brand-extraction crawler.
 *
 * Brand sites serve logos as SVG. SVG bytes 400 INVALID_ARGUMENT on every
 * multimodal LLM call (Gemini, OpenAI), which forces describe-staged-assets,
 * Phase A multimodal Plan, and Phase B prompt-spec into a text-only fallback.
 * The downstream effect is that prompts describe the logo generically ("a
 * brand mark") and Phase C image gen hallucinates a non-real mark in its
 * place.
 *
 * Rasterizing upstream -- at the moment the crawler writes the asset to storage --
 * means every subsequent phase sees PNG bytes and can do faithful multimodal
 * reasoning over the actual logo. Phase C's inline raster in
 * `uploadedAssetToContent` remains as a safety net for any SVG that slips
 * past this upstream step.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import sharp from 'sharp'

const logger = createSubLogger('brand-extraction:crawl')

/**
 * Rasterize an SVG buffer (or markup string) to PNG via sharp at 300 DPI.
 * Returns null on failure so callers can drop the asset rather than stage
 * corrupt bytes. Centralized so both inline-SVG (markup string) and
 * downloaded-SVG (buffer) staging paths share one raster contract.
 */
export async function rasterizeSvgMarkupToPng(
  svgInput: Buffer | string,
  context: string,
): Promise<Buffer | null> {
  const buffer = typeof svgInput === 'string' ? Buffer.from(svgInput, 'utf8') : svgInput
  try {
    return await sharp(buffer, { density: 300 }).png().toBuffer()
  } catch (err) {
    logger.warn(
      `[brand-extraction] svg raster failed context=${context} err=${ensureError(err).message}`,
    )
    return null
  }
}
