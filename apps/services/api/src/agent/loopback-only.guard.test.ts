import { type ExecutionContext, ForbiddenException } from '@nestjs/common'

import { hostHeaderHostname, isLoopbackRequest, LoopbackOnlyGuard } from './loopback-only.guard'

function contextFor(
  remoteAddress: string | undefined,
  host: string | undefined,
  extraHeaders: Record<string, string> = {},
): ExecutionContext {
  const req = { headers: { host, ...extraHeaders }, socket: { remoteAddress } }
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

describe('LoopbackOnlyGuard', () => {
  const guard = new LoopbackOnlyGuard()

  it('allows a loopback request to localhost', () => {
    expect(guard.canActivate(contextFor('127.0.0.1', 'localhost:5017'))).toBe(true)
    expect(guard.canActivate(contextFor('::1', 'localhost:5017'))).toBe(true)
    expect(guard.canActivate(contextFor('::ffff:127.0.0.1', '127.0.0.1:5017'))).toBe(true)
    expect(guard.canActivate(contextFor('::1', '[::1]:5017'))).toBe(true)
    expect(guard.canActivate(contextFor('127.0.0.1', 'LOCALHOST'))).toBe(true)
  })

  it('rejects a request from a LAN address', () => {
    expect(() => guard.canActivate(contextFor('192.168.1.23', 'localhost:5017'))).toThrow(
      ForbiddenException,
    )
    expect(() => guard.canActivate(contextFor('::ffff:192.168.1.23', '192.168.1.5:5017'))).toThrow(
      ForbiddenException,
    )
  })

  it('rejects a loopback request whose Host is another name (DNS rebinding)', () => {
    expect(() => guard.canActivate(contextFor('127.0.0.1', 'evil.example'))).toThrow(
      ForbiddenException,
    )
    expect(() => guard.canActivate(contextFor('127.0.0.1', 'evil.example:5017'))).toThrow(
      ForbiddenException,
    )
    expect(() => guard.canActivate(contextFor('127.0.0.1', 'localhost.evil.example'))).toThrow(
      ForbiddenException,
    )
  })

  it('rejects a request relayed by a local proxy (the web dev server rewrite)', () => {
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'via']) {
      expect(() =>
        guard.canActivate(
          contextFor('127.0.0.1', 'localhost:5017', { [header]: 'localhost:3000' }),
        ),
      ).toThrow(ForbiddenException)
    }
  })

  it('rejects a cross-site browser request', () => {
    const cases: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { origin: 'https://example.com' },
      { origin: 'http://localhost.evil.example:3000' },
      { origin: 'file:///tmp/page.html' },
      { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' },
    ]
    for (const headers of cases) {
      expect(() => guard.canActivate(contextFor('127.0.0.1', 'localhost:5017', headers))).toThrow(
        ForbiddenException,
      )
    }
  })

  it('allows the web app and other loopback origins', () => {
    const cases: Record<string, string>[] = [
      { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' },
      { origin: 'http://127.0.0.1:5017' },
      { origin: 'http://[::1]:3000' },
      { origin: 'https://localhost' },
      { 'sec-fetch-site': 'same-origin' },
      { 'sec-fetch-site': 'none' },
    ]
    for (const headers of cases)
      expect(guard.canActivate(contextFor('127.0.0.1', 'localhost:5017', headers))).toBe(true)
  })

  it('rejects a request with no Host header or no remote address', () => {
    expect(() => guard.canActivate(contextFor('127.0.0.1', undefined))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(contextFor(undefined, 'localhost'))).toThrow(ForbiddenException)
  })
})

describe('hostHeaderHostname', () => {
  it.each([
    ['localhost:5017', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['[::1]:5017', '::1'],
    ['[::1]', '::1'],
    ['::1', '::1'],
    ['', ''],
  ])('%s -> %s', (host, expected) => {
    expect(hostHeaderHostname(host)).toBe(expected)
  })

  it('treats an unterminated bracket as no hostname', () => {
    expect(isLoopbackRequest('::1', '[::1')).toBe(false)
  })
})
