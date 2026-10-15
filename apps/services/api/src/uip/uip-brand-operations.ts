// Brand-flow helpers for UIP sessions. Each op accepts UipService and delegates
// to its public helpers (signalWorkflow, assertUipAccess, etc.); the ops own only
// the brand-specific payload shape + signal name + phase guard.

import { randomUUID } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { toSavedAddress } from '@reelmakeeasy/common/storage/address'
import type {
  BrandBankEditSignalPayload,
  BrandBriefSubmitSignalPayload,
  ConfirmBrandReviewSignalPayload,
} from '@reelmakeeasy/uip-planner-runtime'
import { BadRequestException } from '@nestjs/common'

import type { BrandBriefStyleRef, BriefSaveResult } from '../brand-briefs/brand-brief-save'

import type { UipService } from './uip.service'

const logger = createSubLogger('uip-brand-ops')

// Confirm Brand Profile CTA. Signals the workflow; the planner activity applies
// `lock_brand_bank` then `activateBootstrapScript` atomically in the same drain.
export interface ConfirmBrandReviewBody {
  brandStylePreviewUrl?: string
  brandStyleText?: string
  edits?: EditBrandBankBody[]
  gateToken: string
  // "Confirm + Save": also persist the confirmed brief to the org
  // Brand Library. Best-effort -- the confirm proceeds regardless.
  save?: boolean
  // The preset/custom style the user picked, stored on the saved brief as a
  // reference. Only consulted when `save` is set.
  selectedStyleRef?: BrandBriefStyleRef
  styleDirective?: 'hybrid' | 'keep_existing_style' | null
}

export interface ConfirmBrandReviewResult {
  // Present only when `save` was requested; lets the FE toast on cap/failure.
  saved?: BriefSaveResult
  status: 'accepted' | 'invalid' | 'rejected'
}

export async function confirmBrandReview(
  svc: UipService,
  projectId: string,
  body: ConfirmBrandReviewBody,
  userId?: string,
): Promise<ConfirmBrandReviewResult> {
  await svc.assertUipAccess(projectId, 'write')
  const session = await svc.loadSession(projectId, {
    status: true,
    phase: true,
  })
  if (svc.checkActionAllowed(session, ['brand_review']) === 'rejected') {
    return { status: 'rejected' }
  }
  // Validate edits' discriminator up front so a bad payload 400s instead of
  // getting silently dropped by the activity.
  const editPayloads: BrandBankEditSignalPayload[] = []
  for (const edit of body.edits ?? []) {
    const payload = brandBankEditBodyToSignalPayload(edit)
    if (payload === null) {
      return { status: 'invalid' }
    }
    editPayloads.push(payload)
  }

  // Saved brands are off: a "Confirm + Save" never persists the brief.
  const saved: BriefSaveResult | undefined = body.save ? 'skipped' : undefined

  const payload: ConfirmBrandReviewSignalPayload = {
    gateToken: body.gateToken,
    ...(editPayloads.length > 0 ? { edits: editPayloads } : {}),
    ...(body.styleDirective === undefined ? {} : { styleDirective: body.styleDirective }),
    ...(body.brandStyleText ? { brandStyleText: body.brandStyleText } : {}),
    // The browser sends the preview's served URL back; the spec keeps its address.
    ...(body.brandStylePreviewUrl
      ? { brandStylePreviewUrl: toSavedAddress(body.brandStylePreviewUrl) }
      : {}),
  }
  await svc.signalWorkflow(projectId, 'uip-confirm-brand-review', payload)
  logger.info(
    `[${projectId}] Brand review confirmed (${editPayloads.length} pending edits, directive=${body.styleDirective === undefined ? 'unchanged' : (body.styleDirective ?? 'null')})`,
  )
  return { saved, status: 'accepted' }
}

// Map the loose confirm DTO style-ref into the discriminated domain ref,
// enforcing per-kind id coherence. Returns undefined when the kind and id don't
// agree so a malformed pair is dropped rather than persisted.
export function normalizeSelectedStyleRef(
  ref: undefined | { kind?: string; presetId?: string; userSavedStyleId?: string },
): BrandBriefStyleRef | undefined {
  if (ref?.kind === 'preset' && ref.presetId) {
    return { kind: 'preset', presetId: ref.presetId }
  }
  if (ref?.kind === 'custom' && ref.userSavedStyleId) {
    return { kind: 'custom', userSavedStyleId: ref.userSavedStyleId }
  }
  return undefined
}

