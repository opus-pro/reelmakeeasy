import {
  addressesInTextToUrls,
  addressToUrl,
  asStoreUri,
  filesBaseUrl,
  InvalidStoreUriError,
  isStoreUri,
  keyIsUnder,
  parseStoreUri,
  serveStoredUrls,
  storedFileKey,
  storeKeyOf,
  storeKeyToUrl,
  storeUri,
  storeUriToUrl,
  toSavedAddress,
  toSavedAddresses,
  toSavedAddressesInText,
  urlToStoreUri,
} from './address'
import { HOSTILE_KEYS, HOSTILE_STORE_URIS } from './address.cases'

// Without PUBLIC_FILES_URL the API serves stored files at localhost:<PORT>/api/files.
const FILES = 'http://localhost:5017/api/files'

describe('store addresses', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
    delete process.env.NEXT_PUBLIC_API_ORIGIN
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('names a stored file by its key under one scheme, with no bucket', () => {
    expect(storeUri('projects/p1/long_take/kf-01.png')).toBe(
      'store://projects/p1/long_take/kf-01.png',
    )
    expect(isStoreUri('store://projects/p1/a.png')).toBe(true)
    for (const other of [
      'projects/p1/a.png',
      'https://x.test/a.png',
      'file:///a.png',
      'blob:x',
      '',
      null,
      3,
    ]) {
      expect(isStoreUri(other)).toBe(false)
    }
  })

  it('reads the key back, decoding once', () => {
    expect(parseStoreUri('store://projects/p1/a b.png')).toBe('projects/p1/a b.png')
    expect(parseStoreUri('store://projects/p1/a%20b.png')).toBe('projects/p1/a b.png')
    // A key with a literal % survives the round trip.
    expect(parseStoreUri(storeUri('tmp/u1/100%.png'))).toBe('tmp/u1/100%.png')
    expect(parseStoreUri(storeUri('projects/p1/ünïcode.png'))).toBe('projects/p1/ünïcode.png')
  })

  it.each(HOSTILE_STORE_URIS)('refuses %s', (uri) => {
    expect(() => parseStoreUri(uri)).toThrow(InvalidStoreUriError)
    expect(storeKeyOf(uri)).toBeUndefined()
  })

  it.each(HOSTILE_KEYS)('refuses to build an address for the key %j', (key) => {
    expect(() => storeUri(key)).toThrow(InvalidStoreUriError)
  })

  it('tells whether a key is inside a folder, segment by segment', () => {
    expect(keyIsUnder('tmp/u1/music-track/a.mp3', 'tmp/u1/')).toBe(true)
    expect(keyIsUnder('tmp/u1/music-track/a.mp3', 'tmp/u1')).toBe(true)
    expect(keyIsUnder('tmp/u10/a.mp3', 'tmp/u1')).toBe(false)
    expect(keyIsUnder('tmp/u1', 'tmp/u1/')).toBe(false)
    expect(keyIsUnder('tmp/u1/../u2/a.mp3', 'tmp/u1/')).toBe(false)
  })

  it('serves a stored file from the local API, without a bucket', () => {
    expect(filesBaseUrl()).toBe(FILES)
    expect(storeUriToUrl('store://projects/p1/final_video.mp4')).toBe(
      `${FILES}/projects/p1/final_video.mp4`,
    )
    expect(storeUriToUrl('store://projects/p1/a b#1.png')).toBe(
      `${FILES}/projects/p1/a%20b%231.png`,
    )
    expect(storeKeyToUrl('voice-over/previews/p.mp3')).toBe(`${FILES}/voice-over/previews/p.mp3`)
    // Anything else is left alone.
    expect(storeUriToUrl('https://x.test/a.png')).toBe('https://x.test/a.png')
    expect(storeUriToUrl('projects/p1/a.png')).toBe('projects/p1/a.png')
  })

  it('follows PUBLIC_FILES_URL, then the web app API origin, then PORT', () => {
    process.env['PORT'] = '5127'
    expect(filesBaseUrl()).toBe('http://localhost:5127/api/files')
    process.env.NEXT_PUBLIC_API_ORIGIN = 'http://127.0.0.1:5200/'
    expect(filesBaseUrl()).toBe('http://127.0.0.1:5200/api/files')
    process.env['PUBLIC_FILES_URL'] = 'https://media.example.test/api/files/'
    expect(filesBaseUrl()).toBe('https://media.example.test/api/files')
  })

  it('maps a served URL back to its address, without the query', () => {
    expect(urlToStoreUri(`${FILES}/projects/p1/a.png?expires=1&sig=x`)).toBe(
      'store://projects/p1/a.png',
    )
    expect(urlToStoreUri(`${FILES}/projects/p1/a%20b.png#t=1`)).toBe('store://projects/p1/a b.png')
    expect(urlToStoreUri(`${FILES}/tmp/u1/100%25.png`)).toBe(storeUri('tmp/u1/100%.png'))
    expect(asStoreUri(`${FILES}/projects/p1/a.png`)).toBe('store://projects/p1/a.png')
    const external = 'https://cdn.example.com/a.png?sig=1'
    expect(urlToStoreUri(external)).toBeUndefined()
    expect(asStoreUri(external)).toBe(external)
    expect(asStoreUri(undefined)).toBeUndefined()
  })

  it('round-trips an address through its served URL', () => {
    for (const key of [
      'projects/p1/a b.png',
      'tmp/u1/100%.png',
      'music-tracks/u1/ü.mp3',
      'a/b#c?.png',
    ]) {
      expect(urlToStoreUri(storeUriToUrl(storeUri(key)))).toBe(storeUri(key))
    }
  })

  it('returns the key of a stored file URL, and nothing for any other origin', () => {
    expect(storedFileKey(`${FILES}/custom-style/u1/a%20b.png?sig=1`)).toBe(
      'custom-style/u1/a b.png',
    )
    expect(
      storedFileKey('https://evil.example.com/api/files/custom-style/u1/a.png'),
    ).toBeUndefined()
    expect(storedFileKey(`${FILES}/`)).toBeUndefined()
    expect(storedFileKey(`${FILES}/a%E0%A4%A.png`)).toBeUndefined()
  })

  it.each(HOSTILE_KEYS.filter((key) => key !== ''))(
    'refuses the served URL of the key %j',
    (key) => {
      const encoded = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      expect(urlToStoreUri(`${FILES}/${encoded}`)).toBeUndefined()
      expect(urlToStoreUri(`${FILES}/${key}`)).toBeUndefined()
    },
  )

  it('refuses double-encoded traversal in a served URL', () => {
    expect(urlToStoreUri(`${FILES}/projects/p1/%252E%252E/%252E%252E/kv.json`)).toBeUndefined()
    expect(urlToStoreUri(`${FILES}/projects%252F..%252Fkv.json`)).toBeUndefined()
    expect(urlToStoreUri(`${FILES}/projects/p1/%2E%2E/%2E%2E/kv.json`)).toBeUndefined()
  })
})

