import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { z } from 'zod'

import { DESCRIBE_IMAGE_MODELS } from '../model-config'
import {
  downscaleToLongEdge,
  flattenAlphaToContrastingPng,
  mapWithConcurrency,
} from '../tool-internals/anchor-utils'
import { isLlmCompatibleImageAsset } from '../tool-internals/llm-image-mime'
import { AssetDescriptionItem, AssetDescriptionsArtifact, UploadedAsset } from '../types'

const logger = createSubLogger('user-intent-planner')

/**
 * Prompt and output schema are ported from story-mode's
 * `long-take-user-asset-understanding-prompt.ts` so UIP and story-mode
 * share one contract for image understanding. When adjusting phrasing,
 * keep both runtimes in sync.
 */
export function buildImageDescriptionPrompt(params?: { mime: string; shortname: string }): string {
  const shortname = params?.shortname?.trim() || 'unknown_file'
  const mime = params?.mime?.trim() || 'unknown'

  return `Role: Visual Asset Analyst for Story Mode.

Task: Analyze the provided image and extract objective visual facts.

Input metadata:
- shortname: ${shortname}
- mime: ${mime}

Rules:
1. Describe only what is visually observable in the image.
2. Do not invent identities, brands, or context not visible in pixels.
3. Keep "description" concrete (3-8 sentences). For images containing people or characters, you MUST include ALL of the following observable details:
   - Clothing: exact garment types, colors, patterns, layering (e.g. "navy blue zip-up hoodie over a white t-shirt")
   - Hairstyle: color, length, texture, style (e.g. "shoulder-length wavy auburn hair with side part")
   - Skin tone and complexion
   - Facial features: glasses, facial hair, expression, distinguishing marks
   - Accessories: jewelry, hats, bags, watches, held objects
   - Footwear if visible
   - Body type and approximate age range
   Do NOT generalize these as "standard attire" or "casual clothing" — be specific.
   For images containing PRODUCTS / OBJECTS / PACKAGING / LOGOS, you MUST include ALL of the following observable details:
   - Visible text on the packaging or object, transcribed verbatim (brand name, product name, taglines, ingredient lists, sizing — exactly as printed)
   - Color scheme: primary and accent colors, finish (matte / glossy / metallic / kraft paper / etc.)
   - Shape and form factor (e.g. "stand-up pouch with tear notch", "cylindrical bottle with screw cap", "rectangular box")
   - Material appearance (e.g. "kraft paper", "frosted plastic", "embossed cardboard")
   - Logos, icons, illustrations, or decorative motifs printed on the surface
   - Typography choices that are part of the product identity (serif / sans-serif / handwritten, weight, layout)
   Do NOT generalize as "a product" / "packaging" / "a bag" — list the specifics. The downstream image generator will use this description as the design truth; missing details get reinvented and the generated anchor will diverge from the user's actual product.
4. "tags" should be short tokens useful for retrieval (e.g. "person", "logo", "dashboard_ui", "product", "office", "document").
5. "entities.characters" are visible people/person-like entities.
6. "entities.objects" are salient non-person objects/products/UI elements.
7. "entities.brands_or_text" includes readable text/brand terms only when clearly visible.
8. Set quality flags conservatively.
   - Set "quality.text_heavy_infographic" to true only when text blocks, diagrams, charts, or data are the primary informational content and dominate the meaningful image area. Set it false for cast sheets, character/reference/contact sheets, or multi-view product sheets when text is limited to names, view labels, or short captions and the visual subjects remain primary.
   - Set "quality.identity_clarity" for recurring-person identity use:
     - "clear": the person's face and distinguishing appearance are directly observable.
     - "limited": some useful identity detail is visible, but blur, occlusion, crop, profile angle, distance, or lighting hides important traits.
     - "silhouette_only": a person is visible only as a pure/heavily backlit silhouette or back-only view, so the face and distinguishing appearance cannot be observed reliably.
     - "not_applicable": no person/person-like subject is present.
9. "summary" is a single concise sentence (<= 120 characters) capturing the primary visible subject. Used as a lightweight caption in downstream planner context; must stand on its own.
10. "brand_asset_kind" classifies the image's primary visual role for brand use. Set this whenever the image is a brand-supplied asset; set null when the image is generic / not classifiable as one of the three:
   - "logo": a brand mark, wordmark, or icon. High-contrast graphic, often with brand-name text, transparent or solid background. Used to identify the brand.
   - "product": the brand's product itself. This covers BOTH a physical item the brand sells or showcases (packaging, merchandise, product photography -- packshot or lifestyle) AND the brand's software product shown as a screenshot, UI capture, app interface, or dashboard. A screenshot of the brand's own app or website UI is a "product", NOT a "logo" -- even when the brand logo appears in a corner of the screenshot.
   - "character": a recurring person, mascot, or identifiable individual associated with the brand. Used as a narrative subject.
   Pick the DOMINANT role. A person holding a product → "character" if the person is the subject; "product" if the product is foreground + central. Set null only if none of the three fit.

Output only valid JSON with this schema:
{
  "description": "string",
  "summary": "string",
  "tags": ["string"],
  "entities": {
    "characters": ["string"],
    "objects": ["string"],
    "brands_or_text": ["string"]
  },
  "quality": {
    "identity_clarity": "clear" | "limited" | "silhouette_only" | "not_applicable",
    "text_heavy_infographic": false
  },
  "brand_asset_kind": "logo" | "product" | "character" | null
}`
}

