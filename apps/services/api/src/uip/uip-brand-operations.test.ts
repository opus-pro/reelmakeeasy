import { confirmBrandReview } from './uip-brand-operations'

/** A UipService in the brand-review phase that records the workflow signal. */
function makeService() {
  const signalWorkflow = jest.fn(async () => undefined)
  const svc = {
    assertUipAccess: jest.fn(async () => undefined),
    checkActionAllowed: jest.fn(() => 'allowed'),
    loadSession: jest.fn(async () => ({ phase: 'brand_review', status: 'active' })),
    signalWorkflow,
  }
  return { signalWorkflow, svc: svc as never }
}

describe('confirmBrandReview', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it.each([
    [
      'a saved style',
      'http://localhost:5017/api/files/custom-style/u1/s1/preview.png',
      'store://custom-style/u1/s1/preview.png',
    ],
    [
      'a preset style',
      'http://localhost:5017/api/presets/v007/story-mode/styles/anime.webp',
      'preset://v007/story-mode/styles/anime.webp',
    ],
    [
      'an address',
      'store://custom-style/u1/s1/preview.png',
      'store://custom-style/u1/s1/preview.png',
    ],
    ['another site', 'https://example.test/a.png', 'https://example.test/a.png'],
  ])(
    'saves the preview of %s as its address, not the URL the browser sent',
    async (_, sent, saved) => {
      const { signalWorkflow, svc } = makeService()
      await confirmBrandReview(svc, 'p1', { brandStylePreviewUrl: sent, gateToken: 'g' })
      expect(signalWorkflow).toHaveBeenCalledWith('p1', 'uip-confirm-brand-review', {
        brandStylePreviewUrl: saved,
        gateToken: 'g',
      })
    },
  )
})
