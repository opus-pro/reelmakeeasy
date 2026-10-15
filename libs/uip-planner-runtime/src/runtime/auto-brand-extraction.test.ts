import {
  detectAllUrlsInText,
  detectFirstUrlInText,
  stripAssetMarkup,
} from './auto-brand-extraction'

// Without PUBLIC_FILES_URL the API serves stored files at localhost:<PORT>/api/files.
const UPLOAD = 'http://localhost:5017/api/files/projects/p1/user-intent-planner/uploads/logo.png'

describe('brand URL detection', () => {
  it('finds the brand site the user pasted', () => {
    expect(detectFirstUrlInText('Make an ad for https://acme.example.com/pricing')).toBe(
      'https://acme.example.com/pricing',
    )
    expect(detectFirstUrlInText('Make an ad for acme.com')).toBe('acme.com')
  })

  it('never reads an uploaded file as a brand site', () => {
    expect(detectFirstUrlInText(`Use this ${UPLOAD}`)).toBeNull()
    expect(detectFirstUrlInText(`@img[logo.png](asset-1|${UPLOAD}) for acme.com`)).toBe('acme.com')
    expect(stripAssetMarkup(`[My-Song.mp3](${UPLOAD}) please`).trim()).toBe('please')
  })

  it('never reads a saved upload address as a brand site', () => {
    // Messages are saved with the uploads' addresses, not their URLs.
    const saved = 'store://projects/p1/user-intent-planner/uploads/My-Song.mp3'
    expect(detectFirstUrlInText(`Use this ${saved}`)).toBeNull()
    expect(detectFirstUrlInText(`@audio[My-Song.mp3](asset-1|${saved}) for acme.com`)).toBe(
      'acme.com',
    )
    expect(stripAssetMarkup(`[My-Song.mp3](${saved}) please`).trim()).toBe('please')
    expect(
      detectFirstUrlInText('the look of preset://v007/story-mode/styles/anime.webp'),
    ).toBeNull()
  })

  it('skips links to this app itself', () => {
    expect(detectFirstUrlInText('see http://localhost:3000/story-mode/p1')).toBeNull()
    expect(detectAllUrlsInText('http://127.0.0.1:3000/home and https://acme.com')).toEqual([
      'https://acme.com',
    ])
  })
})
