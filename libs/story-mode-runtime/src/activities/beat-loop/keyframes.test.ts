import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  KEYFRAME_STYLE_REFERENCE_PREFIX,
  NO_TEXT_LINE,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  resetGenerationProviderForTesting,
  resolveRole,
  setGenerationProvider,
} from '@reelmakeeasy/llm/registry'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

// The keyframe activity with the picture model and the text check faked. A JSON file set to
// CORRUPT reads as JSON cut short.
let root = ''
const json = new Map<string, unknown>()
const CORRUPT = 'corrupt file'
jest.mock('../long-take/storage', () => ({
  ...jest.requireActual('../long-take/storage'),
  createLongTakeStorage: () => ({
    copyFile: async (from: string, to: string) =>
      fs.copyFileSync(path.join(root, from), path.join(root, to)),
    getFullPath: (relative: string) => path.join(root, relative),
    readJsonFile: async (relative: string) => {
      if (!json.has(relative)) throw Object.assign(new Error('No such object'), { code: 404 })
      if (json.get(relative) === CORRUPT) throw new SyntaxError('Unexpected end of JSON input')
      return structuredClone(json.get(relative))
    },
    uploadFile: async (local: string, relative: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.copyFileSync(local, path.join(root, relative))
      return relative
    },
    writeJsonFile: async (relative: string, data: unknown) => {
      json.set(relative, structuredClone(data))
      return relative
    },
  }),
}))
jest.mock('../long-take/common', () => ({
  ...jest.requireActual('../long-take/common'),
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
interface ImageCall {
  aspectRatio: string
  contents: { imageUrl: string; type: string }[]
  customModel: string
  outputPath: string
  prompt: string
  shotId: string
}
const images: ImageCall[] = []
let imageColor = 0
/** Shot ids whose next picture call fails (once each). */
const failNext = new Set<string>()
jest.mock('../long-take-image-generation-record', () => ({
  runImageGenerationWithRecord: async (
    call: ImageCall & { onModelSucceeded?: (m: string) => void },
  ) => {
    if (failNext.delete(call.shotId)) throw new Error(`picture model failed on ${call.shotId}`)
    images.push(call)
    // Each picture a different colour, so copies and edits can be told apart.
    imageColor += 1
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x${((imageColor * 37) % 256).toString(16).padStart(2, '0')}2040:size=90x160`,
      '-frames:v',
      '1',
      call.outputPath,
    ])
    // Kept by call number: the activity's own copies are temporary.
    fs.mkdirSync(path.join(root, 'generated'), { recursive: true })
    fs.copyFileSync(call.outputPath, path.join(root, 'generated', `${images.length}.png`))
    call.onModelSucceeded?.(call.customModel)
    return call.outputPath
  },
}))
const textVerdicts: Record<string, { detail?: string; hasText: boolean }[]> = {}
jest.mock('./text-check', () => ({
  findBeatLoopText: async (file: string) => {
    const id = path.basename(file, '.png').replace(/-\d+$/, '')
    return textVerdicts[id]?.shift() ?? { hasText: false }
  },
}))

import { generateBeatLoopKeyframes } from './keyframes'
import { BEAT_LOOP_QA_PATH } from './qa-store'

const STYLE = 'Editorial explainer collage: textured off-white newsprint paper background.'

const storyboard: BeatLoopStoryboard = {
  accent: '#FFE500',
  caption_style: 'explainer',
  clips: Array.from({ length: 4 }, (_, i) => ({
    caption: null,
    cut: 'The camera dives into the next cutout.',
    cut_camera: 'Zoom in' as const,
    freeze: 'The cutouts freeze on the page.',
    hit: 'The cutouts slam into place.',
    hit_camera: 'Push in' as const,
    id: `s${i + 1}`,
    narration: `Line number ${i + 1} of this loop is spoken here.`,
    stamp: null,
  })),
  duration_s: 16,
  keyframes: [
    { id: 'f0', prompt: 'Hook: a bust of Cleopatra with a pyramid and an astronaut.' },
    { id: 'f1', prompt: 'NEW SHOT: the Great Pyramid fills the frame.' },
    { id: 'f2', prompt: 'NEW SHOT: Cleopatra at the foot of the pyramid.' },
    { id: 'f3', prompt: 'NEW SHOT: an astronaut on the Moon.' },
    { id: 'f4', same_as: 'f0' },
  ],
  sources: 'A source',
  title: 'Loop',
}

const params = { projectId: 'p1', storyboard, style: STYLE, userId: 'u1' }
const env = { ...process.env }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-keyframes-'))
  json.clear()
  images.length = 0
  failNext.clear()
  for (const key of Object.keys(textVerdicts)) delete textVerdicts[key]
  resetGenerationProviderForTesting()
  process.env = { ...env, FAL_KEY: 'test-fal', GEMINI_API_KEY: 'test-gemini' }
})
afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true })
  process.env = env
  resetGenerationProviderForTesting()
})

describe('generateBeatLoopKeyframes', () => {
  it('makes f0 from text, then each frame as an edit of the one before, all 9:16 with no text', async () => {
    const result = await generateBeatLoopKeyframes(params)

    expect(images.map((call) => call.shotId)).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(images.every((call) => call.aspectRatio === '9:16')).toBe(true)
    expect(images.every((call) => call.prompt.includes(NO_TEXT_LINE))).toBe(true)
    expect(images.every((call) => call.prompt.endsWith(`Style: ${STYLE}`))).toBe(true)

    expect(images[0].contents).toEqual([])
    expect(images[0].customModel).toBe(resolveRole('image.generate')?.key)
    expect(images[0].prompt.startsWith(KEYFRAME_STYLE_REFERENCE_PREFIX)).toBe(false)
    for (const [i, call] of images.slice(1).entries()) {
      expect(call.customModel).toBe(resolveRole('image.edit')?.key)
      expect(call.prompt.startsWith(KEYFRAME_STYLE_REFERENCE_PREFIX)).toBe(true)
      expect(call.contents).toEqual([
        { imageUrl: path.join(root, `long_take/keyframes/f${i}.png`), type: 'image_url' },
      ])
    }

    expect(result.frames.map((f) => f.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'])
    expect(result.frames[4]).toMatchObject({ copyOf: 'f0' })
    expect(fs.readFileSync(result.frames[4].uri)).toEqual(fs.readFileSync(result.frames[0].uri))
  })

  it('writes keyframes.json and shot_plan.json for the render and the editor', async () => {
    const result = await generateBeatLoopKeyframes(params)
    const keyframes = json.get(result.keyframesPath) as { keyframeUrl: string; shotId: string }[]
    expect(result.keyframesPath).toBe('long_take/keyframes.json')
    expect(keyframes.map((k) => k.shotId)).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(keyframes[1]).toMatchObject({
      finalPrompt: images[1].prompt,
      hasGibberish: false,
      keyframeUrl: path.join(root, 'long_take/keyframes/f1.png'),
    })
    const plan = json.get(result.shotPlanPath) as {
      audio: string
      shot_id: string
      time_range: { end: number; start: number }
      video_prompt: string
    }[]
    expect(result.shotPlanPath).toBe('long_take/shot_plan.json')
    expect(plan.map((s) => [s.shot_id, s.time_range])).toEqual([
      ['f0', { end: 4, start: 0 }],
      ['f1', { end: 8, start: 4 }],
      ['f2', { end: 12, start: 8 }],
      ['f3', { end: 16, start: 12 }],
    ])
    expect(plan[2].audio).toBe(storyboard.clips[2].narration)
    expect(plan[0].video_prompt.endsWith('non_diegetic_music: N/A')).toBe(true)
  })

  it('re-rolls a frame with text once, and the next frame is edited from the re-roll', async () => {
    textVerdicts['f1'] = [{ detail: '"1969" on a sign', hasText: true }, { hasText: false }]
    const result = await generateBeatLoopKeyframes(params)
    expect(images.map((call) => call.shotId)).toEqual(['f0', 'f1', 'f1', 'f2', 'f3'])
    expect(result.frames[1].textCheck).toEqual({ hasText: false, rerolled: true })
    expect(images[3].contents[0].imageUrl).toBe(path.join(root, 'long_take/keyframes/f1.png'))
    expect(fs.readFileSync(result.frames[1].uri)).toEqual(
      fs.readFileSync(path.join(root, 'generated', '3.png')),
    )
  })

  it('keeps a frame that still has text after its re-roll, and flags it', async () => {
    textVerdicts['f2'] = [
      { detail: 'a label', hasText: true },
      { detail: 'a label', hasText: true },
    ]
    const result = await generateBeatLoopKeyframes(params)
    expect(images.filter((call) => call.shotId === 'f2')).toHaveLength(2)
    expect(result.frames[2].textCheck).toEqual({
      detail: 'a label',
      hasText: true,
      rerolled: true,
    })
    const keyframes = json.get(result.keyframesPath) as { hasGibberish: boolean }[]
    expect(keyframes[2].hasGibberish).toBe(true)
  })

  it('writes the frames for Omni without newsprint when Google makes the videos', async () => {
    setGenerationProvider('google')
    await generateBeatLoopKeyframes(params)
    expect(images.every((call) => !/newsprint/i.test(call.prompt))).toBe(true)
    expect(images[0].customModel).toBe(resolveRole('image.generate')?.key)
  })

  it('reuses the frames already made for the same storyboard (a resumed run)', async () => {
    const first = await generateBeatLoopKeyframes(params)
    images.length = 0
    const again = await generateBeatLoopKeyframes(params)
    expect(images).toHaveLength(0)
    expect(again.frames).toEqual(first.frames)
    expect([first.reused, again.reused]).toEqual([false, true])
  })

  it('reuses the frames in the dialect they were made in, whichever model the clips use now', async () => {
    // Made for H3 (fal), with newsprint; Setup picks Google (Omni) now.
    const first = await generateBeatLoopKeyframes(params)
    images.length = 0
    setGenerationProvider('google')
    const again = await generateBeatLoopKeyframes(params)
    expect(images).toHaveLength(0)
    expect(again.reused).toBe(true)
    expect(again.frames).toEqual(first.frames)
    expect(again.frames[0].prompt).toMatch(/newsprint/)
    expect(json.get('long_take/beat_loop_keyframes.json')).toMatchObject({ dialect: 'h3' })
  })

  it("never makes the frames again over a record it can't read: every clip would start over", async () => {
    await generateBeatLoopKeyframes(params)
    images.length = 0
    json.set('long_take/beat_loop_keyframes.json', CORRUPT)

    await expect(generateBeatLoopKeyframes(params)).rejects.toThrow(
      /beat_loop_keyframes\.json can't be read: Unexpected end of JSON input/,
    )
    expect(images).toHaveLength(0)
    expect(json.get('long_take/beat_loop_keyframes.json')).toBe(CORRUPT)
  })

  it('starts the stored clips over before it writes a frame over the ones they were made on', async () => {
    await generateBeatLoopKeyframes(params)
    // Clip 1 was kept on these frames; then the frames' record was lost.
    const kept = {
      clipId: 's1',
      clipIndex: 0,
      flagged: false,
      keptTake: 1,
      takes: [{ spend: { estimatedUsd: 0.16 }, take: 1 }],
    }
    json.set(BEAT_LOOP_QA_PATH, {
      clips: [kept],
      spend: { estimatedUsd: 0.16, takes: 1 },
      version: 1,
    })
    json.delete('long_take/beat_loop_keyframes.json')
    failNext.add('f1')

    // The run stops after f0 was made again: clip 1 must not be reused on the next try.
    await expect(
      generateBeatLoopKeyframes({ ...params, restartGenerations: [2, 2, 2, 2] }),
    ).rejects.toThrow('failed on f1')
    const record = json.get(BEAT_LOOP_QA_PATH) as { clips: Record<string, unknown>[] }
    expect(record.clips).toEqual([
      {
        clipId: 's1',
        clipIndex: 0,
        generation: 2,
        takes: [{ spend: { estimatedUsd: 0.16 }, take: 1 }],
      },
    ])

    // The retry goes on from f1 and leaves the clips at the generation they were moved to.
    await generateBeatLoopKeyframes({ ...params, restartGenerations: [2, 2, 2, 2] })
    expect((json.get(BEAT_LOOP_QA_PATH) as typeof record).clips[0]).toMatchObject({ generation: 2 })
  })

  it('leaves the stored clips alone when it reuses every frame', async () => {
    await generateBeatLoopKeyframes(params)
    const kept = {
      clipId: 's1',
      clipIndex: 0,
      flagged: false,
      keptTake: 1,
      takes: [{ spend: { estimatedUsd: 0.16 }, take: 1 }],
    }
    json.set(BEAT_LOOP_QA_PATH, {
      clips: [kept],
      spend: { estimatedUsd: 0.16, takes: 1 },
      version: 1,
    })

    const again = await generateBeatLoopKeyframes({ ...params, restartGenerations: [2, 2, 2, 2] })

    expect(again.reused).toBe(true)
    expect((json.get(BEAT_LOOP_QA_PATH) as { clips: unknown[] }).clips).toEqual([kept])
  })

  it('saves each frame as it is made, so a retry goes on from the last good frame', async () => {
    failNext.add('f2')
    await expect(generateBeatLoopKeyframes(params)).rejects.toThrow('failed on f2')
    expect(images.map((call) => call.shotId)).toEqual(['f0', 'f1'])
    const kept = fs.readFileSync(path.join(root, 'long_take/keyframes/f1.png'))

    images.length = 0
    const retried = await generateBeatLoopKeyframes(params)
    expect(images.map((call) => call.shotId)).toEqual(['f2', 'f3'])
    expect(images[0].contents).toEqual([
      { imageUrl: path.join(root, 'long_take/keyframes/f1.png'), type: 'image_url' },
    ])
    expect(fs.readFileSync(retried.frames[1].uri)).toEqual(kept)
    expect(retried.frames.map((frame) => frame.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'])
    expect(retried.reused).toBe(false)
  })

  it('makes the frames again from the first one whose prompt changed', async () => {
    await generateBeatLoopKeyframes(params)
    images.length = 0
    const changed = {
      ...storyboard,
      keyframes: storyboard.keyframes.map((keyframe) =>
        keyframe.id === 'f2' ? { ...keyframe, prompt: 'NEW SHOT: a sphinx at dusk.' } : keyframe,
      ),
    }
    const again = await generateBeatLoopKeyframes({ ...params, storyboard: changed })
    expect(images.map((call) => call.shotId)).toEqual(['f2', 'f3'])
    expect(again.reused).toBe(false)
  })
})
