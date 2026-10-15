/**
 * Phase C -- Anchor image generation.
 *
 * Takes the Phase B `AnchorAssetPromptSpecsArtifact` and produces the
 * final anchor images persisted at
 * `anchor_assets/final/<safeAnchorId>-<yymmdd>-<hhmmss>-<hex6>.png`.
 * The timestamp + random hex suffix gives every regeneration a unique
 * URL so CDN / browser caches don't serve stale previews when the
 * underlying anchor image is replaced. The unique suffix
 * (`<yymmdd>-<hhmmss>-<hex6>`) is also surfaced separately as
 * `AnchorImageResult.preview_asset_id` for frontend cache-keying. See
 * `generateAnchorRelativePath`.
 *
 * Three paths in `generateSingleAnchorImage`:
 *
 * 1. Passthrough fast path (logo / icon / brand mark): copy the user's
 *    source upload to the final directory without calling Nano Banana.
 *    Plan-side invariants (single source + no shared-source conflict)
 *    are enforced in `normalizeCoverageCandidate` /
 *    `downgradePassthroughOnSharedSource`, so the passthrough flag is
 *    safe to act on here.
 *
 * 2. Generation on the registry's anchor image model (normal path).
 *
 * 3. Aspect ratio is picked by branch (via `resolveAnchorAspectRatio`):
 *    1:1 for styled 2x2 grids, 2:3 for photoreal 2x3 grids,
 *    multi-angle single-shot references, and canonical singer anchors.
 */

import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { generateWithSelectedModel } from '@agent-lib/agents/storyboard/utils/generate-with-selected-model'
import { nanoBananaTool } from '@agent-lib/agents/storyboard/utils/nano-banana'
import type { Content } from '@reelmakeeasy/common/llm'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { AspectRatio, ImageSizeTier } from '@reelmakeeasy/common/media/types'

import { resolveAnchorImageGenerationModel } from '../model-config'
import type { createPlannerStorage } from '../persistence'
import { formatLogFields } from '../runtime/planner-log'
import type { AnchorAssetPromptSpec, UploadedAsset } from '../types'

import type { UploadedById } from './anchor-plan'
import { resolveAnchorBranch } from './anchor-prompt-spec-builder'
import {
  flattenAlphaToContrastingPng,
  mapWithConcurrency,
  rasterizeSvgSourceToPng,
  toSafeFileName,
  uploadedAssetToContent,
} from './anchor-utils'

const logger = createSubLogger('user-intent-planner')

const UIP_ANCHOR_ASSETS_DIR = 'anchor_assets'
export const UIP_ANCHOR_FINAL_DIR = `${UIP_ANCHOR_ASSETS_DIR}/final`
// Nano Banana accepts modest parallelism; 3 matches story-mode precedent
// while staying conservative against per-user rate limits.
const UIP_ANCHOR_IMAGE_CONCURRENCY = 3

export type AnchorImageResult = {
  anchor_id: string
  label: string
  preview_asset_id: null | string
  preview_relative_path: null | string
  source_asset_id: null | string
  source_asset_ids: string[]
  status: 'failed' | 'success'
  type: 'CHARACTER' | 'OBJECT'
}

type LocalImageGenerationParams = {
  aspectRatio: AspectRatio
  contents: Content[]
  customModel: string
  /** Image size tier, forwarded as the model's resolution. */
  imageSizeTier?: ImageSizeTier
  outputPath: string
  prompt: string
  task: string
}

/**
 * Pick the reference-sheet aspect ratio for Phase C image generation.
 * Mirrors the branch logic in `resolveAnchorBranch` so the Phase B
 * prompt text and the Phase C aspect parameter cannot drift apart.
 *
 * - `multi_angle`: story-mode also uses 2:3 for multi-angle generation;
 *   preserving the source image's camera angle is enforced by the
 *   Phase B prompt, not the aspect parameter.
 * - `singer_single_view`: 2:3 for the canonical music-video singer
 *   single-view reference; never force it into the styled 1:1 grid.
 * - `styled`: 1:1 for the 2x2 four-view grid.
 * - `photoreal`: 2:3 for the 2x3 six-view grid (story-mode parity).
 *
 * `AspectRatio` in `@reelmakeeasy/common/media/types` is declared as
 * `'1:1' | '9:16' | '16:9'` but the underlying image models accept
 * '2:3' -- story-mode `generateLongTakeSingleRawAnchorAsset` uses the
 * same `'2:3' as AspectRatio` cast. We follow that precedent rather
 * than widening the shared type.
 */