describe('serveStoredUrls', () => {
  it('builds served URLs for URL fields only, at any depth', () => {
    const body = {
      id: 'p1',
      resultVideo: 'store://agent/workspace/p1/final_video.mp4',
      previewThumbnail: 'store://agent/workspace/p1/_thumbnail/final_video.mp4.jpg',
      bgmBedUri: 'store://projects/p1/bgm/bed.mp3',
      tracks: [
        { cdnUrl: 'store://music-tracks/u1/a.mp3', fileUri: 'store://music-tracks/u1/a.mp3' },
      ],
      snapshot: { scenePreviewUrls: ['store://custom-style/u1/a.png', 'https://x.test/b.png'] },
      styleThumbnailUrl: 'https://x.test/c.png',
      when: new Date(0),
    }
    const served = serveStoredUrls(body)
    expect(served).toEqual({
      id: 'p1',
      resultVideo: `${FILES}/agent/workspace/p1/final_video.mp4`,
      previewThumbnail: `${FILES}/agent/workspace/p1/_thumbnail/final_video.mp4.jpg`,
      // An address the client sends back stays an address.
      bgmBedUri: 'store://projects/p1/bgm/bed.mp3',
      tracks: [
        { cdnUrl: `${FILES}/music-tracks/u1/a.mp3`, fileUri: 'store://music-tracks/u1/a.mp3' },
      ],
      snapshot: { scenePreviewUrls: [`${FILES}/custom-style/u1/a.png`, 'https://x.test/b.png'] },
      styleThumbnailUrl: 'https://x.test/c.png',
      when: new Date(0),
    })
    // The input is not changed in place.
    expect(body.resultVideo).toBe('store://agent/workspace/p1/final_video.mp4')
  })

  it("serves the addresses in a message's upload tags, and leaves address fields as they are", () => {
    // A UIP timeline event: the text a user typed keeps its upload's address.
    const event = {
      message: 'Use @img[Hero](upload_1|store://projects/p1/uploads/hero%20shot.png) here',
      type: 'user_message',
      uploaded_assets: [{ asset_id: 'upload_1', file_path: 'store://projects/p1/uploads/a b.png' }],
    }
    expect(serveStoredUrls(event)).toEqual({
      ...event,
      message: `Use @img[Hero](upload_1|${FILES}/projects/p1/uploads/hero%20shot.png) here`,
    })
    // And back: the text sent to be saved holds the address again.
    expect(toSavedAddresses(serveStoredUrls(event))).toEqual(event)
  })

  it('serves preset addresses from the presets route, next to the files route', () => {
    expect(serveStoredUrls({ styleThumbnailUrl: 'preset://v006/story-mode/a b.webp' })).toEqual({
      styleThumbnailUrl: 'http://localhost:5017/api/presets/v006/story-mode/a%20b.webp',
    })
  })

  it('saves the addresses behind the URLs a client sends back, and nothing with a host', () => {
    const sent = {
      cdnUrl: `${FILES}/music-tracks/u1/a%20b.mp3?sig=1`,
      fileUri: 'store://music-tracks/u1/a b.mp3',
      styleThumbnailUrl: 'http://localhost:5017/api/presets/v006/story-mode/a%20b.webp',
      thumbnailUrl: 'https://cdn.example.test/elsewhere.png',
    }
    const saved = toSavedAddresses(sent)
    expect(saved).toEqual({
      cdnUrl: 'store://music-tracks/u1/a b.mp3',
      fileUri: 'store://music-tracks/u1/a b.mp3',
      styleThumbnailUrl: 'preset://v006/story-mode/a b.webp',
      // Another site's URL is the client's own choice and stays as it is.
      thumbnailUrl: 'https://cdn.example.test/elsewhere.png',
    })
    expect(JSON.stringify(saved)).not.toContain('localhost')
    // Served again on the way out, unchanged.
    expect(serveStoredUrls(saved).styleThumbnailUrl).toBe(sent.styleThumbnailUrl)
    expect(toSavedAddress(`${FILES}/%2E%2E/kv.json`)).toBe(`${FILES}/%2E%2E/kv.json`)
  })

  it('returns the same object when there is nothing to serve', () => {
    const body = { a: 1, list: [{ thumbnailUrl: 'https://x.test/a.png' }] }
    expect(serveStoredUrls(body)).toBe(body)
  })
})

