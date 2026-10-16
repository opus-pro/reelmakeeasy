/**
 * Brand site crawler activity for UIP Brand Extraction.
 *
 * Pipeline (one Playwright session, sequential per-page):
 *   1. SSRF guard against `params.url`.
 *   2. Launch headless Chromium.
 *   3. Discovery: fetch /sitemap.xml + /sitemap_index.xml via context.request,
 *      then run nav-DOM source on the homepage. Merge + rank.
 *   4. Crawl up to MAX_PAGES (homepage + picked) sequentially. Per page:
 *        - goto + scroll to trigger lazy-loading
 *        - take JPG screenshot for the first SCREENSHOT_PAGES pages
 *        - run combined PAGE_SCRAPE_SOURCE -> JSON
 *   5. Stage `_raw/scrape.json` and `assets/screenshots/{slug}.jpg` to storage
 *      under `brand-extract/{runId}/`.
 *   6. Return { screenshotUris, stagedAssetCandidates }. The raw scrape is
 *      handed off via storage (`_raw/scrape.json`), not the activity result, so a
 *      heavy multi-page site doesn't bloat the activity result.
 *      `synthesizeBrandActivity` reads it back from storage for the url kind.
 *
 * `stagedAssetCandidates` carries the staged logos/products; the Brand Brief
 * card stages them into the patch ops via `add_brand_asset`.
 *
 * Heartbeats fire every 20s through `withActivityHeartbeat`; in addition the
 * page-loop heartbeats explicitly between pages so a stuck Chromium gets
 * killed within `heartbeatTimeout: 60s`. Wall clock is bounded by
 * `startToCloseTimeout: 15 minutes` configured in `activity-proxies.ts`.
 */

import { createHash } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { validateOutboundUrl } from '@reelmakeeasy/common/utils/outbound-url'
import type { StagedAssetCategory, StagedAssetRef } from '@reelmakeeasy/uip-planner-runtime'
import {
  FALLBACK_MIME,
  inferContentTypeFromSourceUrl,
  resolveProxiedImageUrl,
} from '@reelmakeeasy/uip-planner-runtime/tool-internals/brand-staged-assets-to-uploads'
import { type BrowserContext, chromium, type Page } from 'playwright'

import { withActivityHeartbeat, withLongTakeContext } from '../long-take/common'

import { collectSitemapPages, navDiscoverySource, rankDiscoveredUrls } from './discovery'
import { guessExtension, guessFontExtension, isDecodableRasterImage } from './extension-utils'
import { normalizeStagedRasterForLlm } from './llm-safe-raster'
import { PAGE_SCRAPE_SOURCE, type PageScrapeResult, SCROLL_SCRIPT } from './page-scrape-source'
import {
  BRAND_FONTS_DIR,
  BRAND_IMAGES_DIR,
  BRAND_LOGOS_DIR,
  BRAND_RAW_DIR,
  BRAND_SCREENSHOTS_DIR,
  brandRunPath,
  createBrandExtractionStorage,
} from './storage'
import { rasterizeSvgMarkupToPng } from './svg-raster'

const logger = createSubLogger('brand-extraction:crawl')

// Realistic UA so cloudflare/bot-walls don't block us.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

const MAX_PAGES = 10
const SCREENSHOT_PAGES = 3
const PAGE_GOTO_TIMEOUT_MS = 30_000
const NETWORK_IDLE_TIMEOUT_MS = 8_000
const SCREENSHOT_TIMEOUT_MS = 15_000
const SITEMAP_FETCH_TIMEOUT_MS = 10_000
const ASSET_FETCH_TIMEOUT_MS = 10_000