export function resolveAnchorAspectRatio(
  item: AnchorAssetPromptSpec,
  effectiveStyleText: string,
): AspectRatio {
  const branch = resolveAnchorBranch(
    {
      anchor_id: item.anchor_id,
      is_multi_angle: item.is_multi_angle,
      keyword: '',
      label: item.label,
      passthrough: item.passthrough,
      proper_name: null,
      reason: '',
      source_asset_id: item.source_asset_id,
      source_asset_ids: item.source_asset_ids,
      type: item.type,
      visual_reference: '',
      visual_tag: '',
    },
    effectiveStyleText,
  )
  if (branch === 'styled') {
    return '1:1'
  }
  // multi_angle + singer_single_view + photoreal all use 2:3
  return '2:3' as AspectRatio
}

/**
 * Generate a unique path and asset ID for an anchor image under UIP_ANCHOR_FINAL_DIR.
 * Format: `<safeAnchorId>-<yymmdd>-<hhmmss>-<6-char-hex>.png`
 * The asset ID (`<yymmdd>-<hhmmss>-<6-char-hex>`) is an immutable identity
 * for this specific generation instance and is embedded in the filename.
 */
export function generateAnchorRelativePath(anchorId: string): {
  assetId: string
  relativePath: string
} {
  const safeFileName = toSafeFileName(anchorId)
  const iso = new Date().toISOString()
  const yymmdd = iso.slice(2, 10).replace(/-/g, '')
  const hhmmss = iso.slice(11, 19).replace(/:/g, '')
  const hash = randomBytes(3).toString('hex')
  const assetId = `${yymmdd}-${hhmmss}-${hash}`
  return {
    assetId,
    relativePath: `${UIP_ANCHOR_FINAL_DIR}/${safeFileName}-${assetId}.png`,
  }
}

/**
 * Build a failure placeholder so callers can produce a deterministic
 * `AnchorImageResult` even when image generation throws.
 */
export function buildFailedAnchorImageResult(item: AnchorAssetPromptSpec): AnchorImageResult {
  return {
    anchor_id: item.anchor_id,
    preview_asset_id: null,
    preview_relative_path: null,
    label: item.label,
    source_asset_id: item.source_asset_id,
    source_asset_ids: item.source_asset_ids,
    status: 'failed',
    type: item.type,
  }
}

/**
 * Passthrough fast path: when a Plan-LLM-judged logo / icon / brand
 * mark is covered by a single user-uploaded source, copy the source
 * image into the final directory under a fresh
 * `<safeAnchorId>-<yymmdd>-<hhmmss>-<hex6>.png` filename (same scheme
 * as the Nano Banana path; see top-of-file docstring) and return it as
 * the anchor image -- skipping Nano Banana entirely. Mirrors
 * story-mode's `source_passthrough` short-circuit in
 * `generateLongTakeSingleRawAnchorAsset`.
 *
 * Preconditions enforced in the Plan normalizer (`normalizeCoverageCandidate`)
 * and the post-plan pass (`downgradePassthroughOnSharedSource`):
 * passthrough only survives for candidates with exactly one source and
 * no cross-candidate source conflict.
 */
