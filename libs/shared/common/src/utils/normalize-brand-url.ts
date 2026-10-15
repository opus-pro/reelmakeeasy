/**
 * Normalize a user-entered brand website URL so a scheme-less bare domain
 * (`example.com`, `www.example.co.za`, `x.com/path`) reaches the crawl activity as a
 * parseable https URL. Users routinely paste bare domains; nothing downstream
 * prepends a scheme, so `validateOutboundUrl`'s `new URL()` threw `invalid url`
 * and the extraction never started.
 *
 * Rules:
 *   - `http://` prefix -> upgraded to `https://` (`validateOutboundUrl` is https-only).
 *   - `https://` prefix -> left untouched.
 *   - any other explicit scheme (`ftp:`, `javascript:`, `data:`, `mailto:`, with
 *     or without `//`) -> left untouched, so the strict downstream https-only
 *     SSRF guard rejects it. We never coerce a non-web scheme into https: e.g.
 *     `javascript:alert@x.com` must NOT become `https://javascript:alert@x.com`
 *     (which would parse as host `x.com` and slip past the guard).
 *   - scheme-less input whose host label contains a dot (`example.com`, `www.x.com`,
 *     `x.com/path`, and the ambiguous `host:port` form `example.com:8080`)
 *     -> `https://` prepended.
 *   - a scheme-less bare single label (`nike`, `asdf`) -> left untouched. It is
 *     `new URL()`-parseable as a host once a scheme is prepended, so prepending
 *     would start a real crawl against a single-label / internal-DNS name; we
 *     leave it so the downstream guard rejects it immediately as before.
 *
 * This only makes a valid-but-scheme-less domain crawlable; genuinely malformed
 * input (`not a url`) still fails validation downstream, by design.
 */
export function normalizeBrandUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return trimmed
  }
  if (/^http:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://')
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed
  }
  // A bare `host:port` (`example.com:8080`) shares the `token:` shape of an
  // explicit scheme; treat a numeric segment after the first colon as a port so
  // it still gets a scheme, and leave any real non-web scheme for the guard.
  const looksLikeHostPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(trimmed)
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  if (hasExplicitScheme && !looksLikeHostPort) {
    return trimmed
  }
  // Only default to https for input that looks like a real domain: the host
  // label (authority before any path / port) must contain a dot. A bare single
  // label would otherwise become a crawlable `https://nike`.
  const host = trimmed.split(/[/?#]/, 1)[0] ?? trimmed
  if (!host.includes('.')) {
    return trimmed
  }
  return `https://${trimmed}`
}
