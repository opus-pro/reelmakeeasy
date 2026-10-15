import path from 'node:path'

import { presetUriToUrl, serveStoredUrls } from './address'
import {
  presetFilePath,
  presetPackDir,
  presetPackUri,
  presetPackUrl,
  presetPackVersion,
} from './presets'

describe('presetPackUri', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('names a pack file by an address with no host or port, served where presetPackUrl says', () => {
    const uri = presetPackUri('camera-samples/calm.jpg')
    expect(uri).toBe(`preset://${presetPackVersion()}/camera-samples/calm.jpg`)
    expect(presetUriToUrl(uri)).toBe(presetPackUrl('camera-samples/calm.jpg'))
    process.env['PORT'] = '5127'
    expect(presetUriToUrl(uri)).toBe(
      `http://localhost:5127/api/presets/${presetPackVersion()}/camera-samples/calm.jpg`,
    )
  })

  it('reads back as the pack file, a space and a percent sign included', () => {
    for (const key of ['story-mode/styles/a b.webp', 'story-mode/styles/100%.webp']) {
      expect(presetFilePath(presetPackUri(key))).toBe(path.join(presetPackDir(), key))
    }
  })

  it('refuses a key that leaves the pack', () => {
    for (const key of ['../kv.json', 'a/../../kv.json', '.hidden', '']) {
      expect(() => presetPackUri(key)).toThrow()
    }
  })

  it('is served in an agent card: the sample clip and poster, and the chosen style', () => {
    const card = {
      options: [
        {
          label: 'Calm',
          sample: {
            posterUrl: presetPackUri('camera-samples/calm.jpg'),
            videoUrl: presetPackUri('camera-samples/calm.mp4'),
          },
        },
      ],
    }
    expect(serveStoredUrls(card).options[0]?.sample).toEqual({
      posterUrl: presetPackUrl('camera-samples/calm.jpg'),
      videoUrl: presetPackUrl('camera-samples/calm.mp4'),
    })
    const chosen = { thumbnailUrl: presetPackUri('story-mode/styles/anime.webp') }
    expect(serveStoredUrls(chosen).thumbnailUrl).toBe(presetPackUrl('story-mode/styles/anime.webp'))
  })
})