export async function generateAnchorImages(params: {
  effectiveStyleText: string
  // When set (snapshot from session creation), anchor generation routes
  // through the selected-model orchestrator instead of the style-based path.
  imageModel?: string
  // Image size tier snapshot; applied on both generation branches.
  imageSizeTier?: ImageSizeTier
  // Org that owns the session; scopes org-keyed config reads in the orchestrator.
  orgId?: string
  promptSpecs: { items: AnchorAssetPromptSpec[] }
  sessionId: string
  storage: ReturnType<typeof createPlannerStorage>
  uploadedById: UploadedById
}): Promise<AnchorImageResult[]> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `uip-anchor-assets-${params.sessionId}-`),
  )

  try {
    return await mapWithConcurrency(
      params.promptSpecs.items,
      UIP_ANCHOR_IMAGE_CONCURRENCY,
      async (item) =>
        generateSingleAnchorImage({
          effectiveStyleText: params.effectiveStyleText,
          imageModel: params.imageModel,
          imageSizeTier: params.imageSizeTier,
          item,
          orgId: params.orgId,
          storage: params.storage,
          tempDir,
          uploadedById: params.uploadedById,
        }),
    )
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

export async function generateSingleAnchorImage(params: {
  effectiveStyleText: string
  imageModel?: string
  imageSizeTier?: ImageSizeTier
  item: AnchorAssetPromptSpec
  orgId?: string
  storage: ReturnType<typeof createPlannerStorage>
  tempDir: string
  uploadedById: UploadedById
}): Promise<AnchorImageResult> {
  const sourceAssets = (params.item.source_asset_ids ?? [])
    .map((sourceAssetId) => params.uploadedById.get(sourceAssetId) ?? null)
    .filter((asset): asset is UploadedAsset => Boolean(asset))

  // Passthrough: skip Nano Banana, copy source image to final path.
  // If the passthrough invariant is broken (no source after Plan normalization)
  // we fall through to normal generation and log a warning.
  if (params.item.passthrough) {
    const sourceAsset = sourceAssets[0]
    if (sourceAsset) {
      try {
        return await copyPassthroughSourceToFinal({
          item: params.item,
          sourceAsset,
          storage: params.storage,
          tempDir: params.tempDir,
        })
      } catch (err) {
        logger.warn(
          `[user-intent-planner] anchor passthrough copy failed; using source upload as preview fallback ${formatLogFields(
            {
              anchorId: params.item.anchor_id,
              err: err instanceof Error ? err.message : String(err),
            },
          )}`,
        )
        // For passthrough anchors (logo / icon / brand mark), Nano Banana generation
        // makes no sense as a fallback -- it would fail or produce an AI-stylised
        // version of a brand asset the user explicitly uploaded as-is.
        // Instead, surface the original upload directly as the preview image.
        // The frontend's resolveUploadedAssetPreviewUrl uses the same
        // projects/{sessionId}/user-intent-planner/ prefix for both file_path and
        // preview_relative_path, so this resolves to a valid CDN URL.
        return {
          anchor_id: params.item.anchor_id,
          preview_asset_id: null,
          preview_relative_path: sourceAsset.file_path,
          label: params.item.label,
          source_asset_id: params.item.source_asset_id,
          source_asset_ids: params.item.source_asset_ids ?? [],
          status: 'success',
          type: params.item.type,
        }
      }
    } else {
      logger.warn(
        `[user-intent-planner] anchor marked passthrough but no source asset resolved; falling back to generation ${formatLogFields(
          { anchorId: params.item.anchor_id },
        )}`,
      )
    }
  }

  const { assetId, relativePath } = generateAnchorRelativePath(params.item.anchor_id)
  const outputPath = path.join(params.tempDir, path.basename(relativePath))
  const contents: Content[] =
    sourceAssets.length > 0
      ? await Promise.all(
          sourceAssets.map((sourceAsset) => uploadedAssetToContent(sourceAsset, params.storage)),
        )
      : []

  try {
    // Gate: when a selected image model is carried on the session (snapshot
    // from session creation), route anchor generation through the
    // selected-model orchestrator. No breaker / onProviderResponse here:
    // the planner runtime does not use the story-mode circuit breaker or
    // emit provider-response telemetry, matching runAnchorImageGenerationWithFallback.
    const carriedModel = params.imageModel?.trim()
    if (carriedModel) {
      await generateWithSelectedModel({
        aspectRatio: resolveAnchorAspectRatio(params.item, params.effectiveStyleText),
        contents,
        grounding: { enableImageGrounding: true, enableTextGrounding: true },
        orgId: params.orgId ?? null,
        outputPath,
        resolutionTier: params.imageSizeTier,
        prompt: buildAnchorGenPromptWithFidelity(params.item, sourceAssets.length > 0),
        selectedModel: carriedModel,
        stage: 'anchor',
        task: 'uip-anchor-assets',
      })
    } else {
      await runAnchorImageGenerationWithFallback({
        aspectRatio: resolveAnchorAspectRatio(params.item, params.effectiveStyleText),
        contents,
        customModel: resolveAnchorImageGenerationModel(params.effectiveStyleText),
        imageSizeTier: params.imageSizeTier,
        outputPath,
        prompt: buildAnchorGenPromptWithFidelity(params.item, sourceAssets.length > 0),
        task: 'uip-anchor-assets',
      })
    }
    await params.storage.uploadFile(outputPath, relativePath)
    return {
      anchor_id: params.item.anchor_id,
      preview_asset_id: assetId,
      preview_relative_path: relativePath,
      label: params.item.label,
      source_asset_id: params.item.source_asset_id,
      source_asset_ids: params.item.source_asset_ids ?? [],
      status: 'success',
      type: params.item.type,
    }
  } catch {
    return buildFailedAnchorImageResult(params.item)
  } finally {
    await fs.promises.rm(outputPath, { force: true })
  }
}

// Model fallbacks come from the registry, inside nanoBananaTool.
export async function runAnchorImageGenerationWithFallback(
  params: LocalImageGenerationParams,
): Promise<string> {
  const { aspectRatio, contents, customModel, imageSizeTier, outputPath, prompt, task } = params
  return nanoBananaTool(prompt, contents, outputPath, task, customModel, aspectRatio, {
    grounding: {
      enableImageGrounding: true,
      enableTextGrounding: true,
    },
    imageSize: imageSizeTier,
  })
}

async function copyPassthroughSourceToFinal(params: {
  item: AnchorAssetPromptSpec
  sourceAsset: UploadedAsset
  storage: ReturnType<typeof createPlannerStorage>
  tempDir: string
}): Promise<AnchorImageResult> {
  const { assetId, relativePath } = generateAnchorRelativePath(params.item.anchor_id)
  const tempPath = path.join(params.tempDir, `passthrough-${path.basename(relativePath)}`)

  try {
    const sourceBuffer = await params.storage.readFile(params.sourceAsset.file_path)
    const rasterBuffer = await rasterizeSvgSourceToPng(sourceBuffer, params.sourceAsset)
    // Passthrough logos ship on transparency in either polarity; the keyframe
    // generator grounds on this image and renders transparency as a flat color,
    // so flatten onto a contrasting matte to keep the mark visible -- white for
    // dark marks, black for light ones.
    const { buffer: finalBuffer } = await flattenAlphaToContrastingPng(rasterBuffer)
    await fs.promises.writeFile(tempPath, finalBuffer)
    await params.storage.uploadFile(tempPath, relativePath)
    return {
      anchor_id: params.item.anchor_id,
      preview_asset_id: assetId,
      preview_relative_path: relativePath,
      label: params.item.label,
      source_asset_id: params.item.source_asset_id,
      source_asset_ids: params.item.source_asset_ids ?? [],
      status: 'success',
      type: params.item.type,
    }
  } finally {
    await fs.promises.rm(tempPath, { force: true })
  }
}

// Last-mile mirror of the Invented-Text Protocol, for anchors generated with
// no reference image. Kept in step with story-mode anchors.ts.
const ANCHOR_NO_REFERENCE_TEXT_GUARD_SUFFIX =
  '\nNo reference image is supplied for this asset, so any legible mark on it would be invented. Do not invent a brand name, wordmark, logo, or company identity, and do not borrow a real-world brand, product, or establishment that this prompt does not name. Render legible text only where this prompt supplies the exact wording; otherwise keep any lettering indistinct and non-legible rather than filling the surface with plausible-looking copy.'

// Appended in FINAL position, so this is the last instruction the image model
// reads. Unscoped, it told the model to preserve "the exact appearance from
// the reference image" -- which on a photo of two people in a room includes
// the second person and the room, and directly contradicts the background and
// subject-scoping constraints added upstream.
// Scope it to the subject and it reinforces them instead.
//
// "UNRELATED" is load-bearing. A bare "any other object" contradicts the HARD
// User Asset Protocol in anchor-prompt-spec-builder, which requires preserving
// a character's HELD OBJECTS -- so a microphone or tool the uploaded subject is
// holding would be dropped. Same reasoning as keeping a product's own packaging
// on the OBJECT branch.
const ANCHOR_REFERENCE_FIDELITY_SUFFIX =
  "\nStrictly preserve the exact appearance of THIS anchor's subject as it appears in the reference image -- " +
  'not of the background, setting, or any UNRELATED person or object sharing that image. ' +
  'Objects the subject wears, holds, or carries belong to the subject and MUST be preserved: ' +
  'for CHARACTER -- clothing, hairstyle, skin tone, accessories, held objects, footwear; ' +
  'for OBJECT/PROP/PRODUCT -- packaging text (verbatim, including brand name and any printed copy), ' +
  'color scheme, shape, material, logos, and decorative motifs, together with any packaging, contents, or parts belonging to that product. ' +
  "All of that subject's distinctive visual features must match the reference precisely; do NOT stylize, simplify, or reinvent " +
  'the design beyond what was already requested by world-bible style instructions. ' +
  "Do not reproduce the reference image's background, location, or framing."

const ANCHOR_PRINTED_TEXT_ESCAPE_REPLACEMENT = String.raw`\"`

/**
 * Build a runtime verbatim-text directive from the printed text strings
 * extracted upstream by `describe_uploaded_images` (UIP) / asset
 * understanding (story-mode). Returns an empty string when there is
 * nothing to enforce, so callers can blindly concatenate.
 *
 * Mirrors story-mode `anchors.ts:buildAnchorPrintedTextDirective` so UIP
 * and story-mode hand the image generator the same verbatim-text
 * instruction shape. The reference-fidelity suffix already tells the
 * model to preserve packaging text "as shown", but listing the exact
 * strings to render produces noticeably more reliable spelling /
 * capitalization on brand marks and logo lockups than relying on the
 * model to OCR the reference itself.
 */
export function buildAnchorPrintedTextDirective(printedText: string[] | undefined): string {
  const strings = (printedText ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (strings.length === 0) {
    return ''
  }
  const quoted = strings
    .map((value) => `"${value.replace(/"/g, ANCHOR_PRINTED_TEXT_ESCAPE_REPLACEMENT)}"`)
    .join(', ')
  return `\nRequired text on the asset, render verbatim with these exact strings (preserve spelling and capitalization): ${quoted}.`
}

/**
 * Append a reference-fidelity directive to the LLM-generated anchor prompt
 * when the anchor has source images and is NOT passthrough. Mirrors story-
 * mode anchors.ts buildAnchorRawPrompt -- the upstream prompt builder
 * (anchor-prompt-spec-builder) sets the design intent, but a last-mile
 * suffix at runtime gives Nano Banana / fallback models a final, hard-to-
 * miss instruction to keep packaging text / brand / colors / shape (or
 * character clothing / hairstyle / skin tone) identical to the reference.
 *
 * When the upstream description extracted any verbatim text strings
 * (`printed_text`), a second directive listing them is appended so the
 * model preserves logo / packaging / brand text exactly. Mirrors story-
 * mode `anchors.ts:566`.
 *
 * Skipped for passthrough anchors (those copy the source image bytes
 * directly; no generation prompt is sent at all).
 *
 * An anchor with no source uploads has no reference to be faithful to, so
 * it gets the invented-text guard instead. The Invented-Text Protocol in
 * anchor-prompt-spec-builder only instructs the prompt-spec LLM, and its
 * returned `generation_prompt` is never validated to have carried the rule
 * through, so without this last-mile suffix the image model can still be
 * handed a bare "a paper flyer" and fill the surface itself.
 */
export function buildAnchorGenPromptWithFidelity(
  item: AnchorAssetPromptSpec,
  hasResolvedSourceImages?: boolean,
): string {
  if (item.passthrough) {
    return item.generation_prompt
  }
  // Declared ids are not proof of a reference: an id absent from
  // `uploadedById` resolves to nothing, so the image call goes out with no
  // reference content. Judging by the declared ids would then promise
  // fidelity to an image the model never receives AND skip the guard,
  // leaving that asset free to invent text. Callers that know the resolved
  // count pass it; the declared ids remain the fallback for callers that
  // do not.
  const hasReference = hasResolvedSourceImages ?? (item.source_asset_ids?.length ?? 0) > 0
  if (!hasReference) {
    return `${item.generation_prompt}${ANCHOR_NO_REFERENCE_TEXT_GUARD_SUFFIX}`
  }
  return `${item.generation_prompt}${ANCHOR_REFERENCE_FIDELITY_SUFFIX}${buildAnchorPrintedTextDirective(item.printed_text)}`
}
