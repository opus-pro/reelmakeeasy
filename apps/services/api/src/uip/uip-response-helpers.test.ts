import {
  recordUrlMapping,
  rewriteMessageAssetIdsToAddresses,
  rewriteMessageAssetUrls,
} from './uip-response-helpers'

const FILES = 'http://localhost:5017/api/files'

describe('the first message of an Easy session keeps its uploads as addresses', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('points an upload moved into the project at its new address, in every old form', () => {
    const urlMap = new Map<string, string>()
    const to = 'store://projects/p1/user-intent-planner/uploads/a-1/hero shot.png'
    recordUrlMapping(urlMap, 'tmp/u1/123-hero shot.png', to)
    const moved = 'store://projects/p1/user-intent-planner/uploads/a-1/hero%20shot.png'
    for (const old of [
      'tmp/u1/123-hero shot.png',
      'store://tmp/u1/123-hero shot.png',
      `${FILES}/tmp/u1/123-hero%20shot.png`,
    ]) {
      expect(rewriteMessageAssetUrls(`look @img[Hero](a|${old}) here`, urlMap)).toBe(
        `look @img[Hero](a|${moved}) here`,
      )
    }
  })

  it("names each upload's tag by its address, a blob: preview included", () => {
    const message = '@img[Hero](upload_1|blob:http://localhost:3000/x) and @img[Logo](upload_2)'
    const assets = [
      {
        asset_id: 'upload_1',
        file_name: 'hero shot.png',
        file_path: 'uploads/upload_1/hero shot.png',
      },
      {
        asset_id: 'upload_2',
        file_name: 'logo.png',
        file_path: 'store://brand-library/o1/b1/logo.png',
      },
    ]
    const saved = rewriteMessageAssetIdsToAddresses(message, assets, 'p1')
    expect(saved).toBe(
      '@img[Hero](upload_1|store://projects/p1/user-intent-planner/uploads/upload_1/hero%20shot.png)' +
        ' and @img[Logo](upload_2|store://brand-library/o1/b1/logo.png)',
    )
    expect(saved).not.toContain('localhost')
  })
})
