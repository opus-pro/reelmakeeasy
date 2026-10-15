import { filesBaseUrl } from '@reelmakeeasy/common/storage/address'

import { applyPatch } from '../patch-apply/patch-apply'
import type { Message, SessionState } from '../types'

const SCHEME_URL_RE = /https?:\/\/[^\s<>"')]+/i
// Bare domain like "northwindweekly.com" or "acme-crm.io/pricing": dot-separated
// labels ending in a 2+ letter TLD, with an optional path. ASCII only.
const BARE_DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"')]*)?/i
// A bare-domain match (no scheme) counts as a URL only when its final label is
// a TLD real users paste. Without this, prose tokens missing the
// space after a sentence period ("sure.like", "fire.his") and filenames
// ("riser.wav", "05.png", "node.js") read as domains -- they made up a large
// share of article-routed candidates and most of the extraction fetch_blocked
// failures. Rare-but-real TLDs are still
// reachable by pasting the URL with its scheme, which bypasses this list.
const BARE_DOMAIN_TLD_ALLOWLIST = new Set([
  'ae',
  'agency',
  'ai',
  'app',
  'ar',
  'at',
  'au',
  'be',
  'bg',
  'biz',
  'blog',
  'br',
  'ca',
  'cc',
  'ch',
  'cl',
  'cloud',
  'club',
  'cn',
  'co',
  'com',
  'cz',
  'de',
  'dev',
  'digital',
  'dk',
  'edu',
  'ee',
  'es',
  'fi',
  'finance',
  'fm',
  'fr',
  'fun',
  'gg',
  'gov',
  'gr',
  'hk',
  'hr',
  'hu',
  'id',
  'ie',
  'il',
  'in',
  'info',
  'io',
  'is',
  'it',
  'jp',
  'kr',
  'life',
  'live',
  'lt',
  'lu',
  'lv',
  'ly',
  'me',
  'media',
  'mil',
  'mx',
  'my',
  'net',
  'news',
  'nl',
  'no',
  'nz',
  'online',
  'org',
  'pe',
  'ph',
  'pl',
  'pro',
  'pt',
  'ro',
  'rs',
  'ru',
  'sa',
  'se',
  'sg',
  'shop',
  'site',
  'sk',
  'so',
  'store',
  'studio',
  'tech',
  'th',
  'to',
  'tr',
  'tv',
  'tw',
  'ua',
  'uk',
  'us',
  'vn',
  'world',
  'xyz',
  'za',
])
// Hosts where neither extraction door applies, scheme or not:
// video/social platforms (a pasted YouTube/TikTok link is a repurposing ask,
// not an article to ground on or a brand site to crawl -- 125 YouTube links
// hit the router in the first 3 GA days). x.com/twitter.com stay VALID:
// tweets are a designed article source. This app's own pages (a pasted project
// link) are on the loopback hosts.
const EXCLUDED_URL_HOSTS = new Set([
  '127.0.0.1',
  '[::1]',
  'fb.watch',
  'localhost',
  'suno.com',
  'wa.me',
  'youtu.be',
])
const EXCLUDED_URL_HOST_SUFFIXES = [
  'facebook.com',
  'instagram.com',
  'spotify.com',
  'tiktok.com',
  'whatsapp.com',
  'youtube.com',
]
// Inline asset markup the FE embeds for uploads, e.g.
// "@img[gymshark.png](asset-123|http://localhost:5017/api/files/.../gymshark.png)", saved as
// "@img[gymshark.png](asset-123|store://.../gymshark.png)".
// The pipe-delimited href is the uploaded asset's own stored file, not a
// brand site, so strip these tokens before URL detection. Without this an
// upload-only message triggers extraction against the file storage URL.
//
// The inner pattern allows one level of balanced parens so CDN URLs that
// embed the original video filename (e.g. "My-Song (1).mp4") don't cause
// an early match termination that leaves the brand URL visible.
const ASSET_META_TAG_RE =
  /@(?:vo|img|video|audio|txt|pdf|file|shot)\[[^\]]*\]\((?:[^()\r\n]|\([^)\r\n]*\))+\)/giu
