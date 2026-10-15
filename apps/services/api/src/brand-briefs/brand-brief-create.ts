import { type Prisma } from '@reelmakeeasy/api-db'
import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import {
  type BrandBank,
  BrandBankSchema,
  StagedAssetRefSchema,
  type WebsiteScrapeEvidence,
} from '@reelmakeeasy/uip-planner-runtime'

import type { PrismaService } from '../prisma/prisma.service'

import {
  type BriefAssetAdd,
  buildBriefAssetBasePath,
  copyBankAssetsToLibrary,
} from './brand-brief-assets'
import { findSameBrandBrief, normalizeBrandDomain } from './brand-brief-auto-save'
import type { BrandBriefStyleRef } from './brand-brief-save'

const logger = createSubLogger('brand-brief-create')

// Result of a standalone create-in-library persist. Mirrors the confirm-save
// outcomes minus 'updated' (a same-brand match still reuses the row, but the
// create flow always reports the user-facing 'saved'). 'skipped' covers an
// unnamed synthesis.
export type CreateBriefResult = 'saved' | 'skipped'

export interface PersistCreatedBriefArgs {
  bank: BrandBank
  // The user's freeform brand description (freeform creates only). Used only as
  // a last-resort fallback name source when synthesis produced no business_name.
  freeformText?: null | string
  orgId: string
  // Synthetic project id of the extraction run; only used to resolve any
  // relative staging URIs when copying assets (the crawl writes absolute store://).
  sourceProjectId: string
  sourceUrl?: null | string
  userId: string
}

export interface PersistManualBriefArgs {
  // Brand "about us" summary; null/absent when the user left it blank.
  aboutUsSummary?: null | string
  // User-uploaded reference assets (staged temp uris) to copy into the library.
  assets?: BriefAssetAdd[]
  // The user-typed brand name (required, non-blank; the caller trims + validates).
  brandName: string
  // "Key message to audience" -- persisted as the first (only) CTA's label.
  keyMessage?: null | string
  orgId: string
  // Embedded style refs the user picked in the create canvas; slot-gated by the
  // caller. Opaque here -- the FE owns the snapshot shape (mirrors update()).
  styles?: unknown[]
  userId: string
}

// A freeform description longer than this is prose, not a name -- using it
// verbatim as the brand name reads badly, so we skip and ask the user to name
// it instead (see deriveFallbackBrandName).
const FALLBACK_NAME_MAX_LEN = 60

/**
 * Title-case a domain's registrable label into a brand name: acme-corp.com ->
 * "Acme Corp". Takes the label just before the TLD (mirrors normalizeBrandDomain's
 * simple dot split -- no public-suffix parser yet, so a multi-part TLD like
 * acme.co.uk stays approximate). Returns null when nothing usable remains.
 */
function brandNameFromDomain(domain: null | string): null | string {
  if (!domain) {
    return null
  }
  const labels = domain.split('.').filter(Boolean)
  const label = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
  if (!label) {
    return null
  }
  const titled = label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim()
  return titled || null
}

/**
 * Derive a human-readable fallback brand name when synthesis produced none, so
 * a valid extraction isn't discarded for lack of a name. Prefers the
 * source URL's registrable label (acme-corp.com -> "Acme Corp"); otherwise a
 * short, single-line freeform description used verbatim. Returns null when
 * neither yields anything name-sized -- the caller then skips and asks the user
 * to name the brand.
 */
export function deriveFallbackBrandName(args: {
  freeformText?: null | string
  sourceUrl?: null | string
}): null | string {
  const fromUrl = brandNameFromDomain(normalizeBrandDomain(args.sourceUrl ?? null))
  if (fromUrl) {
    return fromUrl
  }
  const firstLine = args.freeformText
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (firstLine && firstLine.length <= FALLBACK_NAME_MAX_LEN) {
    return firstLine
  }
  return null
}

