/**
 * Article extraction activity for the News/Article-to-video Story Mode
 * integration (step 2, the preservation kernel).
 *
 * Lifts the proven primitives from the legacy story-loader
 * (libs/agent/src/agents/story-loader/common/article-extraction.ts) --
 * Readability main-text parse + og/twitter/ld+json metadata harvest + key
 * image / publisher logo staging -- into a single activity behind
 * the brand-crawl SSRF guard. Differences from the legacy helper, on purpose:
 *
 *   - Missing key image / logo is NOT fatal (legacy bailed at the first
 *     missing field, fine for a search tool, wrong for a user-pasted primary
 *     source). Only a missing/thin article body fails the run.
 *   - No LLM call: the legacy flash "relevant sentences" summary was
 *     query-driven for news_search. Step 3 grounds the script tools with the
 *     full text artifact instead, so this activity stays deterministic.
 *
 * Runs on the brand-extraction task queue (Playwright lives there); the UIP
 * workflow schedules it cross-queue. Content-level failures return
 * `{ outcome: 'failed', failureKind }` rather than throwing so activity
 * retries are reserved for infra errors.
 */

// DOM lib types for this file only: jsdom + Readability are typed against
// lib.dom's Document, which the node-targeted tsconfig.base ("lib": es2023)
// does not load globally.
/// <reference lib="dom" />

import { createHash } from 'node:crypto'

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { logger } from '@reelmakeeasy/common/logger'
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { type BrowserContext, chromium } from 'playwright'
import sharp from 'sharp'

import { validateOutboundUrl } from '../brand-extraction/crawl-brand-site'
import { guessExtension, isDecodableRasterImage } from '../brand-extraction/extension-utils'
import { normalizeStagedRasterForLlm } from '../brand-extraction/llm-safe-raster'
import { withActivityHeartbeat, withLongTakeContext } from '../long-take/common'

const PAGE_GOTO_TIMEOUT_MS = 30_000
const NETWORK_IDLE_TIMEOUT_MS = 8_000
const IMAGE_FETCH_TIMEOUT_MS = 10_000
// Tracking-pixel floor, same rationale as the brand crawler's MIN_ASSET_BYTES.
const MIN_IMAGE_BYTES = 2_048
// Body-photo filters: drop icons / thumbnails /
// decorative sprites by requiring a real photographic footprint, and cap the
// harvest so a 100-image gallery can't blow up staging cost / activity time.
// "All usable images" == every in-body raster at/above this size, up to the cap.
const MIN_BODY_IMAGE_LONG_EDGE = 400
const MAX_ARTICLE_BODY_IMAGES = 12
// Attempt more candidates than we keep so early junk (tracking pixels, failed
// fetches, sub-floor thumbnails) can't starve the real photos that follow,
// while still bounding fetch cost / activity time. Staged concurrently, so this
// is a fan-out width, not a serial wait.
const MAX_IMAGE_FETCH_ATTEMPTS = 24
// Below this the "article" is a paywall stub, cookie wall, or soft 404 --
// grounding a script on it would fabricate content, which violates the
// factual-accuracy kernel this ticket exists to preserve.
const MIN_ARTICLE_WORDS = 50
const EXCERPT_CHARS = 1_200
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export type ArticleFailureKind =
  | 'fetch_blocked'
  | 'fetch_timeout'
  | 'internal_error'
  | 'invalid_url'
  | 'not_an_article'

export interface ExtractArticleActivityParams {
  projectId: string
  runId: string
  url: string
  userId?: string
}

export interface ExtractArticleActivityResult {
  article?: ExtractedArticle
  failureKind?: ArticleFailureKind
  outcome: 'completed' | 'failed'
}