// Where this app serves stored files. An uploaded file's own URL lives here; a
// user's brand site never does. We strip these before URL detection so an
// upload-only message can't trigger extraction against our own storage --
// whether the asset rides in an @audio[..](url) meta tag, a bare [name](url)
// markdown link (which the editor emits when the @-tag prefix is lost), or a raw
// URL. Matching by location is robust to that FE markup drift, which the
// meta-tag strip alone is not.
const STORED_FILE_URL_PREFIX = filesBaseUrl().replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
// `[label](stored-file-url)` markdown link: strip label+href together. Stripping
// only the href would leave a filename label like "My-Song.mp3", which is
// itself a bare-domain false positive ("My-Song.mp").
const STORED_FILE_LINK_RE = new RegExp(
  String.raw`\[[^\]]*\]\(` + STORED_FILE_URL_PREFIX + String.raw`\/[^)\r\n]*\)`,
  'giu',
)
// Raw stored-file URL, not wrapped in markdown.
const STORED_FILE_URL_RE = new RegExp(STORED_FILE_URL_PREFIX + String.raw`\/[^\s<>"')]*`, 'giu')
// A saved message names an upload by its address (`store://<key>`, `preset://<key>`), in a
// `[label](address)` link or bare: strip those the same way.
const STORED_ADDRESS_LINK_RE = /\[[^\]]*\]\((?:store|preset):\/\/[^)\r\n]*\)/giu
const STORED_ADDRESS_RE = /(?:store|preset):\/\/[^\s<>"')]*/giu

/**
 * The first promoted-business URL in the user's messages, with asset meta-tags
 * and stored-file URLs stripped (so uploads can't trigger extraction).
 * Exported for the v2 arm's auto-start activity;
 * maybeAutoStartBrandExtractionFromPrompt uses it internally for v1.
 */
export function detectBrandAutoStartUrl(transcript: Message[]): null | string {
  for (const message of transcript) {
    if (message.role !== 'user') {
      continue
    }
    const found = detectFirstUrlInText(message.content)
    if (found) {
      return found
    }
  }
  return null
}

/**
 * Strip inline asset markup and stored-file URLs from a message, so an
 * uploaded file's own filename or URL never reads as a brand mention.
 * Shared by the URL detection below and the API-side saved-brief name matcher
 * (an audio upload named after an artist must not match a saved brand).
 */
export function stripAssetMarkup(text: string): string {
  return text
    .replace(ASSET_META_TAG_RE, ' ')
    .replace(STORED_FILE_LINK_RE, ' ')
    .replace(STORED_FILE_URL_RE, ' ')
    .replace(STORED_ADDRESS_LINK_RE, ' ')
    .replace(STORED_ADDRESS_RE, ' ')
}

/**
 * First brand-candidate URL in a single text, with the same asset-markup and
 * stored-file stripping as the extraction auto-start (an uploaded file's own
 * URL or filename must never read as a brand site). Shared with the
 * API-side saved-brief matcher so both detect identically.
 */
export function detectFirstUrlInText(text: string): null | string {
  const content = stripAssetMarkup(text)
  const first = urlCandidatesInTextOrder(content).find((c) =>
    isViableUrlCandidate(c.value, c.hasScheme),
  )
  return first?.value ?? null
}

/**
 * Every brand-candidate URL in a text, same stripping as above. For noisy ASR
 * transcripts the first token is not authoritative -- a run-on artifact like
 * "today.Take" reads as a bare domain and would shadow the real spoken domain
 * later in the speech -- so the transcript matcher checks all candidates.
 */
export function detectAllUrlsInText(text: string): string[] {
  const content = stripAssetMarkup(text)
  return urlCandidatesInTextOrder(content)
    .filter((c) => isViableUrlCandidate(c.value, c.hasScheme))
    .map((c) => c.value)
}

/**
 * Host of a candidate match, or null when it cannot parse as a URL. The
 * scheme is defaulted so bare-domain matches parse; a trailing dot (regex
 * artifact when the domain ends a sentence) is trimmed.
 */
function candidateHost(candidate: string): null | string {
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  try {
    return new URL(withScheme).hostname.replace(/\.$/, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * True when a regex match should count as a pasted URL. Excluded
 * hosts never count. Bare-domain matches additionally need an allowlisted
 * TLD; an explicit scheme is proof of intent and bypasses the allowlist.
 */
function isViableUrlCandidate(candidate: string, hasScheme: boolean): boolean {
  const host = candidateHost(candidate)
  if (!host) {
    return false
  }
  if (
    EXCLUDED_URL_HOSTS.has(host) ||
    EXCLUDED_URL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  ) {
    return false
  }
  if (!hasScheme) {
    const tld = host.split('.').pop() ?? ''
    return BARE_DOMAIN_TLD_ALLOWLIST.has(tld)
  }
  return true
}

/**
 * Both URL forms as candidates in TEXT ORDER. Order
 * matters because callers take the FIRST viable candidate: scanning every
 * scheme match before any bare-domain match let a reference link outrank the
 * brand domain the user typed first ("promote acme.com using
 * https://bbc.com/news" auto-started extraction against the BBC article).
 * A scheme URL also matches BARE_DOMAIN_RE at a later offset, so bare matches
 * nested inside a scheme match are dropped -- they are the same URL, and
 * keeping them would re-test it under the stricter bare-domain TLD rule.
 */
function urlCandidatesInTextOrder(
  content: string,
): Array<{ hasScheme: boolean; index: number; value: string }> {
  const scheme = [...content.matchAll(new RegExp(SCHEME_URL_RE.source, 'gi'))].map((match) => ({
    hasScheme: true,
    index: match.index ?? 0,
    value: match[0],
  }))
  const bare = [...content.matchAll(new RegExp(BARE_DOMAIN_RE.source, 'gi'))]
    .map((match) => ({ hasScheme: false, index: match.index ?? 0, value: match[0] }))
    .filter((c) => !scheme.some((s) => c.index >= s.index && c.index < s.index + s.value.length))
  return [...scheme, ...bare].sort((a, b) => a.index - b.index)
}

/**
 * Deterministic brand-extraction trigger. The planner LLM reliably
 * classifies brand intent but does not reliably emit the consequent
 * set_brand_extraction_input op, so the runtime owns the trigger: when the
 * brand gate is on, we are still at mode_confirmation, extraction has not
 * started, and a URL is present in the user's messages, set
 * brand_extraction_input from that URL. The workflow's
 * maybeStartBrandExtractionChild then fires the extraction child.
 *
 * Idempotent: once brand_extraction_input is non-null it returns early, so
 * it is safe to call at the top of every planner turn. Returns true only on
 * the turn it sets the input. No user-facing message is appended: the planner
 * loop holds the turn while extraction runs and the FE renders a "Learning
 * about your brand..." status off brand_extraction_status === 'pending'.
 */
export function maybeAutoStartBrandExtractionFromPrompt(session: SessionState): boolean {
  const constraints = session.spec.global_constraints
  if (session.brandExtractionEnabled !== true) {
    return false
  }
  if (session.todo_state.phase !== 'mode_confirmation') {
    return false
  }
  if (constraints.brand_extraction_input != null) {
    return false
  }
  if (constraints.brand_extraction_status != null) {
    return false
  }
  // The user detached an injected saved brief with "remove the brand brief":
  // this session has no brand, so a brand URL still in the prompt
  // must NOT re-trigger extraction. (The sibling "re-extract" op leaves this
  // false precisely so we DO re-fire here.)
  if (constraints.brand_extraction_declined) {
    return false
  }

  const url = detectBrandAutoStartUrl(session.transcript)
  if (url === null) {
    return false
  }

  const result = applyPatch(
    session.spec,
    {
      base_version: session.spec.meta.spec_version,
      diff_summary: 'brand_extraction.auto_input_from_prompt',
      ops: [{ op: 'set_brand_extraction_input', input: { kind: 'url', url } }],
    },
    {
      phase: session.todo_state.phase,
      transitionVideoModel: session.transitionVideoModel,
    },
  )
  if (result.error) {
    return false
  }
  session.spec = result.spec
  return true
}

/**
 * True when the planner should HOLD this turn for a brand-extraction
 * head-start that is in flight: the brand gate is on, we are at
 * mode_confirmation, the input is set, and status is `pending`. In this state
 * the planner has nothing to ask -- it waits for the bank -- so the loop skips
 * the LLM turn entirely and emits no chat message while the FE shows the
 * "Learning about your brand..." status.
 *
 * The hold deliberately does NOT cover the `null` status (the turn the input
 * was just set, before the workflow fires the child and flips status to
 * `pending`). On that turn the planner DOES run, so it can ask the brand-
 * independent convergence question (video length) first; the extraction runs
 * in the background and the hold engages on the next turn once status is
 * `pending`. Once the signal flips status to completed / failed this returns
 * false and the planner runs the grounded brand turn.
 */
export function isHoldingForBrandExtraction(session: SessionState): boolean {
  if (session.brandExtractionEnabled !== true) {
    return false
  }
  if (session.todo_state.phase !== 'mode_confirmation') {
    return false
  }
  const constraints = session.spec.global_constraints
  if (constraints.brand_extraction_input == null) {
    return false
  }
  return constraints.brand_extraction_status === 'pending'
}
