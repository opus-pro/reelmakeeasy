import fs from 'node:fs'
import path from 'node:path'

import { CAMERA_SAMPLE_IDS, CAMERA_SAMPLES, cameraSampleUrls } from './camera-samples'
import { presetsDir } from './presets'

describe('camera samples', () => {
  it('has a clip and a poster in the pack for Dynamic, Calm and the loop short', () => {
    expect(CAMERA_SAMPLE_IDS).toEqual(['dynamic', 'calm', 'beat-loop'])
    expect(CAMERA_SAMPLES).toEqual({
      'beat-loop': {
        poster: 'camera-samples/beat-loop.jpg',
        video: 'camera-samples/beat-loop.mp4',
      },
      calm: { poster: 'camera-samples/calm.jpg', video: 'camera-samples/calm.mp4' },
      dynamic: { poster: 'camera-samples/dynamic.jpg', video: 'camera-samples/dynamic.mp4' },
    })
  })

  it('builds the URLs under the served pack, with or without a trailing slash', () => {
    const urls = {
      poster: 'http://localhost:5017/api/presets/v007/camera-samples/calm.jpg',
      video: 'http://localhost:5017/api/presets/v007/camera-samples/calm.mp4',
    }
    expect(cameraSampleUrls('http://localhost:5017/api/presets/v007', 'calm')).toEqual(urls)
    expect(cameraSampleUrls('http://localhost:5017/api/presets/v007/', 'calm')).toEqual(urls)
  })

  it('ships every sample in the pack the build script makes', () => {
    const script = fs.readFileSync(
      path.join(presetsDir(), '..', 'scripts', 'build-preset-pack.mjs'),
      'utf8',
    )
    const copied = /const COPIED_FILES = \[([^\]]*)\]/.exec(script)?.[1] ?? ''
    for (const id of CAMERA_SAMPLE_IDS) {
      expect(copied).toContain(`'${CAMERA_SAMPLES[id].video}'`)
      expect(copied).toContain(`'${CAMERA_SAMPLES[id].poster}'`)
    }
  })
})