export interface ExtractedArticle {
  author: null | string
  date: null | string
  /**
   * storage staging URIs of the article's in-body content photos, in document
   * order, EXCLUDING the key image and logo. Empty when
   * the article has no usable body photos. Used as additional anchor
   * candidates so the planner can place different photos across shots.
   */
  image_staging_uris: string[]
  /** storage staging URI of the article's key (og/hero) image; null when absent. */
  key_image_staging_uri: null | string
  /** storage staging URI of the publisher logo / favicon; null when absent. */
  logo_staging_uri: null | string
  site_name: null | string
  /** store path of the full extracted text (article-extract/{runId}/text.txt). */
  text_artifact_path: string
  /** Leading slice of the text for event payloads / prompt context. */
  text_excerpt: string
  title: string
  /** Final URL after redirects. */
  url: string
  word_count: number
}

interface HarvestedMetadata {
  author?: string
  keyImage?: string
  logo?: string
  publishedTime?: string
  siteName?: string
  title?: string
}

interface LdJsonFields {
  author?: string
  image?: string
  logo?: string
  publisher?: string
}

export function articleRunPath(runId: string, relativePath: string): string {
  return `article-extract/${runId}/${relativePath}`
}

export function createArticleExtractionStorage(projectId: string): ProjectStore {
  return new ProjectStore(projectId)
}

export async function extractArticleActivity(
  params: ExtractArticleActivityParams,
): Promise<ExtractArticleActivityResult> {
  const { projectId, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const result = await runGuardedExtraction(params)
      return result
    }),
  )
}

function classifyFetchError(err: Error): ArticleFailureKind {
  const msg = err.message || ''
  if (/Timeout|timed out|timeout/i.test(msg)) {
    return 'fetch_timeout'
  }
  if (/net::ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_BLOCKED/i.test(msg)) {
    return 'fetch_blocked'
  }
  return 'internal_error'
}

async function runGuardedExtraction(
  params: ExtractArticleActivityParams,
): Promise<ExtractArticleActivityResult> {
  const { projectId, runId, url } = params
  try {
    validateOutboundUrl(url)
  } catch (err) {
    logger.warn(`[article-extraction] rejected url project=${projectId} url=${url}: ${err}`)
    return { outcome: 'failed', failureKind: 'invalid_url' }
  }
  // Readability cannot parse PDFs and Playwright downloads them instead of
  // rendering; same short-circuit as the legacy extractor.
  const lower = url.toLowerCase()
  if (lower.endsWith('.pdf') || lower.includes('.pdf?')) {
    return { outcome: 'failed', failureKind: 'not_an_article' }
  }

  try {
    return await runExtraction(params)
  } catch (err) {
    const failureKind = classifyFetchError(err instanceof Error ? err : new Error(String(err)))
    logger.warn(
      `[article-extraction] failed project=${projectId} run=${runId} url=${url} kind=${failureKind}: ${err}`,
    )
    return { outcome: 'failed', failureKind }
  }
}

/**
 * Harvest the article's OWN images from the raw page DOM, in document order
 * ("all available images"). Scoped to the main content root
 * (article > main > body) and deliberately excludes:
 *   - images inside a link that NAVIGATES to another page -- related /
 *     recommended-story cards; a lightbox / full-res image link (href is an
 *     image file, or a non-navigating #/js trigger) is kept, since publishers
 *     wrap genuine article photos that way;
 *   - images inside aside / nav / footer / header -- site chrome, "most read";
 *   - the publisher logo and anything already staged (excludeUrls);
 *   - svg / logo / placeholder / sprite assets by URL.
 * Resolves srcset to its largest candidate and dedupes. Byte / raster /
 * dimension filtering still happens later in stageArticleImage.
 *
 * MUST run before Readability.parse(), which prunes the DOM in place. This
 * reads the raw DOM rather than Readability's cleaned content because
 * Readability strips most images, dropping real article photos.
 */