/**
 * Assemble a full BrandBank from a standalone BrandExtractionWorkflow result:
 * the content-only `bankWithoutAssets` plus the crawled staged-asset candidates,
 * with any text-path reference images folded in as user uploads. Mirrors the
 * UIP `seed_brand_synthesis` + `add_brand_asset` fold (apply-brand-extraction-
 * patch.ts) so a created brief carries the same fields as a UIP-extracted one;
 * the cross-asset LLM dedup is skipped (a standalone create has no init-prompt
 * uploads to collide with the crawl).
 */
export function assembleBrandBank(
  result: {
    bankWithoutAssets?: Omit<BrandBank, 'staged_assets'>
    stagedAssetCandidates?: BrandBank['staged_assets']
  },
  imageStagingUris: string[] = [],
): BrandBank {
  if (!result.bankWithoutAssets) {
    throw new Error('brand extraction returned no brand bank')
  }
  const candidates = result.stagedAssetCandidates ?? { character: [], logo: [], product: [] }
  const uploads = imageStagingUris
    .filter((uri) => uri?.trim())
    .map((uri) =>
      StagedAssetRefSchema.parse({
        asset_kind: 'product',
        description: null,
        height: null,
        provenance: 'user_upload',
        size_bytes: null,
        source_url: null,
        staging_uri: uri,
        width: null,
      }),
    )
  return BrandBankSchema.parse({
    ...result.bankWithoutAssets,
    staged_assets: {
      character: candidates.character,
      logo: candidates.logo,
      // Generic uploads default to product, never logo (mirrors the UIP fold).
      product: [...candidates.product, ...uploads],
    },
  })
}

/**
 * Persist a freshly-extracted brand brief to the org's Brand Library: a
 * create -> copy-assets -> update sequence, sourced from a BrandExtractionWorkflow
 * result. The brief is saved style-less; the caller generates the style in the
 * background and attaches it via attachStyleRefToBrief. Returns the count of style
 * slots already used (the style gen is skipped when the brief is full).
 */
export async function persistCreatedBrandBrief(
  prisma: PrismaService,
  args: PersistCreatedBriefArgs,
): Promise<{ briefId?: string; result: CreateBriefResult; styleSlotsUsed: number }> {
  const { bank, freeformText, orgId, sourceProjectId, sourceUrl } = args
  const synthesizedName = bank.basic_info.business_name?.trim()
  let brandName = synthesizedName
  if (!brandName) {
    // Synthesis produced no name. Rather than discard an otherwise-valid
    // extraction, fall back to a name derived from the URL domain or the
    // freeform input; only a genuinely underivable brand is skipped.
    const fallback = deriveFallbackBrandName({ freeformText, sourceUrl })
    if (!fallback) {
      logger.info(`[${sourceProjectId}] create brand brief skipped: unnamed brand, no fallback`)
      return { result: 'skipped', styleSlotsUsed: 0 }
    }
    logger.info(`[${sourceProjectId}] create brand brief: unnamed synthesis, using fallback name`)
    brandName = fallback
  }
  const sourceDomain = normalizeBrandDomain(sourceUrl ?? null)
  const existing = await findSameBrandBrief(prisma, { brandName, orgId, sourceDomain })

  // A low-confidence fallback name must never downgrade a name the user already
  // saved: when synthesis produced none and this reuses an existing (domain-
  // matched) row, keep that row's brandName. Then write the resolved
  // name back onto the bank so the persisted brandBank + downstream style
  // generation carry it. (No-op for a real synthesized name.)
  if (!synthesizedName) {
    const existingName = (existing as null | { brandName?: string })?.brandName?.trim()
    if (existingName) {
      brandName = existingName
    }
    bank.basic_info.business_name = brandName
  }

  const finalSourceDomain = sourceDomain ?? existing?.sourceDomain ?? null
  const finalSourceUrl = sourceUrl ?? existing?.sourceUrl ?? null
  // Reusing a same-brand row must not erase its existing styles; a new brief
  // starts style-less. The background style gen appends one default style.
  // (ExistingBrief narrows away `styles`, but the row carries it at runtime.)
  const existingStyles = (existing as null | { styles?: unknown[] })?.styles ?? []
  const stylesJson = existingStyles as unknown as Prisma.InputJsonValue

  // Create with a text-only bank first, then rewrite with library-durable asset
  // URIs once the copy lands -- mirrors the confirm-save create/update split.
  const briefId =
    existing?.id ??
    (
      await prisma.brandBrief.create({
        data: {
          brandBank: stripStagedAssets(bank) as unknown as Prisma.InputJsonValue,
          brandName,
          orgId,
          savedKind: 'user',
          sourceDomain: finalSourceDomain,
          sourceUrl: finalSourceUrl,
          styles: stylesJson,
          userId: args.userId,
        },
      })
    ).id

  const copyResult = await copyBankAssetsToLibrary(bank, { briefId, orgId, sourceProjectId })
  const durableBank: BrandBank = copyResult.bank ?? stripStagedAssets(bank)

  await prisma.brandBrief.update({
    data: {
      assetBasePath: buildBriefAssetBasePath(orgId, briefId),
      brandBank: durableBank as unknown as Prisma.InputJsonValue,
      brandName,
      lastUsedAt: new Date(),
      savedKind: 'user',
      sourceDomain: finalSourceDomain,
      sourceUrl: finalSourceUrl,
      styles: stylesJson,
    },
    where: { id: briefId },
  })
  logger.info(
    `[${sourceProjectId}] create brand brief saved briefId=${briefId} assets=${copyResult.clonedCount}`,
  )
  return { briefId, result: 'saved', styleSlotsUsed: existingStyles.length }
}

