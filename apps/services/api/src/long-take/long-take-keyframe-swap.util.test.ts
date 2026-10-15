import { resetGenerationProviderForTesting, setGenerationProvider } from '@reelmakeeasy/llm/registry'
import type { LongTakeTransition } from '@shared/types/api/long-take'
import sharp from 'sharp'

import {
  clipsOnKeyframe,
  commitKeyframePicture,
  pictureSize,
  stageKeyframePicture,
  storyClipUsd,
} from './long-take-keyframe-swap.util'

/** An in-memory project folder: JSON and pictures by path, at `store://projects/p1/<path>`. */
function memoryStorage() {
  const files = new Map<string, Buffer | unknown>()
  const rel = (p: string) => p.replace(/^store:\/\/projects\/p1\//, '')
  return {
    files,
    storage: {
      copyFile: async (from: string, to: string) => {
        if (!files.has(rel(from)))
          throw Object.assign(new Error(`No such object: ${from}`), { code: 404 })
        files.set(rel(to), files.get(rel(from)))
      },
      exists: async (p: string) => files.has(rel(p)),
      getFullPath: (p: string) => `store://projects/p1/${p}`,
      readFile: async (p: string) => {
        const file = files.get(rel(p))
        if (!Buffer.isBuffer(file))
          throw Object.assign(new Error(`No such object: ${p}`), { code: 404 })
        return file
      },
      readJsonFile: async (p: string) => {
        if (!files.has(rel(p)))
          throw Object.assign(new Error(`No such object: ${p}`), { code: 404 })
        return structuredClone(files.get(rel(p)))
      },
      writeFile: async (p: string, content: Buffer) => {
        files.set(rel(p), content)
        return p
      },
      writeJsonFile: async (p: string, data: unknown) => {
        files.set(rel(p), structuredClone(data))
        return p
      },
    },
  }
}

const clip = (n: number, from: string, to: string, startMs: number, endMs: number) =>
  ({
    endMs,
    fromShotId: from,
    prompt: `clip ${n}`,
    startMs,
    toShotId: to,
    transitionId: `transition_${n - 1}`,
    videoUri: `store://projects/p1/long_take/transitions/transition_${n - 1}.mp4`,
  }) as LongTakeTransition

const CLIPS = [
  clip(1, '1', '2', 0, 5400),
  clip(2, '2', '3', 5400, 8720),
  clip(3, '3', '4', 8720, 11680),
]

describe('clipsOnKeyframe', () => {
  it('a keyframe inside the video: the clip that lands on it and the one that leaves it', () => {
    expect(clipsOnKeyframe(CLIPS, '2').map((c) => [c.number, c.transition.transitionId])).toEqual([
      [1, 'transition_0'],
      [2, 'transition_1'],
    ])
  })

  it('the first keyframe only opens clip 1; the last only ends the last clip', () => {
    expect(clipsOnKeyframe(CLIPS, '1').map((c) => c.number)).toEqual([1])
    expect(clipsOnKeyframe(CLIPS, '4').map((c) => c.number)).toEqual([3])
    expect(clipsOnKeyframe(CLIPS, '9')).toEqual([])
  })
})

describe('storyClipUsd', () => {
  beforeEach(() => setGenerationProvider('fal'))
  afterEach(() => resetGenerationProviderForTesting())

  it('prices the seconds the model bills (Hailuo: whole seconds, at least 5) at its rate', () => {
    const model = 'minimax-h3-max-turbo'
    // 5.4 s is billed as 6 s, 3.3 s as 5 s, at $0.04 a second at 768p and $0.08 at 1080p.
    expect(storyClipUsd({ durationSeconds: 5.4, model, resolution: '768p' })).toBe(0.24)
    expect(storyClipUsd({ durationSeconds: 3.32, model, resolution: '768p' })).toBe(0.2)
    expect(storyClipUsd({ durationSeconds: 5.4, model, resolution: '1080p' })).toBe(0.48)
  })

  it('prices the model transitions use when none is named, at 768p by default', () => {
    expect(storyClipUsd({ durationSeconds: 5.4 })).toBe(0.24)
  })
})

describe('stageKeyframePicture / commitKeyframePicture', () => {
  const png = () =>
    sharp({ create: { background: '#fff', channels: 3, height: 1360, width: 768 } })
      .png()
      .toBuffer()

  it('stages the picture and its thumbnail under new names, leaving the keyframe as it is', async () => {
    const { files, storage } = memoryStorage()
    const staged = await stageKeyframePicture(storage as never, '2', await png(), 'abc')
    expect(staged).toEqual({
      keyframeUri: 'store://projects/p1/long_take/keyframes/2-abc.png',
      picturePath: 'long_take/keyframes/2-abc.png',
      thumbnailUri: 'store://projects/p1/long_take/keyframes/thumbnails/2-abc.webp',
    })
    expect(await pictureSize(storage as never, staged.keyframeUri)).toEqual({
      height: 1360,
      width: 768,
    })
    const thumb = await sharp(
      files.get('long_take/keyframes/thumbnails/2-abc.webp') as Buffer,
    ).metadata()
    expect(thumb).toMatchObject({ format: 'webp', height: 256 })
    expect(files.has('long_take/keyframes/2.png')).toBe(false)
  })

  it("makes the staged picture the keyframe: only that shot's picture and thumbnail change", async () => {
    const { files, storage } = memoryStorage()
    files.set('long_take/keyframes.json', [
      { keyframeUrl: 'store://projects/p1/long_take/keyframes/1.png', shotId: '1' },
      {
        imageModel: 'gpt-image-2.5-flare',
        keyframeUrl: 'store://projects/p1/long_take/keyframes/2.png',
        shotId: '2',
        thumbnailUrl: 'store://projects/p1/long_take/keyframes/thumbnails/2.webp',
      },
    ])
    files.set('long_take/keyframe_thumbnails.json', [
      { shotId: '1', thumbnailUrl: 'store://projects/p1/long_take/keyframes/thumbnails/1.webp' },
      { shotId: '2', thumbnailUrl: 'store://projects/p1/long_take/keyframes/thumbnails/2.webp' },
    ])
    files.set('long_take/keyframes/2-abc.png', Buffer.from('new 2'))
    await commitKeyframePicture(storage as never, '2', {
      keyframeUri: 'store://projects/p1/long_take/keyframes/2-abc.png',
      picturePath: 'long_take/keyframes/2-abc.png',
      thumbnailUri: 'store://projects/p1/long_take/keyframes/thumbnails/2-abc.webp',
    })
    expect(files.get('long_take/keyframes.json')).toEqual([
      { keyframeUrl: 'store://projects/p1/long_take/keyframes/1.png', shotId: '1' },
      {
        imageModel: 'gpt-image-2.5-flare',
        keyframeUrl: 'store://projects/p1/long_take/keyframes/2-abc.png',
        shotId: '2',
        thumbnailUrl: 'store://projects/p1/long_take/keyframes/thumbnails/2-abc.webp',
      },
    ])
    expect(files.get('long_take/keyframe_thumbnails.json')).toEqual([
      { shotId: '1', thumbnailUrl: 'store://projects/p1/long_take/keyframes/thumbnails/1.webp' },
      {
        shotId: '2',
        thumbnailUrl: 'store://projects/p1/long_take/keyframes/thumbnails/2-abc.webp',
      },
    ])
  })

  it('adds the thumbnail when the project had none, and refuses a keyframe that is gone', async () => {
    const { files, storage } = memoryStorage()
    files.set('long_take/keyframes.json', [{ keyframeUrl: 'store://k3.png', shotId: '3' }])
    files.set('long_take/keyframes/3-new.png', Buffer.from('new 3'))
    const staged = {
      keyframeUri: 'store://k3-new.png',
      picturePath: 'long_take/keyframes/3-new.png',
      thumbnailUri: 'store://t3-new.webp',
    }
    await commitKeyframePicture(storage as never, '3', staged)
    expect(files.get('long_take/keyframe_thumbnails.json')).toEqual([
      { shotId: '3', thumbnailUrl: 'store://t3-new.webp' },
    ])
    await expect(commitKeyframePicture(storage as never, '7', staged)).rejects.toThrow(
      'Keyframe 7 is no longer in the video',
    )
  })

  it("puts the new picture under the keyframe's own name, where the agent looks, keeping the old one", async () => {
    // The agent views and fixes a keyframe at keyframes/<shotId>.png: after a swap it must find
    // the new picture there, not the one it replaced.
    const { files, storage } = memoryStorage()
    files.set('long_take/keyframes.json', [
      { keyframeUrl: 'store://projects/p1/long_take/keyframes/2.png', shotId: '2' },
    ])
    files.set('long_take/keyframes/2.png', Buffer.from('old 2'))
    files.set('long_take/keyframes/2-abc.png', Buffer.from('new 2'))
    await commitKeyframePicture(storage as never, '2', {
      keyframeUri: 'store://projects/p1/long_take/keyframes/2-abc.png',
      picturePath: 'long_take/keyframes/2-abc.png',
    })
    expect(files.get('long_take/keyframes/2.png')).toEqual(Buffer.from('new 2'))
    expect(files.get('long_take/keyframes/replaced/2-abc.png')).toEqual(Buffer.from('old 2'))
    // The video reads the new name: a page that showed the old picture loads the new one.
    expect(files.get('long_take/keyframes.json')).toEqual([
      { keyframeUrl: 'store://projects/p1/long_take/keyframes/2-abc.png', shotId: '2' },
    ])

    // A second fix replaces the first one there, and keeps it too.
    files.set('long_take/keyframes/2-def.png', Buffer.from('newer 2'))
    await commitKeyframePicture(storage as never, '2', {
      keyframeUri: 'store://projects/p1/long_take/keyframes/2-def.png',
      picturePath: 'long_take/keyframes/2-def.png',
    })
    expect(files.get('long_take/keyframes/2.png')).toEqual(Buffer.from('newer 2'))
    expect(files.get('long_take/keyframes/replaced/2-def.png')).toEqual(Buffer.from('new 2'))
  })

  it('changes nothing when the staged picture is gone', async () => {
    const { files, storage } = memoryStorage()
    const keyframes = [
      { keyframeUrl: 'store://projects/p1/long_take/keyframes/2.png', shotId: '2' },
    ]
    files.set('long_take/keyframes.json', keyframes)
    files.set('long_take/keyframes/2.png', Buffer.from('old 2'))
    await expect(
      commitKeyframePicture(storage as never, '2', {
        keyframeUri: 'store://projects/p1/long_take/keyframes/2-abc.png',
        picturePath: 'long_take/keyframes/2-abc.png',
      }),
    ).rejects.toThrow()
    expect(files.get('long_take/keyframes/2.png')).toEqual(Buffer.from('old 2'))
    expect(files.get('long_take/keyframes.json')).toEqual(keyframes)
  })
})