const IdentityClaritySchema = z.enum(['clear', 'limited', 'silhouette_only', 'not_applicable'])

const QualitySchema = z.object({
  identity_clarity: IdentityClaritySchema.optional(),
  text_heavy_infographic: z.boolean().default(false),
})

const EntitiesSchema = z.object({
  brands_or_text: z.array(z.string()).default([]),
  characters: z.array(z.string()).default([]),
  objects: z.array(z.string()).default([]),
})

/**
 * Mirrors `LongTakeUserAssetUnderstandingModelOutputSchema` in
 * `libs/story-mode-runtime/src/activities/long-take-user-assets-understanding.ts`
 * with one UIP-specific addition: `summary`, a one-sentence caption
 * (<= 120 chars) used by UIP's context-builder to give the planner a
 * lightweight per-asset description without dumping the full `description`
 * text into every prompt.
 *
 * `usage_guidance` is optional because the prompt does not request it but
 * some models emit it on their own; runtime normalizes to a non-null default
 * downstream.
 */
export const imageDescriptionSchema = z.object({
  brand_asset_kind: z.enum(['logo', 'product', 'character']).nullable().default(null),
  description: z.string().nullable().default(null),
  entities: EntitiesSchema.default({
    brands_or_text: [],
    characters: [],
    objects: [],
  }),
  quality: QualitySchema.default({
    text_heavy_infographic: false,
  }),
  summary: z.string().default(''),
  tags: z.array(z.string()).default([]),
  usage_guidance: z.string().nullable().default(null),
})

/**
 * Fresh vision-model responses must classify identity clarity. The public
 * schema remains legacy-compatible so replayed artifacts created before
 * identity-clarity classification can still be read and normalized safely.
 */
export const imageDescriptionResponseSchema = imageDescriptionSchema.extend({
  quality: z.object({
    identity_clarity: IdentityClaritySchema,
    text_heavy_infographic: z.boolean().default(false),
  }),
})

export type ImageDescription = z.infer<typeof imageDescriptionSchema>
export type ImageDescriptionFilename = ImageDescription & {
  filename?: string
}

/**
 * The anchor-assets picker renames each upload to a category-prefixed
 * shortname ("Actor image 1", "Logo image 1", "Object image 1"). That prefix
 * records the user's explicit choice of how the asset should be used, so it
 * must win over the model's pixel-only guess. "Assets" uploads carry no role
 * hint, so they fall back to the model classification.
 */
const UPLOAD_CATEGORY_BRAND_ASSET_KINDS: ReadonlyArray<
  [prefix: string, kind: NonNullable<ImageDescription['brand_asset_kind']>]
> = [
  ['actor image', 'character'],
  ['logo image', 'logo'],
  ['object image', 'product'],
]

export function inferBrandAssetKindFromUploadCategory(
  fileName: null | string | undefined,
): ImageDescription['brand_asset_kind'] {
  const normalized = fileName?.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  for (const [prefix, kind] of UPLOAD_CATEGORY_BRAND_ASSET_KINDS) {
    if (normalized.startsWith(prefix)) {
      return kind
    }
  }
  return null
}

// Image captioning is an independent per-image LLM call, so run up to
// DESCRIBE_IMAGE_CONCURRENCY in parallel. Bootstrap sessions with many
// uploads see N x latency collapse to ceil(N / concurrency) x latency
// without changing the resulting artifact (per-image results are
// position-stable via `mapWithConcurrency`).
//
// Raised 3 -> 6. The captioner (gemini-2.5-flash) runs on demand rather than
// through a reserved-throughput queue, so the extra parallelism is real
// wall-clock savings rather than deeper queueing. Ceiling is the provider's rate
// limit + activity memory (bounded by DESCRIBE_IMAGE_MAX_LONG_EDGE); watch for
// 429/5xx before going higher.
const DESCRIBE_IMAGE_CONCURRENCY = 6

