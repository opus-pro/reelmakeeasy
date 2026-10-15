/**
 * Page-discovery primitives for the brand-extraction crawler.
 *
 * Ported from an earlier brand-extraction prototype with:
 *   - no `node:child_process` dependency (the activity drives all network IO
 *     via Playwright + Node fetch),
 *   - a generic `fetchText` injectable in place of a sync `curlText` callback
 *     (the activity passes a Playwright-context fetch helper at call time).
 *
 * The split between mechanical extraction (this file) and semantic
 * classification (synthesis) is intentional.
 */

const NAV_BLACKLIST_SLUGS = [
  'cart',
  'checkout',
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'register',
  'account',
  'my-account',
  'profile',
  'dashboard',
  'search',
  'terms',
  'privacy',
  'cookies?',
  'legal',
  'disclaimer',
  'contact',
  'contact-us',
  'shipping-policy',
  'returns?',
  'refund',
  'accessibility',
  'sitemap',
  'rss',
  'feed',
  'admin',
  'wp-admin',
  'wp-login',
]

export const NAV_BLACKLIST_RE = new RegExp(
  `\\/(${NAV_BLACKLIST_SLUGS.join('|')})(\\/|$|\\?|#)`,
  'i',
)

const NAV_BOOST_SLUGS = [
  'happy',
  'review',
  'testimonial',
  'press',
  'about',
  'story',
  'mission',
  'our-',
  'who-we-are',
  'team',
  'founders?',
  'episodes?',
  'podcast',
  'services?',
  'product',
  'shop',
  'wellness',
  'camp',
  'ranch',
  'blog',
  'journal',
  'careers?',
]

export const NAV_BOOST_RE = new RegExp(`\\/(${NAV_BOOST_SLUGS.join('|')})(s?\\b|\\/|$)`, 'i')

/**
 * JS source string for `page.evaluate(...)` that walks main-nav / header /
 * footer anchors and returns same-origin URLs ranked by keyword boost.
 *
 * Same-origin treats `www.X` and bare `X` as one host. Otherwise a sitemap
 * published under `https://www.example.com/...` while the user submitted
 * `https://example.com/` drops every URL as cross-origin (caught e2e
 * 2026-05-07).
 */
interface SitemapParse {
  indexes: string[]
  pages: string[]
}

/** Strip a leading `www.` so `www.example.com` and `example.com` compare equal. */
export function navDiscoverySource(origin: string): string {
  // The page-side check uses host equality (after stripping www.) instead of
  // the prior `href.startsWith(origin)` because that was string-prefix-based
  // and broke on www. divergence.
  let originHost = ''
  try {
    originHost = new URL(origin).host.toLowerCase().replace(/^www\./, '')
  } catch {
    originHost = ''
  }
  return `
(() => {
  const originHost = ${JSON.stringify(originHost)};
  const blacklist = ${NAV_BLACKLIST_RE.toString()};
  const boost = ${NAV_BOOST_RE.toString()};
  const sameOrigin = (href) => {
    try {
      const h = new URL(href).host.toLowerCase().replace(/^www\\./, '');
      return h === originHost;
    } catch { return false; }
  };
  const anchors = Array.from(
    document.querySelectorAll(
      'nav a[href], header a[href], [role="navigation"] a[href], footer a[href]'
    )
  );
  const seen = new Set();
  const ranked = [];
  for (const a of anchors) {
    const href = a.href;
    if (!href || !sameOrigin(href)) continue;
    if (blacklist.test(href)) continue;
    const norm = href.split('#')[0];
    // Drop anything that's the homepage in either www-form or bare-form.
    let pathOnly = '';
    try { pathOnly = new URL(norm).pathname; } catch {}
    if (pathOnly === '' || pathOnly === '/') continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    const score = boost.test(norm) ? 10 : 0;
    ranked.push({ url: norm, score, order: ranked.length });
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.map((r) => r.url);
})();
`
}