describe('addresses in free text', () => {
  const env = { ...process.env }
  const PRESETS = 'http://localhost:5017/api/presets'
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
    delete process.env.NEXT_PUBLIC_API_ORIGIN
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it("saves an upload's tag with the file's address, which reads back as the same file", () => {
    const sent = `Use this @img[Hero](upload_1|${FILES}/projects/p1/user-intent-planner/uploads/hero%20shot.png) please`
    const saved = toSavedAddressesInText(sent)
    expect(saved).toBe(
      'Use this @img[Hero](upload_1|store://projects/p1/user-intent-planner/uploads/hero%20shot.png) please',
    )
    expect(saved).not.toContain('localhost')
    // The browser gets the URL back, wherever the API is now.
    process.env['PORT'] = '5127'
    expect(addressesInTextToUrls(saved)).toBe(
      'Use this @img[Hero](upload_1|http://localhost:5127/api/files/projects/p1/user-intent-planner/uploads/hero%20shot.png) please',
    )
  })

  it('keeps a file name with parentheses in its tag, however the browser encoded them', () => {
    const key = 'projects/p1/user_uploaded/My-Song (1).mp4'
    for (const path of ['My-Song%20%281%29.mp4', 'My-Song%20(1%29.mp4', 'My-Song%20(1).mp4']) {
      const saved = toSavedAddressesInText(
        `@audio[My-Song (1).mp4](a1|${FILES}/projects/p1/user_uploaded/${path}) and more`,
      )
      expect(saved).toBe(
        '@audio[My-Song (1).mp4](a1|store://projects/p1/user_uploaded/My-Song%20%281%29.mp4) and more',
      )
      const served = /\|([^|]*)\) and more$/.exec(addressesInTextToUrls(saved))?.[1]
      expect(storedFileKey(served ?? '')).toBe(key)
    }
  })

  it('drops a served query, and saves a preset file as its preset address', () => {
    const saved = toSavedAddressesInText(
      `@img[a](x|${FILES}/agent/workspace/p1/_thumbnail/a.jpg?v=3) @img[b](y|${PRESETS}/v007/story-mode/styles/anime.webp)`,
    )
    expect(saved).toBe(
      '@img[a](x|store://agent/workspace/p1/_thumbnail/a.jpg) @img[b](y|preset://v007/story-mode/styles/anime.webp)',
    )
    expect(addressesInTextToUrls(saved)).toBe(
      `@img[a](x|${FILES}/agent/workspace/p1/_thumbnail/a.jpg) @img[b](y|${PRESETS}/v007/story-mode/styles/anime.webp)`,
    )
  })

  it('saves a bare served URL and a markdown link to one as addresses too', () => {
    const sent = `see ${FILES}/projects/p1/a.png and [b.png](${FILES}/projects/p1/b.png).`
    const saved = toSavedAddressesInText(sent)
    expect(saved).toBe('see store://projects/p1/a.png and [b.png](store://projects/p1/b.png).')
    expect(addressesInTextToUrls(saved)).toBe(sent)
  })

  it("leaves other sites' URLs, a tag without a URL and an address already saved as they are", () => {
    for (const text of [
      'my brand is https://example.test/a.png',
      '@img[a](upload_1)',
      '@img[a](upload_1|store://projects/p1/a b.png)',
      'nothing here',
      '',
    ]) {
      expect(toSavedAddressesInText(text)).toBe(text)
    }
    expect(toSavedAddressesInText(undefined)).toBeUndefined()
  })

  it('never turns a URL that climbs out of the files into an address', () => {
    const text = `@img[a](x|${FILES}/projects/%2E%2E/%2E%2E/kv.json)`
    expect(toSavedAddressesInText(text)).toBe(text)
    // And an address the parser refuses is shown as it is, never served.
    expect(addressesInTextToUrls('@img[a](x|store://../kv.json)')).toBe(
      '@img[a](x|store://../kv.json)',
    )
  })

  it('serves an address the way the browser shows one: files, presets, anything else as is', () => {
    expect(addressToUrl('store://projects/p1/a b.png')).toBe(`${FILES}/projects/p1/a%20b.png`)
    expect(addressToUrl('preset://v007/a.webp')).toBe(`${PRESETS}/v007/a.webp`)
    expect(addressToUrl('blob:http://localhost:3000/x')).toBe('blob:http://localhost:3000/x')
  })
})
