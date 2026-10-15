/**
 * UIP brand-style preview helper. Re-renders a style preset's
 * reference frame in the brand style produced by `generateBrandStyling`, so
 * the brand card can show a side-by-side "original preset vs. brand colors
 * applied" picker before the user confirms.
 *
 * Image-conditioned generation: the preset reference frame is passed as an
 * `image_url` content part alongside the style directive, the same path the
 * custom-style scene-sample renderer uses (`style-analyzer.service.ts`). The
 * model preserves the reference composition and re-skins it in the brand
 * style.
 *
 * Returns the raw base64 PNG (no storage upload here -- the caller owns the
 * upload + CDN URL, keeping this lib free of storage deps and trivially
 * testable). Fail-soft: retry once, then return `null`; the caller surfaces
 * the failure and the card falls back to the preset.
 */

import { generateImage } from '@reelmakeeasy/common/llm'
import type { Content } from '@reelmakeeasy/common/llm/clients/client'
import { imageModelForRole } from '@reelmakeeasy/common/llm/image-model-selection'
import { createSubLogger } from '@reelmakeeasy/common/logger'

const logger = createSubLogger('uip-planner-runtime:generate-brand-style-preview')

// Display-only: the video renders from the brand style text, never this PNG.
// Restyling a reference frame is an edit, so it runs on the image.edit role.
const PREVIEW_IMAGE_TASK = 'user-intent-planner-brand-style-preview'

export interface GenerateBrandStylePreviewOptions {
  /** Composed brand style text (brand_style_paragraph + medium_reskin_paragraph). */
  brandStyleText: string
  /** Public URL of the preset's reference frame to restyle. */
  referenceFrameUrl: string
}

export function buildBrandStylePreviewPrompt(brandStyleText: string): string {
  return `Re-render the provided reference image in the following visual style, preserving its composition, subject, and framing while applying the style's color palette, texture, lighting, and shape language to every surface.

STYLE TO APPLY:
${brandStyleText}`
}

export async function generateBrandStylePreviewImage(
  opts: GenerateBrandStylePreviewOptions,
): Promise<null | string> {
  if (!opts.brandStyleText.trim() || !opts.referenceFrameUrl.trim()) {
    return null
  }
  const prompt = buildBrandStylePreviewPrompt(opts.brandStyleText)
  const contents: Content[] = [
    { type: 'text', text: prompt },
    { type: 'image_url', imageUrl: opts.referenceFrameUrl },
  ]
  const startedAt = Date.now()
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await generateImage({
        models: [imageModelForRole('image.edit')],
        contents,
        prompt,
        aspectRatio: '9:16',
        task: PREVIEW_IMAGE_TASK,
        // Headroom over the worst measured generation time.
        timeout: 160_000,
      })
      if (!result.imageBase64) {
        throw new Error('generateImage returned no image data')
      }
      logger.info(
        `[uip-brand-style-preview] ok durationMs=${Date.now() - startedAt} attempt=${attempt}`,
      )
      return result.imageBase64
    } catch (err) {
      logger.warn(
        `[uip-brand-style-preview] attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return null
}
