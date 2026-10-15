/**
 * Brand-card style preview. Async-SSE generation that mirrors the
 * custom-style scene-sample flow (`media.controller` start/stream): the FE
 * opens the stream, POSTs `/start`, and receives a single `preview` event
 * carrying the restyled image URL plus the brand style text.
 *
 * The brand style text is returned so the FE can carry the user's chosen
 * variant back into `confirm-brand-review`, keeping the previewed look and
 * the rendered video consistent. Generation is grounded in the session's
 * locked-or-extracted `brand_bank`; the preset reference frame to restyle is
 * passed by the FE (it owns the style-preset library).
 */

import { createHash } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { SSEBus } from '@reelmakeeasy/common/sse/sse'
import { storeUri, uploadBufferToStore } from '@reelmakeeasy/common/storage/stored-files'
import {
  generateBrandStylePreviewImage,
  generateBrandStyling,
  type Spec,
  toBrandDnaInput,
} from '@reelmakeeasy/uip-planner-runtime'
import { BadRequestException } from '@nestjs/common'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-brand-style-preview')

export const BRAND_STYLE_PREVIEW_EVENT = 'preview'

// Generation takes tens of seconds, so a refresh/reconnect must not restart
// it. Completed results are cached in storage keyed by a hash of the inputs, and
// concurrent calls for the same inputs share one in-flight promise (per pod).
const inflight = new Map<string, Promise<BrandStylePreviewResult>>()

export interface BrandStylePreviewParams {
  projectId: string
  referenceFrameUrl: string
  /** Preset medium anchor; falls back to the session's seeded style text. */
  styleText?: string
}

export interface BrandStylePreviewResult {
  brandStyleText: string
  previewUrl: string
}

/**
 * Generate the brand-styled preview and push it to the SSE bus. Throws on any
 * missing dependency or generation failure; the controller's `bus.safeRun`
 * wrapper turns the throw into an `error` event for the client.
 */
export async function generateBrandStylePreview(
  params: BrandStylePreviewParams,
): Promise<BrandStylePreviewResult> {
  const { projectId, referenceFrameUrl } = params
  if (!referenceFrameUrl.trim()) {
    throw new BadRequestException('reference_frame_url is required')
  }

  const spec = await loadSpec(projectId)
  const gc = spec.global_constraints
  const brandBank = gc.brand_bank
  if (!brandBank) {
    throw new BadRequestException('No brand bank available for style preview')
  }

  const { inputsHash, resultPath, userStyleText } = resolveCacheKey(params, gc, brandBank)

  const cached = await loadCachedResult(resultPath)
  if (cached) {
    logger.info(`[${projectId}] brand style preview cache hit (${inputsHash})`)
    return cached
  }

  const key = `${projectId}:${inputsHash}`
  const pending = inflight.get(key)
  if (pending) {
    return pending
  }
  const run = renderAndStorePreview({
    brandBank,
    inputsHash,
    projectId,
    referenceFrameUrl,
    resultPath,
    userStyleText,
  }).finally(() => inflight.delete(key))
  inflight.set(key, run)
  return run
}

export async function streamBrandStylePreview(
  params: BrandStylePreviewParams,
  bus: SSEBus,
): Promise<void> {
  const result = await generateBrandStylePreview(params)
  await bus.push({ data: JSON.stringify(result), type: BRAND_STYLE_PREVIEW_EVENT })
  // End the bus so the client receives `complete`; safeRun only emits the
  // terminal event on failure, so without this the FE awaits it forever
  // (same contract as style-analyzer.service).
  await bus.end()
}

/**
 * Cache-only lookup so a reload rehydrates the previewed tile with one GET
 * instead of re-running the start/stream SSE flow. Recomputes the inputs hash
 * from the current spec (same key as generation, so brand-review edits miss
 * and fall back to live generation). Returns null on any miss or read error;
 * the caller then decides whether to generate.
 */