/**
 * Persist a manually-entered brand brief: the non-AI sibling of
 * persistCreatedBrandBrief. The user typed every field, so this skips extraction
 * entirely -- and, unlike the AI path, never dedups against an existing brand
 * (a manual create is an explicit "make me a new brand", so a same-name row must
 * not be silently reused). Builds a minimal bank from the typed fields, copies
 * any uploaded assets into the durable library prefix, and writes the styles the
 * user picked.
 */
export async function persistManualBrandBrief(
  prisma: PrismaService,
  args: PersistManualBriefArgs,
): Promise<{ assetCount: number; briefId: string; result: 'saved' }> {
  const { assets, orgId, userId } = args
  const brandName = args.brandName.trim()

  const bank = buildManualBrandBank({
    aboutUsSummary: args.aboutUsSummary ?? null,
    assets,
    brandName,
    keyMessage: args.keyMessage ?? null,
  })
  const stylesJson = (args.styles ?? []) as unknown as Prisma.InputJsonValue

  // Same create-then-durable-rewrite split as the extracted path: create with a
  // text-only bank, copy assets into the library, then rewrite with durable uris.
  const briefId = (
    await prisma.brandBrief.create({
      data: {
        brandBank: stripStagedAssets(bank) as unknown as Prisma.InputJsonValue,
        brandName,
        orgId,
        savedKind: 'user',
        sourceDomain: null,
        sourceUrl: null,
        styles: stylesJson,
        userId,
      },
    })
  ).id

  const copyResult = await copyBankAssetsToLibrary(bank, {
    briefId,
    orgId,
    // No source project for a manual create; uploads sit under the shared temp
    // prefix, which copyBankAssetsToLibrary accepts directly (see resolveBankSourceUri).
    sourceProjectId: `brand-manual-${briefId}`,
  })
  const durableBank: BrandBank = copyResult.bank ?? stripStagedAssets(bank)

  await prisma.brandBrief.update({
    data: {
      assetBasePath: buildBriefAssetBasePath(orgId, briefId),
      brandBank: durableBank as unknown as Prisma.InputJsonValue,
      brandName,
      lastUsedAt: new Date(),
      savedKind: 'user',
      sourceDomain: null,
      sourceUrl: null,
      styles: stylesJson,
    },
    where: { id: briefId },
  })
  logger.info(`manual create brand brief saved briefId=${briefId} assets=${copyResult.clonedCount}`)
  return { assetCount: copyResult.clonedCount, briefId, result: 'saved' }
}

