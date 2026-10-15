import type { PrismaService } from '../prisma/prisma.service'

// Brand-library dedup + domain helpers. The M0 auto-save-at-video-start
// trigger was retired in favour of the explicit "Confirm + Save";
// only these helpers remain.

export interface ExistingBrief {
  id: string
  sourceDomain: null | string
  sourceUrl: null | string
}

/**
 * Normalize a brand URL to its matchable domain: lowercase hostname with a
 * leading "www." stripped. Not full eTLD+1 (no public-suffix list dep yet);
 * shop.acme.com and acme.com stay distinct until that lands.
 * TODO: swap to a public-suffix parser when matching quality demands it.
 */
export function normalizeBrandDomain(url: null | string | undefined): null | string {
  if (!url) {
    return null
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`
    const hostname = new URL(withScheme).hostname.toLowerCase()
    if (!hostname) {
      return null
    }
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return null
  }
}

/**
 * Find the org's existing brief for this brand, folding the freeform and URL
 * identities into one row so a brand never forks into two. With a domain we
 * prefer the exact domain row, then fall back to a prior freeform row of the
 * same name (the caller's update then promotes it to domain-backed). Without a
 * domain we reuse any row for the name (most-recently-used first), not only the
 * freeform sourceDomain:null row -- so a later freeform save updates an
 * already-URL-saved brand in place instead of creating a duplicate.
 */
export async function findSameBrandBrief(
  prisma: PrismaService,
  args: { brandName: string; orgId: string; sourceDomain: null | string },
): Promise<ExistingBrief | null> {
  const { orgId, brandName, sourceDomain } = args
  if (sourceDomain) {
    const byDomain = await prisma.brandBrief.findFirst({ where: { orgId, sourceDomain } })
    if (byDomain) {
      return byDomain
    }
    return prisma.brandBrief.findFirst({ where: { brandName, orgId, sourceDomain: null } })
  }
  return prisma.brandBrief.findFirst({
    orderBy: { lastUsedAt: 'desc' },
    where: { brandName, orgId },
  })
}

/**
 * Find the org brief an extraction-built project's brand was SAVED into.
 * Extraction sessions have no `brand_bank_source` provenance (the brief is
 * created AFTER extraction, at confirm), so remix resolves the link the same
 * way the save itself deduped: business name + extraction-URL domain through
 * findSameBrandBrief. A brand with neither signal (or one whose brief was
 * since deleted) resolves null.
 */
export async function findBriefSavedFromSource(
  prisma: PrismaService,
  args: {
    identity: { businessName: null | string; extractionUrl: null | string }
    orgId: string
  },
): Promise<ExistingBrief | null> {
  const sourceDomain = normalizeBrandDomain(args.identity.extractionUrl)
  const brandName = args.identity.businessName
  if (brandName) {
    return findSameBrandBrief(prisma, { brandName, orgId: args.orgId, sourceDomain })
  }
  if (sourceDomain) {
    return prisma.brandBrief.findFirst({ where: { orgId: args.orgId, sourceDomain } })
  }
  return null
}
