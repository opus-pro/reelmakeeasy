import { resolveProviderPolicy, VIDEO_PROVIDERS } from './circuit-breaker-policy'

describe('circuit breaker for Gemini clips', () => {
  it('treats google like fal', () => {
    expect(VIDEO_PROVIDERS).toEqual(['fal', 'google'])
    expect(resolveProviderPolicy('google')).toEqual(resolveProviderPolicy('fal'))
  })
})