export function parseSitemapLocs(xml: string, origin: string): SitemapParse {
  const locs = Array.from(xml.matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)).map((m) => m[1].trim())
  const pages: string[] = []
  const indexes: string[] = []
  const originHost = (() => {
    try {
      return bareHost(new URL(origin).host)
    } catch {
      return ''
    }
  })()
  for (const raw of locs) {
    if (!raw) {
      continue
    }
    const hashIdx = raw.indexOf('#')
    const url = hashIdx === -1 ? raw : raw.slice(0, hashIdx)
    let urlHost = ''
    try {
      urlHost = bareHost(new URL(url).host)
    } catch {
      continue
    }
    if (urlHost !== originHost) {
      continue
    }
    if (url.toLowerCase().endsWith('.xml')) {
      indexes.push(url)
    } else {
      pages.push(url)
    }
  }
  return { indexes, pages }
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function depthScore(depth: number): number {
  if (depth === 1) {
    return 1000
  }
  if (depth === 2) {
    return 200
  }
  return 0
}

/**
 * Dedupe key: bare-host + lowercased pathname without trailing slash. So
 * `https://example.com/about/`, `https://www.example.com/about`, and
 * `https://EXAMPLE.COM/About` all collapse to one entry.
 */
function normalizeForDedupe(url: string): string {
  try {
    const u = new URL(url)
    const host = bareHost(u.host)
    let path = u.pathname.toLowerCase()
    while (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    return `${host}${path}`
  } catch {
    return url.toLowerCase()
  }
}

function pathDepth(url: string): number {
  let tail = ''
  try {
    tail = new URL(url).pathname
  } catch {
    return 0
  }
  while (tail.startsWith('/')) {
    tail = tail.slice(1)
  }
  while (tail.endsWith('/')) {
    tail = tail.slice(0, -1)
  }
  if (!tail) {
    return 0
  }
  return tail.split('/').length
}

/** True if `url` is the homepage in either www-form or bare-form. */
function isHomepage(url: string): boolean {
  try {
    const u = new URL(url)
    return u.pathname === '' || u.pathname === '/'
  } catch {
    return false
  }
}

/**
 * Drops homepage + blacklisted paths, dedupes (ignoring trailing slash, case,
 * and `www.` prefix), sorts by (path-depth desc, then keyword-boost as
 * tiebreak, then input order).
 */
export function rankDiscoveredUrls(urls: string[], _origin: string): string[] {
  const seen = new Set<string>()
  const ranked: { order: number; score: number; url: string }[] = []
  for (const url of urls) {
    if (isHomepage(url)) {
      continue
    }
    if (NAV_BLACKLIST_RE.test(url)) {
      continue
    }
    const key = normalizeForDedupe(url)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const boost = NAV_BOOST_RE.test(url) ? 5 : 0
    ranked.push({ order: ranked.length, score: depthScore(pathDepth(url)) + boost, url })
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.map((r) => r.url)
}

/**
 * Walks a sitemap tree: fetches roots, follows `.xml` indexes (one queue level,
 * capped at `maxFetches` total fetches), collects non-`.xml` page URLs, then
 * ranks them. `fetchText` returns `null` on failure so a missing
 * `/sitemap_index.xml` doesn't kill the run.
 */
export async function collectSitemapPages(
  fetchText: (url: string) => Promise<null | string>,
  roots: string[],
  origin: string,
  maxFetches = 8,
): Promise<string[]> {
  const visited = new Set<string>()
  const pages: string[] = []
  const queue = [...roots]
  let fetched = 0
  while (queue.length > 0 && fetched < maxFetches) {
    const url = queue.shift()
    if (!url || visited.has(url)) {
      continue
    }
    visited.add(url)
    const body = await fetchText(url)
    fetched++
    if (!body) {
      continue
    }
    const { pages: p, indexes } = parseSitemapLocs(body, origin)
    pages.push(...p)
    for (const idx of indexes) {
      if (!visited.has(idx)) {
        queue.push(idx)
      }
    }
  }
  return rankDiscoveredUrls(pages, origin)
}