export async function getCachedBrandStylePreview(
  params: BrandStylePreviewParams,
): Promise<BrandStylePreviewResult | null> {
  if (!params.referenceFrameUrl.trim()) {
    return null
  }
  try {
    const spec = await loadSpec(params.projectId)
    const gc = spec.global_constraints
    const brandBank = gc.brand_bank
    if (!brandBank) {
      return null
    }
    const { inputsHash, resultPath } = resolveCacheKey(params, gc, brandBank)
    const cached = await loadCachedResult(resultPath)
    if (cached) {
      logger.info(`[${params.projectId}] brand style preview cached lookup hit (${inputsHash})`)
    }
    return cached
  } catch {
    // Missing spec or unreadable state degrades to "no cached preview".
    return null
  }
}

async function loadCachedResult(resultPath: string): Promise<BrandStylePreviewResult | null> {
  try {
    const buf = await fileStore.file(resultPath).read()
    const parsed = JSON.parse(buf.toString()) as Partial<BrandStylePreviewResult>
    if (typeof parsed.brandStyleText === 'string' && typeof parsed.previewUrl === 'string') {
      return { brandStyleText: parsed.brandStyleText, previewUrl: parsed.previewUrl }
    }
  } catch {
    // Cache miss or unreadable sidecar: regenerate.
  }
  return null
}

async function loadSpec(projectId: string): Promise<Spec> {
  const file = await fileStore
    .file(`projects/${projectId}/user-intent-planner/spec/current/spec.json`)
    .read()
  return JSON.parse(file.toString()) as Spec
}

async function renderAndStorePreview(opts: {
  brandBank: NonNullable<Spec['global_constraints']['brand_bank']>
  inputsHash: string
  projectId: string
  referenceFrameUrl: string
  resultPath: string
  userStyleText: string
}): Promise<BrandStylePreviewResult> {
  const { brandBank, inputsHash, projectId, referenceFrameUrl, resultPath, userStyleText } = opts

  const styling = await generateBrandStyling({ brandBank, userStyleText })
  if (!styling) {
    throw new BadRequestException('Failed to generate brand styling')
  }
  const brandStyleText = `${styling.brand_style_paragraph}\n${styling.medium_reskin_paragraph}`

  const imageBase64 = await generateBrandStylePreviewImage({ brandStyleText, referenceFrameUrl })
  if (!imageBase64) {
    throw new BadRequestException('Failed to render brand style preview image')
  }

  const fileUri = `projects/${projectId}/user-intent-planner/brand-style-preview/preview-${inputsHash}.png`
  await uploadBufferToStore(Buffer.from(imageBase64, 'base64'), storeUri(fileUri), {
    contentType: 'image/png',
  })
  // Kept (in the cached result too) as the address; served as a URL when sent out.
  const previewUrl = storeUri(fileUri)
  const result: BrandStylePreviewResult = { brandStyleText, previewUrl }
  await uploadBufferToStore(Buffer.from(JSON.stringify(result), 'utf8'), storeUri(resultPath), {
    contentType: 'application/json',
  })
  logger.info(`[${projectId}] brand style preview ready`)
  return result
}

// Cache key over everything the result depends on: the brand DNA subset
// generateBrandStyling consumes (toBrandDnaInput keeps the two in lockstep,
// so brand-review edits invalidate the cache) plus the reference frame that
// drives the image. The preset is the medium anchor for the re-skin
// paragraph; the FE passes it, with the seeded style text as a fallback.
function resolveCacheKey(
  params: BrandStylePreviewParams,
  gc: Spec['global_constraints'],
  brandBank: NonNullable<Spec['global_constraints']['brand_bank']>,
): { inputsHash: string; resultPath: string; userStyleText: string } {
  const { projectId, referenceFrameUrl } = params
  const userStyleText = params.styleText?.trim() || gc.style?.style_text?.trim() || ''
  const inputsHash = createHash('sha256')
    .update(JSON.stringify({ dna: toBrandDnaInput(brandBank), referenceFrameUrl, userStyleText }))
    .digest('hex')
    .slice(0, 12)
  const resultPath = `projects/${projectId}/user-intent-planner/brand-style-preview/result-${inputsHash}.json`
  return { inputsHash, resultPath, userStyleText }
}
