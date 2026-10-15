import {
  CAPTION_PACK_FAMILIES,
  captionFontSampleUrl,
  chosenCaptionFamily,
  forgetCaptionFontSamples,
  isCaptionFontSampleLoaded,
  loadCaptionFontSample,
  sampleFontFamily,
} from './caption-fonts'

type FakeFace = { family: string; load: jest.Mock; source: string }

/** A FontFace stand-in: `fail` makes every load reject. */
function installFontFace({ fail = false } = {}) {
  const faces: FakeFace[] = []
  const add = jest.fn()
  const FontFace = jest.fn((family: string, source: string) => {
    const face: FakeFace = {
      family,
      load: jest.fn(() => (fail ? Promise.reject(new Error('bad font')) : Promise.resolve(face))),
      source,
    }
    faces.push(face)
    return face
  })
  Object.assign(globalThis, { FontFace })
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add } })
  return { add, faces, FontFace }
}

afterEach(() => {
  forgetCaptionFontSamples()
  delete (globalThis as { FontFace?: unknown }).FontFace
})

describe('CAPTION_PACK_FAMILIES', () => {
  it('lists the seven built-in fonts in menu order', () => {
    expect(CAPTION_PACK_FAMILIES).toEqual([
      'Anton',
      'DM Sans',
      'Dela Gothic One',
      'Roboto',
      'Alegreya',
      'PT Serif',
      'Roboto Serif',
    ])
  })
})

describe('chosenCaptionFamily', () => {
  it("reads a built-in font, and nothing else, as the video's font", () => {
    expect(chosenCaptionFamily({ font: { family: 'Anton', source: 'pack' } })).toBe('Anton')
    expect(chosenCaptionFamily({ font: { family: 'DM Sans', source: 'pack' } })).toBe('DM Sans')
    expect(chosenCaptionFamily(null)).toBeNull()
    expect(chosenCaptionFamily({})).toBeNull()
    expect(chosenCaptionFamily({ font: null })).toBeNull()
    expect(chosenCaptionFamily({ font: { family: 'Comic Sans', source: 'pack' } })).toBeNull()
    expect(chosenCaptionFamily({ font: { family: 'Anton', source: 'upload' } })).toBeNull()
    expect(chosenCaptionFamily({ font: 'Anton' })).toBeNull()
  })
})

describe('sampleFontFamily', () => {
  it("registers a sample under a name of the app's own, never the font's", () => {
    expect(sampleFontFamily('Anton')).toBe('ly-cap-anton')
    expect(sampleFontFamily('Dela Gothic One')).toBe('ly-cap-dela-gothic-one')
    expect(sampleFontFamily('PT Serif')).toBe('ly-cap-pt-serif')
  })
})

describe('captionFontSampleUrl', () => {
  it('reads a sample from the API, and only over http', () => {
    expect(
      captionFontSampleUrl('/api/caption-fonts/pack/Anton-Regular.ttf', 'http://localhost:5017'),
    ).toBe('http://localhost:5017/api/caption-fonts/pack/Anton-Regular.ttf')
    expect(
      captionFontSampleUrl(
        'https://files.example.com/api/caption-fonts/pack/Anton-Regular.ttf',
        'http://localhost:5017',
      ),
    ).toBe('https://files.example.com/api/caption-fonts/pack/Anton-Regular.ttf')
    expect(captionFontSampleUrl('javascript:alert(1)', 'http://localhost:5017')).toBeNull()
    expect(captionFontSampleUrl('data:font/ttf;base64,AAAA', 'http://localhost:5017')).toBeNull()
    expect(captionFontSampleUrl('', 'http://localhost:5017')).toBeNull()
  })
})

describe('loadCaptionFontSample', () => {
  it('loads each sample once per page and adds it to the page', async () => {
    const { add, faces, FontFace } = installFontFace()
    const url = 'http://localhost:5017/api/caption-fonts/pack/Anton-Regular.ttf'
    expect(isCaptionFontSampleLoaded('Anton')).toBe(false)

    const [first, second] = await Promise.all([
      loadCaptionFontSample('Anton', url),
      loadCaptionFontSample('Anton', url),
    ])
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(await loadCaptionFontSample('Anton', url)).toBe(true)
    expect(FontFace).toHaveBeenCalledTimes(1)
    expect(faces[0].family).toBe('ly-cap-anton')
    expect(faces[0].source).toBe(`url("${url}")`)
    expect(add).toHaveBeenCalledWith(faces[0])
    expect(isCaptionFontSampleLoaded('Anton')).toBe(true)
  })

  it('says a sample failed, adds nothing, and tries again the next time', async () => {
    const { add, FontFace } = installFontFace({ fail: true })
    const url = 'http://localhost:5017/api/caption-fonts/pack/PTSerif-Bold.ttf'

    expect(await loadCaptionFontSample('PT Serif', url)).toBe(false)
    expect(add).not.toHaveBeenCalled()
    expect(isCaptionFontSampleLoaded('PT Serif')).toBe(false)

    expect(await loadCaptionFontSample('PT Serif', url)).toBe(false)
    expect(FontFace).toHaveBeenCalledTimes(2)
  })

  it('draws nothing new in a browser without FontFace', async () => {
    expect(await loadCaptionFontSample('Roboto', 'http://localhost:5017/a.ttf')).toBe(false)
    expect(isCaptionFontSampleLoaded('Roboto')).toBe(false)
  })
})
