import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost'])
/** Headers a proxy adds. A proxy on this computer (e.g. the web dev server's `/api`
 *  rewrite, which listens on every interface) connects from loopback and rewrites Host,
 *  so its requests look local whoever sent them: refuse anything that was forwarded. */
const FORWARDING_HEADERS = ['forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host']
/** Hostnames of an `Origin` the agent API trusts (`new URL` keeps IPv6 brackets). */
const LOOPBACK_ORIGIN_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost'])

/** True when an `Origin` header value is an http(s) origin on a loopback name, any port.
 *  The opaque origin `null` (sandboxed frames, `file:` pages, some redirects) is not. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOOPBACK_ORIGIN_HOSTNAMES.has(url.hostname)
    )
  } catch {
    return false
  }
}

/** Hostname part of a `Host` header (`localhost:5017`, `[::1]:5017`, `::1`), lower-cased. */
export function hostHeaderHostname(host: string | undefined): string {
  const value = (host ?? '').trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? '' : value.slice(1, end)
  }
  // More than one colon and no brackets: a bare IPv6 literal such as `::1`.
  if (value.split(':').length > 2) return value
  const colon = value.indexOf(':')
  return colon === -1 ? value : value.slice(0, colon)
}

/** True only for a request made directly on this computer to a loopback name, and not
 *  sent by a browser on behalf of another site. */
export function isLoopbackRequest(
  remoteAddress: string | undefined,
  host: string | undefined,
  headers: Record<string, unknown> = {},
): boolean {
  const origin = headers['origin']
  return (
    !FORWARDING_HEADERS.some((name) => headers[name] !== undefined) &&
    headers['sec-fetch-site'] !== 'cross-site' &&
    (origin === undefined || (typeof origin === 'string' && isLoopbackOrigin(origin))) &&
    remoteAddress !== undefined &&
    LOOPBACK_ADDRESSES.has(remoteAddress) &&
    LOOPBACK_HOSTNAMES.has(hostHeaderHostname(host))
  )
}

/**
 * Agent mode starts the user's own Codex and serves files through it, but the
 * API listens on every interface. This guard lets a request through only when
 * it comes from a loopback address (so not from another machine on the
 * network) AND names a loopback host (so not from a web page that rebound its
 * own domain to 127.0.0.1), and was not relayed by a proxy. A browser on this
 * computer also sends "simple" cross-site requests (a form post, a no-cors
 * fetch) straight to localhost, so it must also not be marked
 * `Sec-Fetch-Site: cross-site`, and any `Origin` must be an http(s) loopback
 * origin (`localhost`, `127.0.0.1`, `[::1]`, any port; `null` is refused).
 * A missing `Origin` or `Sec-Fetch-Site` is fine: curl, and same-origin GETs.
 * Everything else gets 403.
 */
@Injectable()
export class LoopbackOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown> & { host?: string }
      socket?: { remoteAddress?: string }
    }>()
    if (isLoopbackRequest(req.socket?.remoteAddress, req.headers?.host, req.headers)) return true
    throw new ForbiddenException('ReelMakeEasy only accepts this request from this computer')
  }
}
