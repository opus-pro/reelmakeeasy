import type { Prisma } from '@reelmakeeasy/api-db'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { deleteStoredFolder, storeUri } from '@reelmakeeasy/common/storage/stored-files'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { type BrandBank, BrandBankSchema } from '@reelmakeeasy/uip-planner-runtime'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

import {
  applyBriefAssetEdits,
  applyStagedAssetsLayout,
  type BriefAssetAdd,
  type BriefAssetRemove,
  buildBriefAssetBasePath,
  type StagedAssetsLayout,
} from './brand-brief-assets'
import { persistManualBrandBrief } from './brand-brief-create'
import { BRAND_BRIEF_STYLE_SLOTS } from './brand-brief-limits'

// Manually-entered brand brief: the non-AI create path. Only
// brandName is required; the rest of the "blank canvas" fields are optional.
export interface CreateManualBrandBriefPayload {
  aboutUsSummary?: null | string
  assets?: BriefAssetAdd[]
  brandName: string
  keyMessage?: null | string
  styles?: unknown[]
}

// Partial edit of a saved brief. Every field is optional; only the
// fields present are persisted. Bank-backed fields (name/summary/key message/
// assets) rewrite the embedded brand_bank; styles is a top-level column.
export interface UpdateBrandBriefPayload {
  aboutUsSummary?: null | string
  addAssets?: BriefAssetAdd[]
  brandName?: string
  // "Key message to audience" -- the first CTA's label.
  keyMessage?: null | string
  removeAssets?: BriefAssetRemove[]
  // Full staged-asset layout after drag-drop re-bucketing / select-delete: the
  // uris to keep, per bucket, in order. Authoritative for assets when
  // present -- subsumes removeAssets for the edit form.
  stagedAssets?: StagedAssetsLayout
  // Embedded style refs; the FE sends the full array (remove-style sends it
  // filtered). Opaque here -- the FE owns the snapshot shape.
  styles?: unknown[]
}

const logger = createSubLogger('brand-brief-service')