export function harvestArticleImages(
  document: Document,
  baseUrl: string,
  excludeUrls: string[],
): string[] {
  const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body
  if (!root) {
    return []
  }
  const exclude = new Set(excludeUrls)
  const toAbs = (u: null | string | undefined): string | undefined => {
    if (!u?.trim()) {
      return undefined
    }
    try {
      return new URL(u, baseUrl).toString()
    } catch {
      return undefined
    }
  }
  // Largest srcset candidate (by width descriptor) beats the low-res src.
  const bestFromSrcset = (srcset: null | string): string | undefined => {
    const candidates = (srcset ?? '')
      .split(',')
      .map((part) => {
        const [u, w] = part.trim().split(/\s+/)
        return { url: u, width: w?.endsWith('w') ? Number.parseInt(w, 10) : 0 }
      })
      .filter((c) => c.url)
    candidates.sort((a, b) => b.width - a.width)
    return candidates[0]?.url
  }
  // A link is "just opening this photo" (lightbox / full-res) when its href is
  // an image file or a non-navigating #/js trigger; anything else navigates to
  // another page, i.e. a related-story card wrapping a thumbnail.
  const isContentImageLink = (href: null | string): boolean => {
    const h = (href ?? '').trim()
    if (h === '' || h.startsWith('#') || h.startsWith('javascript:')) {
      return true
    }
    return /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)($|\?|#)/i.test(h)
  }
  const urls: string[] = []
  const seen = new Set<string>()
  for (const img of Array.from(root.querySelectorAll('img'))) {
    // Site chrome (nav / "most read" / footer) is never article content.
    if (img.closest('aside, nav, footer, header')) {
      continue
    }
    // A photo that links to another page is a related-story card; keep it when
    // the link only opens the photo itself (lightbox / full-res).
    const link = img.closest('a')
    if (link && !isContentImageLink(link.getAttribute('href'))) {
      continue
    }
    const abs = toAbs(bestFromSrcset(img.getAttribute('srcset')) ?? img.getAttribute('src'))
    if (!abs || exclude.has(abs) || seen.has(abs)) {
      continue
    }
    // Non-photo assets by URL; real byte / size filtering happens in staging.
    if (/\.svg($|\?)|\/(logo|placeholder|sprite)/i.test(abs)) {
      continue
    }
    seen.add(abs)
    urls.push(abs)
  }
  return urls
}

/** Tolerant ld+json scan: first parseable script with useful fields wins. */
function harvestLdJson(document: Document): LdJsonFields {
  // Array.from: NodeList iteration needs lib dom.iterable, which the
  // file-scoped dom reference above does not pull in.
  for (const script of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? '')
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        const fields = ldFieldsFromNode(node)
        if (fields.author || fields.image || fields.logo || fields.publisher) {
          return fields
        }
      }
    } catch {
      // Malformed ld+json is routine on news sites; try the next block.
    }
  }
  return {}
}

/**
 * og/twitter/ld+json/favicon harvest, equivalent to the legacy extractor's
 * field priority: key image = og:image > twitter:image > ld+json image;
 * logo = ld+json logo > favicon; author = ld+json author > meta author >
 * ld+json publisher. All URLs resolved against the final page URL.
 */
function harvestMetadata(document: Document, baseUrl: string): HarvestedMetadata {
  const toAbs = (u: null | string | undefined): string | undefined => {
    if (!u) {
      return undefined
    }
    try {
      return new URL(u, baseUrl).toString()
    } catch {
      return undefined
    }
  }
  const metaContent = (selector: string): string | undefined =>
    document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || undefined

  const ld = harvestLdJson(document)
  const favicon = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
  )?.href

  return {
    author: ld.author ?? metaContent('meta[name="author"]') ?? ld.publisher,
    keyImage:
      toAbs(metaContent('meta[property="og:image"]')) ??
      toAbs(metaContent('meta[name="twitter:image"]')) ??
      toAbs(ld.image),
    logo: toAbs(ld.logo) ?? toAbs(favicon),
    publishedTime: metaContent('meta[property="article:published_time"]'),
    siteName: metaContent('meta[property="og:site_name"]') ?? ld.publisher,
    title: metaContent('meta[property="og:title"]') ?? (document.title?.trim() || undefined),
  }
}