// Asset-staging caps. Bound the storage write cost per extraction. With
// header/footer-scoped logo extraction and per-filter rejects layered in,
// these are pure fail-safes - a real brand rarely fills more than half.
// Asset filtering is heuristic-only, with no LLM.
const MAX_LOGO_CANDIDATES = 6
const MAX_PRODUCT_CANDIDATES = 10
const MAX_FONT_CANDIDATES = 8
// Lowered from 300 because a 200x200 product thumb is real content; the
// aspect-ratio + sprite-URL filters catch the noise the high floor used to.
const MIN_PRODUCT_DIM_PX = 100
const MAX_PRODUCT_DIM_PX = 4000
const MIN_ASSET_BYTES = 2_048
const TRACKING_DOMAIN_RE =
  /google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|hotjar|segment|mixpanel|optimizely|amplitude/i
const SPRITE_PATH_RE =
  /\b(sprite|spacer|tracking|pixel|beacon|placeholder|skeleton|chevron|caret|arrow-)/i
const FONT_URL_RE = /\.(woff2?|otf|ttf)(\?|$)/i

export interface BrandPageScrape extends PageScrapeResult {
  slug: string
  url: string
}

export interface BrandRawScrape {
  fontUrlsSeen: string[]
  origin: string
  pages: BrandPageScrape[]
  rootUrl: string
}

export interface CrawlBrandSiteActivityParams {
  projectId: string
  runId: string
  url: string
  userEmail?: string
  userId: string
}

export interface CrawlBrandSiteActivityResult {
  screenshotUris: string[]
  stagedAssetCandidates: StagedAssetCandidates
}

export type CrawlFailureKind = 'crawl_blocked' | 'crawl_timeout' | 'internal_error' | 'invalid_url'

export interface StagedAssetCandidates {
  character: StagedAssetRef[]
  logo: StagedAssetRef[]
  product: StagedAssetRef[]
}

interface RunCrawlParams {
  projectId: string
  rootUrl: string
  runId: string
}

interface StageContext {
  context: BrowserContext
  extracted: PageScrapeResult
  runId: string
  slug: string
  stagedHashes: Set<string>
  stagedNormalizedUrls: Set<string>
  storage: ReturnType<typeof createBrandExtractionStorage>
}

export class CrawlBrandSiteError extends Error {
  constructor(
    public readonly kind: CrawlFailureKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'CrawlBrandSiteError'
  }
}

export async function crawlBrandSiteActivity(
  params: CrawlBrandSiteActivityParams,
): Promise<CrawlBrandSiteActivityResult> {
  const { runId, projectId, userId, userEmail, url } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      logger.info(`[brand-extraction] crawl start runId=${runId} url=${url}`)
      let validated: URL
      try {
        validated = validateOutboundUrl(url)
      } catch (err) {
        const cause = ensureError(err)
        throw new CrawlBrandSiteError('invalid_url', cause.message, cause)
      }
      try {
        const result = await runCrawl({ projectId, rootUrl: validated.toString(), runId })
        logger.info(
          `[brand-extraction] crawl done runId=${runId} screenshots=${result.screenshotUris.length}`,
        )
        return result
      } catch (err) {
        if (err instanceof CrawlBrandSiteError) {
          throw err
        }
        const cause = ensureError(err)
        throw classifyCrawlError(cause)
      }
    }),
  )
}

async function capturePageScreenshot(params: {
  page: Page
  runId: string
  slug: string
  storage: ReturnType<typeof createBrandExtractionStorage>
}): Promise<null | string> {
  const { page, runId, slug, storage } = params
  try {
    const buffer = await page.screenshot({
      fullPage: false,
      quality: 70,
      timeout: SCREENSHOT_TIMEOUT_MS,
      type: 'jpeg',
    })
    const relPath = brandRunPath(runId, `${BRAND_SCREENSHOTS_DIR}/${slug}.jpg`)
    await storage.writeFile(relPath, buffer)
    return storage.getFullPath(relPath)
  } catch (err) {
    logger.warn(
      `[brand-extraction] screenshot skipped slug=${slug} err=${ensureError(err).message}`,
    )
    return null
  }
}

/**
 * Map a scraped logo to the picker-UI metadata. The header + home-link
 * combination is the only case strong enough to commit to
 * `primary_brand_mark`; everything else (footer wordmark, dark/light variants,
 * sub-brand marks) stays null so the picker can group it under "Other logos".
 */