@Injectable()
export class BrandBriefService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a brand brief from manually-entered fields, no AI
   * extraction. Validates the required name, gates the picked styles against the
   * per-brief style slots (mirroring update()), then persists via
   * persistManualBrandBrief and returns the saved row.
   */
  async createManual(payload: CreateManualBrandBriefPayload) {
    const brandName = payload.brandName?.trim()
    if (!brandName) {
      throw new BadRequestException('A brand name is required')
    }
    // No global ValidationPipe in this api, so the payload type is compile-time
    // only: coerce a non-array styles to [] (mirrors update()'s Array.isArray
    // guard) so a malformed body can't bypass the slot gate or write a non-array
    // into the styles column that every reader treats as a list.
    const styles = Array.isArray(payload.styles) ? payload.styles : []
    if (styles.length > BRAND_BRIEF_STYLE_SLOTS) {
      throw new BadRequestException('style_slots_exceeded')
    }
    const orgId = this.orgId()
    const userId = getReqContext().login_id
    const { briefId } = await persistManualBrandBrief(this.prisma, {
      aboutUsSummary: payload.aboutUsSummary,
      assets: payload.assets,
      brandName,
      keyMessage: payload.keyMessage,
      orgId,
      styles,
      userId,
    })
    return this.get(briefId)
  }

  /**
   * Delete a brief and its durable asset folder. The row is removed first; the
   * storage folder delete is best-effort (a left-behind folder is harmless and
   * eventually orphaned), so a storage hiccup never blocks the user-visible
   * delete.
   */
  async delete(id: string) {
    const brief = await this.get(id)
    await this.prisma.brandBrief.delete({ where: { id: brief.id } })

    const basePath = brief.assetBasePath ?? buildBriefAssetBasePath(brief.orgId, brief.id)
    await deleteStoredFolder(storeUri(basePath)).catch((error) => {
      logger.warn(`[${brief.id}] failed to delete brief assets: ${ensureError(error).message}`)
    })
    return { deleted: true, id: brief.id }
  }

  async get(id: string) {
    const brief = await this.prisma.brandBrief.findFirst({
      where: { id, orgId: this.orgId() },
    })
    if (!brief) {
      throw new NotFoundException('Brand brief not found')
    }
    return brief
  }

  /**
   * List the org's saved briefs, most-recently-used first. Org-scoped: a brief
   * is shared across the org (orgId is the query key), so any seat sees the
   * org's library. Returns auto-saved and user-saved briefs alike; the caller
   * (FE selector) splits them by savedKind.
   */
  async list() {
    return this.prisma.brandBrief.findMany({
      orderBy: { lastUsedAt: 'desc' },
      where: { orgId: this.orgId() },
    })
  }

  /**
   * Partially update a saved brief. Org-scoped end to end: get() rejects a
   * cross-org id before any write, and every write filters by { id, orgId }.
   * Only the fields present in the payload are persisted. Bank-backed fields
   * (name / summary / key message / assets) rewrite the embedded brand_bank;
   * styles is a top-level column, write-gated by the per-brief style slots.
   */
  async update(id: string, payload: UpdateBrandBriefPayload) {
    const brief = await this.get(id)
    if (payload.styles !== undefined) {
      assertStyleSlots(brief.styles, payload.styles)
    }
    const { orgId } = brief
    const data: Prisma.BrandBriefUpdateManyMutationInput = {}

    const bank = await this.applyBankEdits(brief, payload)
    if (bank) {
      data.brandBank = bank as unknown as Prisma.InputJsonValue
    }
    if (payload.brandName !== undefined) {
      data.brandName = payload.brandName
    }
    if (payload.styles !== undefined) {
      data.styles = payload.styles as unknown as Prisma.InputJsonValue
    }
    if (Object.keys(data).length === 0) {
      return brief
    }

    await this.prisma.brandBrief.updateMany({ data, where: { id: brief.id, orgId } })

    return this.get(brief.id)
  }

  /**
   * Apply the bank-backed edits (name / summary / key message / assets) to the
   * brief's brand_bank, returning the rewritten bank, or null when the payload
   * touches no bank field (so the column is left untouched).
   */
  private async applyBankEdits(
    brief: { brandBank: unknown; id: string; orgId: string },
    payload: UpdateBrandBriefPayload,
  ): Promise<BrandBank | null> {
    const touchesBank =
      payload.brandName !== undefined ||
      payload.aboutUsSummary !== undefined ||
      payload.keyMessage !== undefined ||
      Boolean(payload.addAssets?.length) ||
      Boolean(payload.removeAssets?.length) ||
      payload.stagedAssets !== undefined
    if (!touchesBank) {
      return null
    }

    let bank = BrandBankSchema.parse(brief.brandBank)
    if (payload.brandName !== undefined) {
      bank.basic_info.business_name = payload.brandName
    }
    if (payload.aboutUsSummary !== undefined) {
      bank.basic_info.about_us_summary = payload.aboutUsSummary
    }
    if (payload.keyMessage !== undefined) {
      // Key message to audience = the first CTA's label; preserve its href (both
      // are required by the ctas schema), clear all CTAs when blanked.
      const href = bank.ctas[0]?.href ?? ''
      bank.ctas = payload.keyMessage?.trim() ? [{ href, label: payload.keyMessage }] : []
    }
    // Apply the existing-asset layout (re-bucket / reorder / delete) first, then
    // copy + append any new uploads, so a freshly-added asset (whose durable uri
    // the layout doesn't know yet) isn't dropped by the layout pass.
    if (payload.stagedAssets !== undefined) {
      bank = await applyStagedAssetsLayout(bank, payload.stagedAssets, { briefId: brief.id })
    }
    if (payload.addAssets?.length || payload.removeAssets?.length) {
      bank = await applyBriefAssetEdits(bank, {
        add: payload.addAssets,
        briefId: brief.id,
        orgId: brief.orgId,
        remove: payload.removeAssets,
      })
    }
    return bank
  }

  private orgId(): string {
    return getReqContext().org_id
  }
}

/**
 * Reject a styles write that grows the brief beyond its style slots.
 * Shrinks and same-count swaps always pass, so an over-full brief can be trimmed
 * toward compliance.
 */
function assertStyleSlots(currentStyles: unknown, nextStyles: unknown[]): void {
  const currentCount = Array.isArray(currentStyles) ? currentStyles.length : 0
  if (nextStyles.length > currentCount && nextStyles.length > BRAND_BRIEF_STYLE_SLOTS) {
    throw new BadRequestException('style_slots_exceeded')
  }
}