function ldFieldsFromNode(node: unknown): LdJsonFields {
  if (typeof node !== 'object' || node === null) {
    return {}
  }
  const obj = node as Record<string, unknown>
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)
  const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const named = (v: unknown): string | undefined => {
    const n = first(v)
    if (typeof n === 'string') {
      return n
    }
    return asString((n as null | Record<string, unknown>)?.['name'])
  }
  const urlOf = (v: unknown): string | undefined => {
    const n = first(v)
    if (typeof n === 'string') {
      return n
    }
    return asString((n as null | Record<string, unknown>)?.['url'])
  }
  const publisherNode = first(obj['publisher']) as null | Record<string, unknown>
  return {
    author: named(obj['author']),
    image: urlOf(obj['image']),
    logo: urlOf(obj['logo']) ?? urlOf(publisherNode?.['logo']),
    publisher: named(obj['publisher']),
  }
}

async function runExtraction(
  params: ExtractArticleActivityParams,
): Promise<ExtractArticleActivityResult> {
  const { projectId, runId, url } = params
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
    const page = await context.newPage()
    await page.goto(url, { timeout: PAGE_GOTO_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
    await page
      .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => undefined)
    const finalUrl = page.url()
    const html = await page.content()

    // Suppress jsdom's noisy CSS/script parse errors -- article pages are
    // arbitrary third-party HTML and the errors are non-actionable here.
    const virtualConsole = new VirtualConsole()
    const dom = new JSDOM(html, { url: finalUrl, virtualConsole })
    // Harvest metadata AND inline images BEFORE Readability: parse() prunes the
    // DOM in place, so the article's own <img> tags must be read from the raw
    // document first ("all available images").
    const meta = harvestMetadata(dom.window.document, finalUrl)
    const inlineImageUrls = harvestArticleImages(
      dom.window.document,
      finalUrl,
      meta.logo ? [meta.logo] : [],
    )
    const article = new Readability(dom.window.document).parse()

    const text = article?.textContent?.trim() ?? ''
    const wordCount = text.length === 0 ? 0 : text.split(/\s+/).length
    if (wordCount < MIN_ARTICLE_WORDS) {
      logger.warn(
        `[article-extraction] no readable body project=${projectId} url=${finalUrl} words=${wordCount}`,
      )
      return { outcome: 'failed', failureKind: 'not_an_article' }
    }

    const storage = createArticleExtractionStorage(projectId)
    const logoUrl = meta.logo
    // Best-effort staging: a lost image degrades the video, a lost article kills
    // it -- so image failures never fail the run.
    const logoUri = logoUrl
      ? await stageArticleImage({ context, kind: 'logo', runId, sourceUrl: logoUrl, storage })
      : null

    // Article photos ("all available images"): stage the article's own
    // inline images and take the FIRST survivor as the hero, in preference to
    // og:image -- on some publishers (e.g. BBC) og:image is a branded social-
    // share card that never appears in the article body. Staged CONCURRENTLY so
    // a photo-rich page cannot serialize past the activity's start-to-close
    // timeout; wall-clock stays near a single IMAGE_FETCH_TIMEOUT_MS. Each stage
    // caps its own fetch and fails soft to null.
    // Attempt up to MAX_IMAGE_FETCH_ATTEMPTS candidates but KEEP only the first
    // (hero + body) USABLE ones, so early junk that fails byte/raster/size
    // validation can't starve the real photos that follow.
    const maxUsableImages = MAX_ARTICLE_BODY_IMAGES + 1
    if (inlineImageUrls.length > MAX_IMAGE_FETCH_ATTEMPTS) {
      logger.info(
        `[article-extraction] article-image harvest capped project=${projectId} found=${inlineImageUrls.length} attempts=${MAX_IMAGE_FETCH_ATTEMPTS}`,
      )
    }
    const stagedInline = await Promise.all(
      inlineImageUrls.slice(0, MAX_IMAGE_FETCH_ATTEMPTS).map((sourceUrl) =>
        stageArticleImage({
          context,
          kind: 'image',
          minLongEdge: MIN_BODY_IMAGE_LONG_EDGE,
          runId,
          sourceUrl,
          storage,
        }),
      ),
    )
    // Keep document order (Promise.all preserves it); drop failures and dupes
    // (same md5 -> same staged URI), then keep only up to hero + body images.
    const usableInline: string[] = []
    const seenUris = new Set<string>()
    for (const uri of stagedInline) {
      if (uri && !seenUris.has(uri)) {
        seenUris.add(uri)
        usableInline.push(uri)
        if (usableInline.length >= maxUsableImages) {
          break
        }
      }
    }
    // Hero = first usable inline photo; fall back to og:image only when the
    // article had no usable inline image at all.
    let keyImageUri: null | string = usableInline[0] ?? null
    if (!keyImageUri && meta.keyImage) {
      keyImageUri = await stageArticleImage({
        context,
        kind: 'key-image',
        runId,
        sourceUrl: meta.keyImage,
        storage,
      })
    }
    // Body photos = the remaining usable inline images after the hero.
    const imageStagingUris =
      keyImageUri && usableInline[0] === keyImageUri ? usableInline.slice(1) : usableInline

    const textPath = articleRunPath(runId, 'text.txt')
    await storage.writeFile(textPath, text)

    const extracted: ExtractedArticle = {
      author: meta.author ?? null,
      date: article?.publishedTime || meta.publishedTime || null,
      image_staging_uris: imageStagingUris,
      key_image_staging_uri: keyImageUri,
      logo_staging_uri: logoUri,
      site_name: meta.siteName ?? null,
      text_artifact_path: textPath,
      text_excerpt: text.slice(0, EXCERPT_CHARS),
      title: article?.title || meta.title || '',
      url: finalUrl,
      word_count: wordCount,
    }
    // Attribution + provenance snapshot next to the text so step-3 consumers
    // (and humans debugging a run) get the whole extraction from one prefix.
    await storage.writeJsonFile(articleRunPath(runId, 'article.json'), extracted)
    return { outcome: 'completed', article: extracted }
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function stageArticleImage(params: {
  context: BrowserContext
  kind: string
  /** When set, reject images whose long edge is below this many px. */
  minLongEdge?: number
  runId: string
  sourceUrl: string
  storage: ProjectStore
}): Promise<null | string> {
  const { context, kind, minLongEdge, runId, sourceUrl, storage } = params
  try {
    const response = await context.request.get(sourceUrl, { timeout: IMAGE_FETCH_TIMEOUT_MS })
    if (!response.ok()) {
      return null
    }
    const buffer = await response.body()
    const ext = guessExtension(sourceUrl, response.headers()['content-type']) ?? 'bin'
    // Same guards as the brand crawler: drop tracking pixels and HTML
    // soft-404s served under an image URL. SVG rasterization is deliberately
    // skipped in v1 -- key images are photographic and a rare SVG publisher
    // logo is simply dropped rather than pulling in the raster pipeline.
    if (buffer.length < MIN_IMAGE_BYTES || ext === 'svg' || !isDecodableRasterImage(buffer)) {
      return null
    }
    // Body photos (minLongEdge set) must clear a real photographic footprint,
    // which drops icons / thumbnails / decorative sprites. The hero image and
    // logo pass minLongEdge=undefined to keep their existing acceptance.
    if (minLongEdge !== undefined) {
      const { height = 0, width = 0 } = await sharp(buffer).metadata()
      if (Math.max(width, height) < minLongEdge) {
        return null
      }
    }
    // Same reason as the brand crawler: an AVIF body clears every guard above
    // and still 400s the vision LLMs these photos are handed to. Hash the
    // original bytes first so the staged filename stays stable across a
    // transcode.
    const hash = createHash('md5').update(buffer).digest('hex').slice(0, 12)
    const normalized = await normalizeStagedRasterForLlm(buffer, ext, `url=${sourceUrl}`)
    const relPath = articleRunPath(runId, `assets/${kind}-${hash}.${normalized.ext}`)
    await storage.writeFile(relPath, normalized.buffer)
    return storage.getFullPath(relPath)
  } catch (err) {
    logger.warn(`[article-extraction] image stage failed kind=${kind} url=${sourceUrl}: ${err}`)
    return null
  }
}