/**
 * Build a minimal valid BrandBank from the manually-typed fields. Uploaded
 * assets enter as user_upload staged refs (copied to the durable library by the
 * caller); the key message becomes the sole CTA.
 */
function buildManualBrandBank(args: {
  aboutUsSummary: null | string
  assets?: BriefAssetAdd[]
  brandName: string
  keyMessage: null | string
}): BrandBank {
  const staged_assets: BrandBank['staged_assets'] = { character: [], logo: [], product: [] }
  for (const asset of args.assets ?? []) {
    staged_assets[asset.asset_kind].push(
      StagedAssetRefSchema.parse({
        asset_kind: asset.asset_kind,
        description: asset.description ?? null,
        height: null,
        provenance: 'user_upload',
        size_bytes: null,
        source_url: null,
        staging_uri: asset.staging_uri,
        width: null,
      }),
    )
  }
  return BrandBankSchema.parse({
    basic_info: {
      about_us_summary: args.aboutUsSummary,
      business_name: args.brandName,
      location: null,
    },
    ctas: args.keyMessage?.trim() ? [{ href: '', label: args.keyMessage.trim() }] : [],
    staged_assets,
    voice: { persona: null },
  })
}

/**
 * Append the just-generated style to a brief. Pure pointer: store
 * ONLY the styleRef -- readers resolve it to the live library style, so a
 * rename/edit/delete propagates and there's no stale copy to drift. The
 * thumbnail/text live on the materialized UserSavedStyle, not here. Org-scoped
 * so a stale briefId can't write across orgs. Best-effort: a missing brief is
 * a no-op. `isDefault: false` omits the flag so the brief's existing default
 * entry keeps precedence (confirm-save path); it defaults to true (create-in-
 * library, where the generated style is the brief's only one).
 */
export async function attachStyleRefToBrief(
  prisma: PrismaService,
  briefId: string,
  orgId: string,
  input: { isDefault?: boolean; styleRef: BrandBriefStyleRef },
): Promise<void> {
  const brief = await prisma.brandBrief.findFirst({ where: { id: briefId, orgId } })
  if (!brief) {
    return
  }
  const existing = (brief.styles as undefined | unknown[]) ?? []
  // origin marks the entry as generated-for-the-brand (this helper only ever
  // attaches the synthesis output), gating the FE's "tailored to your brand" note.
  const entry = {
    ...(input.isDefault === false ? {} : { isDefault: true }),
    origin: 'brand_generated',
    styleRef: input.styleRef,
  }
  await prisma.brandBrief.update({
    data: { styles: [...existing, entry] as unknown as Prisma.InputJsonValue },
    where: { id: briefId },
  })
}

function stripStagedAssets(bank: BrandBank): BrandBank {
  return { ...bank, staged_assets: { character: [], logo: [], product: [] } }
}

/**
 * Load the raw crawl scrape the brand-extraction workflow staged at
 * `brand-extract/{runId}/_raw/scrape.json`. Path convention mirrors
 * story-mode-runtime's activities/brand-extraction/storage.ts (the api scope
 * may not import that module) -- keep the two in sync. Returns null when the
 * file is missing or unreadable so the caller degrades to the bank-text style
 * synthesis instead of failing the run.
 */
export async function readBrandCrawlScrape(
  projectId: string,
  runId: string,
): Promise<null | WebsiteScrapeEvidence> {
  try {
    const storage = new ProjectStore(projectId)
    return await storage.readJsonFile<WebsiteScrapeEvidence>(
      `brand-extract/${runId}/_raw/scrape.json`,
    )
  } catch (error) {
    logger.warn(
      `[${projectId}] failed to read brand crawl scrape for runId=${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

// Re-exported so the orchestrator can materialize the generated style without a
// direct dependency on the save module's internals.
export { materializeBrandStyleRef } from './brand-brief-style-materialize'
