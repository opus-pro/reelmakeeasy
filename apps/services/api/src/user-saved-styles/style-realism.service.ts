import { completion } from '@reelmakeeasy/common/llm/completion'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

/**
 * Single-valued, mutually exclusive realism classes. Ordered most
 * to least real. The reported metric is R3 + R2, which reproduces the adopted
 * preset list exactly.
 */
export const REALISM_CLASSES = ['R3', 'R2', 'R1', 'R0'] as const
export type RealismClass = (typeof REALISM_CLASSES)[number]

const RealismSchema = z.object({
  // Brief justification first: naming the evidence before committing to a
  // class measurably steadies the R2/R1 boundary, which is where the rubric
  // is hardest. Logged for auditing, never persisted.
  reason: z.string(),
  realismClass: z.enum(REALISM_CLASSES),
})

// The question is never "was this really filmed" -- everything the app outputs is
// generated. It is what the frame READS AS to someone scrolling past.
const REALISM_SYSTEM = `You classify the visual realism of a reusable video STYLE.

Judge how a typical frame produced in this style would READ to a viewer scrolling past. Everything here is AI-generated, so "was it really filmed" is never the question. Judge the frame AS A WHOLE, and judge the style's TYPICAL output rather than its best or worst case.

Assign exactly one class:

R3 (Real) -- reads as an unmodified recording of the real world: real people, objects and places as they actually look, seen through a camera.

R2 (Real-derived) -- photographic material, but in a frame that announces itself as built: cutouts, collage, overlays, halftone, impossible scale, synthetic props. Also a photoreal render of something that could never be filmed, such as a user interface, a neuron, or a cross-section.

R1 (Depicted world) -- a fabricated but representational world: animation, illustration, claymation, miniature, pixel or voxel art, painting. It shows a place and people, just not ours.

R0 (Graphic) -- no photographic material at all: line art, flat vector diagrams, stick figures, type-led layouts, charts.

Two rules settle most hard cases:

1. RENDER QUALITY NEVER PROMOTES. Claymation, handcrafted miniatures and high-end CGI can look convincingly physical, and a real claymation set is literally filmed with a camera -- but a viewer reads clay as clay and CGI as CGI. These are R1, however photoreal the render. A style calling itself "hyper-realistic" while describing a painting, illustration or fantasy render is R1.
2. A REALISTIC PERSON INSIDE A CONSTRUCTED FRAME DOES NOT PROMOTE THE FRAME. Photoreal humans with drawn marks on top are R2, not R3, because the viewer sees an edited picture rather than a recording.

Further tie-breakers, in order: the whole frame beats any single element; between R2 and R1, whichever material covers most of the frame wins; "is there a place and a body?" separates R1 from R0; if still tied, round DOWN to the more stylized class.

If a reference image is supplied it is the strongest evidence -- the text may describe intent, but the image shows what the style actually produces. When they conflict, trust the image.

Return the class as realismClass and one short sentence as reason.`

/**
 * Per-provider-call ceiling. `models` is a fallback chain, so a hung primary
 * would otherwise cost this again on the fallback.
 */
const CLASSIFY_TIMEOUT_MS = 8_000

/**
 * Ceiling on the whole chain, retries included. `create` awaits this inside a
 * Promise.all on a user-facing save, so a degraded provider must not be able
 * to hold the request open past this.
 */
const CLASSIFY_DEADLINE_MS = 20_000

export interface ClassifyRealismInput {
  /** The style's display text. May be empty for image-only styles. */
  styleText?: string
  /** CDN thumbnail of the style, when the style has one. */
  thumbnailUrl?: string
}

/**
 * Labels a saved style with a realism class at save time.
 *
 * Runs where the reference image still exists, which is the whole point: a
 * text-only rule is blind to custom styles built from an image with no typed
 * text, and silently buckets every one of them as non-realistic.
 *
 * Fail-open: any error returns null and the style saves unlabeled. A missing
 * label costs one row of analytics; a blocked save is immediate and
 * user-facing. Callers persist the value only when it is non-null.
 */
@Injectable()
export class StyleRealismService {
  private readonly logger = new Logger(StyleRealismService.name)

  async classify({ styleText, thumbnailUrl }: ClassifyRealismInput): Promise<null | RealismClass> {
    const trimmed = styleText?.trim()
    const image = thumbnailUrl?.trim()
    // Nothing to look at and nothing to read: no evidence, so no guess.
    if (!trimmed && !image) {
      return null
    }

    const prompt = `${REALISM_SYSTEM}\n\nSTYLE DESCRIPTION:\n"""\n${trimmed || '(none -- the style was built from the reference image alone)'}\n"""`

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        completion({
          // Image only: the text lives in `prompt`, which is forwarded to the
          // provider on its own. Repeating it here would bill the rubric twice
          // and show it to the model twice.
          contents: image ? [{ imageUrl: image, type: 'image_url' as const }] : undefined,
          models: ['gemini-3-flash-preview', 'gpt-4o-mini'],
          prompt,
          responseFormat: RealismSchema,
          task: 'user-saved-style-realism',
          temperature: 0,
          timeout: CLASSIFY_TIMEOUT_MS,
        }),
        new Promise<null>((resolve) => {
          deadlineTimer = setTimeout(() => resolve(null), CLASSIFY_DEADLINE_MS)
        }),
      ])
      if (!result) {
        this.logger.warn('style realism classification hit its deadline; saving style unlabeled')
        return null
      }
      this.logger.debug(
        { hasImage: Boolean(image), realismClass: result.realismClass, reason: result.reason },
        'classified style realism',
      )
      return result.realismClass
    } catch (error) {
      this.logger.warn(
        { error: ensureError(error) },
        'style realism classification failed; saving style without a realism class',
      )
      return null
    } finally {
      // Otherwise the pending timer keeps the event loop alive after a fast win.
      clearTimeout(deadlineTimer)
    }
  }
}
