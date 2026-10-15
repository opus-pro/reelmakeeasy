import type { INestApplication } from '@nestjs/common'

import setCors from './cors'

type OriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void

function allows(origin: string | undefined): boolean | undefined {
  const enableCors = jest.fn()
  setCors({ enableCors } as unknown as INestApplication<unknown>)
  const check = enableCors.mock.calls[0][0].origin as OriginCheck
  let allowed: boolean | undefined
  check(origin, (_err, allow) => {
    allowed = allow
  })
  return allowed
}

describe('setCors', () => {
  it('allows the local web app and same-origin requests', () => {
    expect(allows('http://localhost:3000')).toBe(true)
    expect(allows('http://127.0.0.1:3000')).toBe(true)
    expect(allows(undefined)).toBe(true)
  })

  it('rejects a non-local origin', () => {
    expect(allows('https://example.com')).toBe(false)
    expect(allows('http://localhost.example.com:3000')).toBe(false)
  })

  describe('with WEB_PORT set (a second copy)', () => {
    const before = process.env['WEB_PORT']
    beforeEach(() => {
      process.env['WEB_PORT'] = '3100'
    })
    afterEach(() => {
      if (before === undefined) delete process.env['WEB_PORT']
      else process.env['WEB_PORT'] = before
    })

    it('allows the web app on that port, and no longer the default one', () => {
      expect(allows('http://localhost:3100')).toBe(true)
      expect(allows('http://127.0.0.1:3100')).toBe(true)
      expect(allows('http://localhost:3000')).toBe(false)
    })
  })
})