// Cap the longest edge of each image before base64-encoding it for the vision
// model. Gemini tiles input into 768x768 tiles (~258 tokens each), so pixels
// beyond what a short factual caption needs only inflate tokens -> latency &
// cost. 1536px keeps ~2x2-2x3 tiles -- enough to read the packaging text the
// prompt requires transcribed verbatim. Conservative starting point; tune per
// A/B on caption fidelity.
const DESCRIBE_IMAGE_MAX_LONG_EDGE = 1536

export async function describeUploadedImages(
  uploadedAssets: UploadedAsset[],
  options: { projectId: string },
): Promise<AssetDescriptionsArtifact> {
  const items = await mapWithConcurrency(
    uploadedAssets,
    DESCRIBE_IMAGE_CONCURRENCY,
    async (asset) =>
      normalizeAssetDescription(asset, await generateImageDescription(asset, options)),
  )

  return {
    generated_at: new Date().toISOString(),
    items,
  }
}

export async function generateImageDescription(
  asset: UploadedAsset,
  options: { projectId: string },
): Promise<ImageDescription> {
  // An LLM-incompatible MIME (SVG / HEIC / ...) reaches here only when
  // promote-time rasterization failed and left the raw asset. Sending it
  // 400s the vision model and rejects the whole describe call, so skip it
  // and return an empty description -- the asset still surfaces as an item,
  // just without LLM-derived fields.
  if (!isLlmCompatibleImageAsset({ contentType: asset.content_type, fileName: asset.file_name })) {
    logger.warn(
      `skipping description for LLM-incompatible upload ${JSON.stringify({
        assetId: asset.asset_id,
        contentType: asset.content_type,
        fileName: asset.file_name,
        projectId: options.projectId,
      })}`,
    )
    return imageDescriptionSchema.parse({})
  }
  const imageDataUrl = await imagePathToDataUrl(asset, options)
  const prompt = buildImageDescriptionPrompt({
    mime: asset.content_type,
    shortname: asset.file_name,
  })

  return await completion({
    models: DESCRIBE_IMAGE_MODELS,
    prompt,
    contents: [{ type: 'image_url', imageUrl: imageDataUrl }],
    responseFormat: imageDescriptionResponseSchema,
    reasoningEffort: 'low',
    temperature: 0,
    task: 'user-intent-planner-image_description',
    timeout: 60_000,
  })
}

export function normalizeAssetDescription(
  asset: UploadedAsset,
  output: ImageDescription,
): AssetDescriptionItem {
  const description = output.description?.trim() || null
  const entities = {
    brands_or_text: normalizeStringList(output.entities.brands_or_text),
    characters: normalizeStringList(output.entities.characters),
    objects: normalizeStringList(output.entities.objects),
  }
  return {
    // UIP metadata
    asset_id: asset.asset_id,
    brand_asset_kind:
      inferBrandAssetKindFromUploadCategory(asset.file_name) ?? output.brand_asset_kind,
    content_type: asset.content_type,
    file_name: asset.file_name,
    file_path: asset.file_path,
    // LLM output (aligned with story-mode shape)
    description,
    tags: normalizeStringList(output.tags),
    entities,
    quality: {
      identity_clarity: output.quality.identity_clarity ?? 'not_applicable',
      text_heavy_infographic: Boolean(output.quality.text_heavy_infographic),
    },
    usage_guidance: output.usage_guidance?.trim() || null,
    summary: normalizeSummary(output.summary),
  }
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
    ),
  )
}

/**
 * Defensive trim + 120-char cap even though the prompt asks the LLM to
 * stay under 120; real outputs sometimes overshoot slightly.
 */
async function imagePathToDataUrl(
  asset: UploadedAsset,
  options: { projectId: string },
): Promise<string> {
  const storage = await createStorage(options.projectId)
  const imageBuffer = await storage.readFile(asset.file_path)
  const { buffer: flattened, changed } = await flattenAlphaToContrastingPng(imageBuffer)
  // Cap resolution before base64: full-res uploads (multi-MP phone photos) add
  // Gemini tiles -> tokens -> latency with no caption-quality gain. Best-effort
  // so an undecodable buffer still sends the flattened original.
  const { buffer } = await downscaleToLongEdge(flattened, DESCRIBE_IMAGE_MAX_LONG_EDGE)
  const mimeType = changed ? 'image/png' : asset.content_type || 'image/jpeg'
  const base64 = buffer.toString('base64')
  return `data:${mimeType};base64,${base64}`
}

function normalizeSummary(summary: string | undefined): string {
  if (!summary) {
    return ''
  }
  const trimmed = summary.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.length > 120 ? trimmed.slice(0, 120).trim() : trimmed
}