function classifyLogo(logo: PageScrapeResult['logos'][number]): {
  category: null | StagedAssetCategory
  description: null | string
} {
  if (logo.type === 'favicon') {
    return { category: 'favicon', description: 'Favicon' }
  }
  if (logo.type === 'og-image') {
    return { category: 'og_image', description: 'OG share image' }
  }
  const alt = (logo.alt ?? '').trim()
  const isPrimary = logo.location === 'header' && logo.inHomeLink
  if (alt) {
    return { category: isPrimary ? 'primary_brand_mark' : null, description: alt }
  }
  if (logo.location === 'header') {
    return {
      category: isPrimary ? 'primary_brand_mark' : null,
      description: 'Header brand mark',
    }
  }
  if (logo.location === 'footer') {
    return { category: null, description: 'Footer brand mark' }
  }
  return { category: null, description: null }
}

async function runCrawl(params: RunCrawlParams): Promise<CrawlBrandSiteActivityResult> {
  const { rootUrl, projectId, runId } = params
  const origin = new URL(rootUrl).origin

  const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] || undefined

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath,
    headless: true,
  })
  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { height: 800, width: 1280 },
    })

    const fetchSitemap = async (sitemapUrl: string): Promise<null | string> => {
      try {
        const response = await context.request.get(sitemapUrl, {
          timeout: SITEMAP_FETCH_TIMEOUT_MS,
        })
        if (!response.ok()) {
          return null
        }
        return await response.text()
      } catch {
        return null
      }
    }

    const sitemapPicks = await collectSitemapPages(
      fetchSitemap,
      [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`],
      origin,
    )

    let navPicks: string[] = []
    {
      const navPage = await context.newPage()
      try {
        await navPage.goto(rootUrl, {
          timeout: PAGE_GOTO_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        })
        await navPage
          .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
          .catch(() => undefined)
        navPicks = await navPage.evaluate<string[]>(navDiscoverySource(origin))
      } catch (err) {
        // Nav-DOM failure shouldn't kill the run; the per-page loop below
        // will hit the same homepage and surface the real error there if
        // the site is fully unreachable.
        logger.warn(
          `[brand-extraction] nav discovery failed url=${rootUrl} err=${ensureError(err).message}`,
        )
      } finally {
        await navPage.close().catch(() => undefined)
      }
    }

    const merged = rankDiscoveredUrls([...sitemapPicks, ...navPicks], origin)
    const picked = merged.slice(0, MAX_PAGES - 1)
    const pageList = [rootUrl, ...picked]
    logger.info(
      `[brand-extraction] discovery sitemap=${sitemapPicks.length} nav=${navPicks.length} merged=${merged.length} crawling=${pageList.length}`,
    )

    const fontUrlsSeen = new Set<string>()
    const pages: BrandPageScrape[] = []
    const screenshotUris: string[] = []
    const stagedLogos: StagedAssetRef[] = []
    const stagedProducts: StagedAssetRef[] = []
    // Content-hash dedup: same logo inlined on every page, same hero CDN'd at
    // multiple URLs, etc. Without this, a site's inline-SVG header logo would
    // stage once per page.
    const stagedHashes = new Set<string>()
    // URL-norm dedup (case-insensitive, query+fragment stripped) -- runs
    // BEFORE the network fetch to skip CDN variants like image.png?v=2.
    const stagedNormalizedUrls = new Set<string>()
    let stagedFontCount = 0
    const storage = createBrandExtractionStorage(projectId)

    for (let i = 0; i < pageList.length; i++) {
      const pageUrl = pageList[i]
      const slug = slugForUrl(pageUrl, rootUrl, i)
      const page = await context.newPage()
      page.on('response', (r) => {
        const u = r.url()
        if (FONT_URL_RE.test(u)) {
          fontUrlsSeen.add(u.split('?')[0] ?? u)
        }
      })
      try {
        await page.goto(pageUrl, {
          timeout: PAGE_GOTO_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        })
        await page
          .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
          .catch(() => undefined)
        await page.evaluate(SCROLL_SCRIPT).catch(() => undefined)

        const screenshotUri =
          i < SCREENSHOT_PAGES ? await capturePageScreenshot({ page, runId, slug, storage }) : null
        if (screenshotUri) {
          screenshotUris.push(screenshotUri)
        }

        const extracted = await page.evaluate<PageScrapeResult>(PAGE_SCRAPE_SOURCE)
        pages.push({ slug, url: pageUrl, ...extracted })

        // Stage logo + product binaries to storage so the Brand Brief card can
        // render them without re-fetching from the source site (which may be
        // bot-walled by then). Bounded per-extraction by the caps above.
        await stageLogoCandidates({
          context,
          extracted,
          slug,
          stagedHashes,
          stagedLogos,
          stagedNormalizedUrls,
          storage,
          runId,
        })
        await stageProductCandidates({
          context,
          extracted,
          slug,
          stagedHashes,
          stagedNormalizedUrls,
          stagedProducts,
          storage,
          runId,
        })
      } catch (err) {
        // One page failing shouldn't kill the whole crawl. Log and continue;
        // synthesis can still work with whatever pages did succeed.
        logger.warn(
          `[brand-extraction] page failed slug=${slug} url=${pageUrl} err=${ensureError(err).message}`,
        )
      } finally {
        await page.close().catch(() => undefined)
      }
    }

    if (pages.length === 0) {
      throw new CrawlBrandSiteError(
        'crawl_blocked',
        `crawler harvested zero pages from ${rootUrl}; site likely blocked the bot`,
      )
    }

    sortLogosByPriority(stagedLogos)

    // Fonts are not part of `stagedAssetCandidates` (the card's manifest covers
    // logo/product/character only) but live in storage for the bucket reviewer
    // and any future card section. Drain the response-listener set here.
    stagedFontCount = await stageFontCandidates({
      context,
      fontUrls: [...fontUrlsSeen],
      runId,
      stagedHashes,
      storage,
    })

    const rawScrape: BrandRawScrape = {
      fontUrlsSeen: [...fontUrlsSeen],
      origin,
      pages,
      rootUrl,
    }
    await storage.writeJsonFile(brandRunPath(runId, `${BRAND_RAW_DIR}/scrape.json`), rawScrape)

    logger.info(
      `[brand-extraction] staged-assets pages=${pages.length} logos=${stagedLogos.length} products=${stagedProducts.length} fonts=${String(stagedFontCount)}`,
    )
    return {
      screenshotUris,
      // `character` stays empty - distinguishing a person/character from a
      // generic product image needs LLM classification, which happens later.
      stagedAssetCandidates: { character: [], logo: stagedLogos, product: stagedProducts },
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function stageLogoCandidates(
  params: StageContext & { stagedLogos: StagedAssetRef[] },
): Promise<void> {
  const { extracted, stagedLogos } = params
  if (stagedLogos.length >= MAX_LOGO_CANDIDATES) {
    return
  }
  for (const logo of extracted.logos) {
    if (stagedLogos.length >= MAX_LOGO_CANDIDATES) {
      break
    }
    const ref = await stageOneLogo(logo, params)
    if (ref) {
      stagedLogos.push(ref)
    }
  }
}

async function stageOneLogo(
  logo: PageScrapeResult['logos'][number],
  params: StageContext,
): Promise<null | StagedAssetRef> {
  const { context, slug, stagedHashes, stagedNormalizedUrls, storage, runId } = params
  if (logo.type === 'inline-svg' && logo.html) {
    // Inline SVG is the canonical logo on most modern SaaS sites
    // (vercel.com, anthropic.com, ...). Markup is already in
    // scrape.json - just write it as a .svg file. No re-fetch.
    // Inline SVG only ever has header/footer location from the JS scan;
    // narrow the type for the helper.
    const svgLocation: 'footer' | 'header' = logo.location === 'footer' ? 'footer' : 'header'
    return stageInlineSvgLogo({
      location: svgLocation,
      markup: logo.html,
      runId,
      slug,
      stagedHashes,
      storage,
    })
  }
  if (logo.type !== 'img' && logo.type !== 'favicon' && logo.type !== 'og-image') {
    return null
  }
  if (!logo.src) {
    return null
  }
  // Tracking-domain reject: don't follow GA / GTM / Hotjar pixel URLs
  // that occasionally surface as `<img>` decoys.
  if (TRACKING_DOMAIN_RE.test(logo.src)) {
    return null
  }
  if (logo.src.startsWith('data:')) {
    return null
  }
  // Drop .ico (and any other unknown extension) at the source. The
  // describe-staged-assets pass would otherwise hand these to OpenAI as
  // image inputs and OpenAI 400s the entire batch on unsupported MIME --
  // poisoning the describe pass for ALL refs, not just this one. Favicons
  // are also poor brand logos (square, low-res) so the bank loses nothing.
  // Use the URL-aware variant so CDN URLs with cache-busters / transforms
  // (?v=123, ?w=400, signed URLs) infer from the path extension, not the
  // query-string-polluted final segment.
  if (inferContentTypeFromSourceUrl(logo.src) === FALLBACK_MIME) {
    return null
  }
  const { category, description } = classifyLogo(logo)
  return downloadAndStageAsset({
    assetKind: 'logo',
    category,
    context,
    description,
    destDir: BRAND_LOGOS_DIR,
    height: logo.height ?? null,
    inHomeLink: logo.inHomeLink ?? false,
    location: logo.location ?? null,
    runId,
    slug,
    sourceUrl: logo.src,
    stagedHashes,
    stagedNormalizedUrls,
    storage,
    width: logo.width ?? null,
  })
}

async function stageProductCandidates(
  params: StageContext & { stagedProducts: StagedAssetRef[] },
): Promise<void> {
  const {
    context,
    extracted,
    slug,
    stagedHashes,
    stagedNormalizedUrls,
    stagedProducts,
    storage,
    runId,
  } = params
  if (stagedProducts.length >= MAX_PRODUCT_CANDIDATES) {
    return
  }
  const candidates = extracted.images
    .filter((img) => isProductCandidate(img))
    .sort((a, b) => Number(b.isHero) - Number(a.isHero))

  for (const img of candidates) {
    if (stagedProducts.length >= MAX_PRODUCT_CANDIDATES) {
      break
    }
    // Same MIME guard as stageOneLogo: skip extensions that infer to
    // application/octet-stream so describe-staged-assets doesn't 400.
    if (inferContentTypeFromSourceUrl(img.src) === FALLBACK_MIME) {
      continue
    }
    const alt = (img.alt ?? '').trim()
    const ref = await downloadAndStageAsset({
      assetKind: 'product',
      category: img.isHero ? 'hero' : null,
      context,
      description: alt || (img.isHero ? 'Hero image' : null),
      destDir: BRAND_IMAGES_DIR,
      height: img.height || null,
      runId,
      slug,
      sourceUrl: img.src,
      stagedHashes,
      stagedNormalizedUrls,
      storage,
      width: img.width || null,
    })
    if (ref) {
      stagedProducts.push(ref)
    }
  }
}

/**
 * Product image filters: a deterministic gate before we pay
 * the network cost. URL- and content-hash dedup happen further down in the
 * staging path; this only handles dimension / aspect / class / URL signals.
 */
interface StageFontParams {
  context: BrowserContext
  fontUrls: string[]
  runId: string
  stagedHashes: Set<string>
  storage: ReturnType<typeof createBrandExtractionStorage>
}

async function downloadAndStageAsset(params: {
  assetKind: 'logo' | 'product'
  category?: null | StagedAssetRef['category']
  context: BrowserContext
  description?: null | string
  destDir: string
  height?: null | number
  inHomeLink?: boolean
  location?: null | StagedAssetRef['location']
  runId: string
  slug: string
  sourceUrl: string
  stagedHashes: Set<string>
  stagedNormalizedUrls: Set<string>
  storage: ReturnType<typeof createBrandExtractionStorage>
  width?: null | number
}): Promise<null | StagedAssetRef> {
  const { sourceUrl, stagedHashes, stagedNormalizedUrls } = params
  if (!sourceUrl) {
    return null
  }
  // URL-norm dedup BEFORE the network fetch. Catches CDN variants
  // (?v=2, ?w=400&q=75) without paying the download cost.
  const normalizedUrl = normalizeUrlForDedupe(sourceUrl)
  if (stagedNormalizedUrls.has(normalizedUrl)) {
    return null
  }
  stagedNormalizedUrls.add(normalizedUrl)
  try {
    // Image proxies (Next.js /_next/image, ...) serve a variant downscaled to
    // the rendered size, which for a small logo lands under MIN_ASSET_BYTES and
    // gets dropped below. Prefer the full-res original; fall back to the proxy
    // URL when the original isn't directly fetchable.
    const originalUrl = resolveProxiedImageUrl(sourceUrl)
    let fetchedUrl = originalUrl ?? sourceUrl
    let response = await params.context.request.get(fetchedUrl, {
      timeout: ASSET_FETCH_TIMEOUT_MS,
    })
    if (!response.ok() && originalUrl) {
      fetchedUrl = sourceUrl
      response = await params.context.request.get(sourceUrl, {
        timeout: ASSET_FETCH_TIMEOUT_MS,
      })
    }
    if (!response.ok()) {
      return null
    }
    const buffer = await response.body()
    // Guess the extension up front so the size floor can exempt SVG.
    let ext = guessExtension(fetchedUrl, response.headers()['content-type']) ?? 'bin'
    // 1x1 / tiny tracking beacons. Spec floor is 2KB. Skip it for SVG: vector
    // markup is compact (a full brand logo is often <2KB) and is rasterized to
    // PNG below, where the floor is re-applied to the rendered bytes. Without
    // this, a real <2KB favicon/logo SVG is dropped as if it were a pixel and
    // the brand ends up logo-less.
    if (ext !== 'svg' && buffer.length < MIN_ASSET_BYTES) {
      return null
    }
    // Content-hash dedup: identical assets at different URLs (CDN variants,
    // /logo.svg vs /logo-v2.svg, same image inlined on every page) collapse
    // to one file. Hash the original bytes so the dedup key stays stable
    // even when the file we write out is rasterized.
    const hash = createHash('md5').update(buffer).digest('hex').slice(0, 12)
    if (stagedHashes.has(hash)) {
      return null
    }
    stagedHashes.add(hash)
    // Rasterize SVG before writing so downstream describe-staged-assets,
    // Phase A multimodal Plan, and Phase B prompt-spec all see PNG bytes.
    // SVG -> Gemini/OpenAI = 400 INVALID_ARGUMENT, which forces those phases
    // into text-only fallback and produces generic "a brand mark" prompts
    // that hallucinate the logo at Phase C.
    let outBuffer = buffer
    if (ext === 'svg') {
      const rasterized = await rasterizeSvgMarkupToPng(buffer, `url=${sourceUrl}`)
      if (!rasterized) {
        return null
      }
      outBuffer = rasterized
      ext = 'png'
      // Re-apply the size floor to the rendered PNG so a degenerate SVG that
      // rasterizes to near-nothing is still dropped.
      if (outBuffer.length < MIN_ASSET_BYTES) {
        return null
      }
    } else if (isDecodableRasterImage(buffer)) {
      // Valid bytes are not automatically readable bytes: AVIF clears both the
      // Content-Type map and the magic-byte check above, then 400s every vision
      // LLM that is handed it. Coerce to a format the providers decode, and
      // stamp the extension from the real bytes so a mislabelled body (WebP
      // served as image/avif) stops advertising a MIME it isn't.
      const normalized = await normalizeStagedRasterForLlm(buffer, ext, `url=${sourceUrl}`)
      outBuffer = normalized.buffer
      ext = normalized.ext
    } else {
      // The body isn't a real image (e.g. an HTML soft-404 page served for a
      // `/logo.png` URL). guessExtension trusts the URL suffix, so these slip
      // through as `.png`/`.jpg`, clear the downstream multimodal MIME filter,
      // and crash the single multimodal storyboard request. Drop at
      // the source so a corrupt asset never enters the brand bank.
      logger.warn(
        `[brand-extraction] dropping non-image asset kind=${params.assetKind} url=${sourceUrl} ext=${ext} bytes=${buffer.length}`,
      )
      return null
    }
    const fileName = `${params.slug}-${hash}.${ext}`
    const relPath = brandRunPath(params.runId, `${params.destDir}/${fileName}`)
    await params.storage.writeFile(relPath, outBuffer)
    return {
      asset_kind: params.assetKind,
      category: params.category ?? null,
      content_hash: hash,
      description: params.description ?? null,
      height: params.height ?? null,
      in_home_link: params.inHomeLink ?? false,
      location: params.location ?? null,
      provenance: 'crawl',
      size_bytes: outBuffer.length,
      source_url: sourceUrl,
      staging_uri: params.storage.getFullPath(relPath),
      width: params.width ?? null,
    }
  } catch (err) {
    logger.warn(
      `[brand-extraction] asset stage failed kind=${params.assetKind} url=${sourceUrl} err=${ensureError(err).message}`,
    )
    return null
  }
}

function isProductCandidate(img: PageScrapeResult['images'][number]): boolean {
  if (!img.src || img.src.startsWith('data:')) {
    return false
  }
  if (TRACKING_DOMAIN_RE.test(img.src)) {
    return false
  }
  if (SPRITE_PATH_RE.test(img.src)) {
    return false
  }
  // Decorative section-backdrops are not product images. Hero backdrops can
  // legitimately be the product hero (full-bleed app screenshot etc.) - keep
  // those.
  if (img.section === 'background' && !img.isHero) {
    return false
  }
  if (img.width < MIN_PRODUCT_DIM_PX || img.height < MIN_PRODUCT_DIM_PX) {
    return false
  }
  if (img.width > MAX_PRODUCT_DIM_PX || img.height > MAX_PRODUCT_DIM_PX) {
    return false
  }
  // Sprite strips and divider banners.
  if (img.height > 0) {
    const ratio = img.width / img.height
    if (ratio >= 6 || ratio <= 1 / 6) {
      return false
    }
  }
  return true
}

async function stageFontCandidates(params: StageFontParams): Promise<number> {
  const { context, fontUrls, runId, stagedHashes, storage } = params
  let count = 0
  for (const url of fontUrls) {
    if (count >= MAX_FONT_CANDIDATES) {
      break
    }
    try {
      const response = await context.request.get(url, { timeout: ASSET_FETCH_TIMEOUT_MS })
      if (!response.ok()) {
        continue
      }
      const buffer = await response.body()
      if (buffer.length < 256) {
        continue
      }
      const hash = createHash('md5').update(buffer).digest('hex').slice(0, 12)
      if (stagedHashes.has(hash)) {
        continue
      }
      stagedHashes.add(hash)
      const ext = guessFontExtension(url, response.headers()['content-type']) ?? 'woff2'
      const relPath = brandRunPath(runId, `${BRAND_FONTS_DIR}/${hash}.${ext}`)
      await storage.writeFile(relPath, buffer)
      count++
    } catch (err) {
      logger.warn(`[brand-extraction] font stage failed url=${url} err=${ensureError(err).message}`)
    }
  }
  return count
}

async function stageInlineSvgLogo(params: {
  location: 'footer' | 'header'
  markup: string
  runId: string
  slug: string
  stagedHashes: Set<string>
  storage: ReturnType<typeof createBrandExtractionStorage>
}): Promise<null | StagedAssetRef> {
  const markup = params.markup.trim()
  if (markup.length < 32) {
    // Suspiciously small - likely an empty `<svg></svg>` placeholder.
    return null
  }
  const hash = createHash('md5').update(markup).digest('hex').slice(0, 12)
  if (params.stagedHashes.has(hash)) {
    return null
  }
  params.stagedHashes.add(hash)
  // Rasterize inline SVG to PNG upstream so describe-staged-assets + every
  // downstream multimodal phase sees real pixels. SVG bytes 400 every
  // Gemini / OpenAI image call, which forces those phases into text-only
  // fallback -- Phase B's prompt-spec then describes the logo generically
  // ("a brand mark") and Phase C's image gen hallucinates a different
  // mark in its place. Rasterizing here gives Phase A the visual context
  // it needs to write a faithful prompt-spec.
  const rasterized = await rasterizeSvgMarkupToPng(markup, 'inline-svg')
  if (!rasterized) {
    return null
  }
  const fileName = `${params.slug}-svg-${hash}.png`
  const relPath = brandRunPath(params.runId, `${BRAND_LOGOS_DIR}/${fileName}`)
  try {
    await params.storage.writeFile(relPath, rasterized)
  } catch (err) {
    logger.warn(`[brand-extraction] inline-svg logo stage failed err=${ensureError(err).message}`)
    return null
  }
  return {
    asset_kind: 'logo',
    // Inline-SVG can't carry `inHomeLink` (that's an <a> wrapper signal);
    // header-scoped inline SVGs default to a slightly weaker category than
    // home-link-wrapped <img>s.
    category: params.location === 'header' ? 'primary_brand_mark' : null,
    content_hash: hash,
    description:
      params.location === 'header'
        ? 'Header brand mark (rasterized SVG)'
        : 'Footer brand mark (rasterized SVG)',
    height: null,
    in_home_link: false,
    location: params.location,
    provenance: 'crawl',
    size_bytes: rasterized.length,
    source_url: null,
    staging_uri: params.storage.getFullPath(relPath),
    width: null,
  }
}

/**
 * Lowercased, query+fragment stripped form for dedupe. Catches `image.png?v=2`
 * vs `image.png`. Bytewise content-hash is the post-download safety net.
 */
function classifyCrawlError(err: Error): CrawlBrandSiteError {
  const msg = err.message || ''
  if (/Timeout|timed out|timeout/i.test(msg)) {
    return new CrawlBrandSiteError('crawl_timeout', msg, err)
  }
  if (/net::ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_BLOCKED/i.test(msg)) {
    return new CrawlBrandSiteError('crawl_blocked', msg, err)
  }
  return new CrawlBrandSiteError('internal_error', msg, err)
}

function normalizeUrlForDedupe(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host.toLowerCase()}${u.pathname.toLowerCase()}`
  } catch {
    return url.toLowerCase().split('?')[0].split('#')[0]
  }
}

function slugForUrl(url: string, rootUrl: string, index: number): string {
  const fallback = `page-${String(index)}`
  if (url === rootUrl) {
    return 'home'
  }
  let path: string
  try {
    path = new URL(url).pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-z0-9-_/]/gi, '-')
      .replace(/\/+/g, '_')
      .toLowerCase()
  } catch {
    return fallback
  }
  return path ? path.slice(0, 60) : fallback
}

/**
 * Stable sort: canonical brand mark first, then header non-canonical, then
 * footer, then og-image (brand-curated banner), then favicon, then anything
 * else. The picker UI renders top-to-bottom; the user sees the right asset
 * at the top.
 */
function sortLogosByPriority(logos: StagedAssetRef[]): void {
  const score = (l: StagedAssetRef): number => {
    if (l.category === 'primary_brand_mark') {
      return 0
    }
    if (l.location === 'header') {
      return 1
    }
    if (l.location === 'footer') {
      return 2
    }
    if (l.category === 'og_image') {
      return 3
    }
    if (l.category === 'favicon') {
      return 4
    }
    return 5
  }
  logos.sort((a, b) => score(a) - score(b))
}

// The SSRF guard lives in common (agent mode reads reference sites too); exported here as before.
export { validateOutboundUrl }
