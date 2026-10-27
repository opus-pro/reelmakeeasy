/**
 * SSRF guard. Rejects:
 *   - non-HTTPS schemes
 *   - hostnames `localhost`, `0.0.0.0`, IPv6 loopback `::1`
 *   - link-local (`169.254.*`, includes cloud metadata `169.254.169.254`)
 *   - RFC1918 (`10.*`, `172.16-31.*`, `192.168.*`, `127.*`)
 *   - IPv6 ULA `fc00::/7` and link-local `fe80::/10`
 *
 * Hostname-only check at this stage. Playwright's own DNS resolution will
 * follow redirects, so the guard is best-effort against direct attacks.
 */
export function validateOutboundUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`invalid url: ${rawUrl}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`only https:// is allowed (got ${url.protocol})`)
  }
  // URL.hostname preserves brackets for IPv6 literals (e.g. `[fc00::1]`).
  // Strip them so the prefix-match below sees the bare address.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') {
    throw new Error(`blocked hostname: ${host}`)
  }
  if (isPrivateIpv4(host)) {
    throw new Error(`blocked RFC1918 / link-local IPv4: ${host}`)
  }
  if (isPrivateIpv6(host)) {
    throw new Error(`blocked private IPv6: ${host}`)
  }
  return url
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) {
    return false
  }
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10) {
    return true
  }
  if (a === 127) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  return false
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase()
  if (h.startsWith('fc') || h.startsWith('fd')) {
    return true
  }
  if (h.startsWith('fe80:') || h.startsWith('fe8') || h.startsWith('fe9')) {
    return true
  }
  if (h.startsWith('fea') || h.startsWith('feb')) {
    return true
  }
  return false
}