// Edit a Tier 1 brand-bank field during the brand_review window. Discriminated body
// (field / add_asset / remove_asset). Returns 'accepted' | 'rejected' (wrong phase) |
// 'invalid' (discriminator/body mismatch). Single-edit-per-request, atomic.
export interface EditBrandBankBody {
  add_asset?: {
    asset_kind: 'character' | 'logo' | 'product'
    description: null | string
    file_path: string
  }
  field?: {
    path: 'basic_info.about_us_summary' | 'basic_info.business_name' | 'ctas'
    value: unknown
  }
  kind: 'add_asset' | 'field' | 'remove_asset' | 'style_directive'
  remove_asset?: {
    asset_kind: 'character' | 'logo' | 'product'
    staging_uri: string
  }
  style_directive?: 'hybrid' | 'keep_existing_style'
}

export async function editBrandBank(
  svc: UipService,
  projectId: string,
  body: EditBrandBankBody,
): Promise<'accepted' | 'invalid' | 'rejected'> {
  await svc.assertUipAccess(projectId, 'write')
  const session = await svc.loadSession(projectId, { status: true, phase: true })
  if (svc.checkActionAllowed(session, ['brand_review']) === 'rejected') {
    return 'rejected'
  }

  // Discriminator/body match check up front. Avoids signalling the
  // workflow with a payload the activity would silent-drop -- callers
  // get an actionable 400 instead.
  const payload = brandBankEditBodyToSignalPayload(body)
  if (payload === null) {
    return 'invalid'
  }
  await svc.signalWorkflow(projectId, 'uip-brand-bank-edit', payload)
  logger.info(`[${projectId}] Brand-bank edit dispatched (kind=${body.kind})`)
  return 'accepted'
}

/**
 * Validate + convert an EditBrandBankBody into the workflow signal
 * payload. Returns `null` when the discriminator field doesn't match
 * the populated body keys, so callers can surface a clean 400 instead
 * of dispatching a payload the activity would silently reject.
 */
export function brandBankEditBodyToSignalPayload(
  body: EditBrandBankBody,
): BrandBankEditSignalPayload | null {
  if (body.kind === 'field') {
    if (!body.field) {
      return null
    }
    return {
      kind: 'field',
      field: { path: body.field.path, value: body.field.value },
      requestId: randomUUID(),
    }
  }
  if (body.kind === 'add_asset') {
    if (!body.add_asset) {
      return null
    }
    return {
      kind: 'add_asset',
      add_asset: {
        asset_kind: body.add_asset.asset_kind,
        description: body.add_asset.description ?? null,
        file_path: body.add_asset.file_path,
      },
      requestId: randomUUID(),
    }
  }
  if (body.kind === 'style_directive') {
    if (!body.style_directive) {
      return null
    }
    return {
      kind: 'style_directive',
      requestId: randomUUID(),
      style_directive: body.style_directive,
    }
  }
  if (!body.remove_asset) {
    return null
  }
  return {
    kind: 'remove_asset',
    remove_asset: {
      asset_kind: body.remove_asset.asset_kind,
      staging_uri: body.remove_asset.staging_uri,
    },
    requestId: randomUUID(),
  }
}

// Stage 2 modal submit (URL or freeform). Signals the workflow with
// `BrandBriefSubmitSignalPayload`; the planner activity sets `brand_extraction_input`,
// which the workflow post-turn hook uses to launch BrandExtractionWorkflow.
export async function submitBrandBrief(
  svc: UipService,
  projectId: string,
  body: {
    answerToMessageId?: string
    kind: 'freeform' | 'url'
    text?: string
    uploadedAssets?: Array<{
      asset_id: string
      content_type: string
      file_name: string
      file_path: string
      uploaded_at?: string
    }>
    url?: string
  },
): Promise<void> {
  await svc.assertUipAccess(projectId, 'write')
  await svc.requireActiveSession(projectId, null, 'submitBrandBrief')

  let input: BrandBriefSubmitSignalPayload['input']
  if (body.kind === 'url') {
    const url = (body.url ?? '').trim()
    if (!url) {
      throw new BadRequestException('brand-brief URL is required')
    }
    // Fast-fail malformed URLs here; the patch-apply zod schema re-validates.
    try {
      new URL(url)
    } catch {
      throw new BadRequestException(`brand-brief URL is not a valid URL: ${url}`)
    }
    input = { kind: 'url', url }
  } else {
    const text = (body.text ?? '').trim()
    if (!text) {
      throw new BadRequestException('brand-brief freeform text is required')
    }
    input = { kind: 'freeform', text }
  }

  const payload: BrandBriefSubmitSignalPayload = {
    answerToMessageId: body.answerToMessageId,
    input,
    requestId: randomUUID(),
    uploadedAssets: body.uploadedAssets?.map((asset) => ({
      ...asset,
      uploaded_at: asset.uploaded_at ?? new Date().toISOString(),
    })),
  }
  await svc.signalWorkflow(projectId, 'uip-brand-brief-submit', payload)
  logger.info(`[${projectId}] Brand brief submitted (kind=${input.kind})`)
}
