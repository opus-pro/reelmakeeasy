import sharp from 'sharp'

import { imageSizeOf } from '../frame-fit'
import { GoogleApiError } from '../google'
import { createModelResolver } from '../registry/resolve'
import { parseModelRegistry } from '../registry/schema'
import { rawDefaults } from '../registry/test-helpers'

import {
  buildOmniRequest,
  buildVeoRequest,
  omniSourcesTag,
  prepareGoogleVideoFrames,
  veoVideoUri,
} from './google-video'

const resolver = createModelResolver(parseModelRegistry(rawDefaults()), {
  generationProvider: () => 'google',
})
// Veo is no longer the default on google (Omni Flash is), so it is picked by name.
const veo = resolver.resolveVideoForFrames('veo-3.1-fast-google', { end: 'e', start: 's' })
const omni = resolver.resolveModel('video', 'omni-flash-google', {
  mode: 'firstLast',
  role: 'video.firstLast',
})
const START = 'data:image/png;base64,U1RBUlQ='
const END = 'data:image/png;base64,RU5E'
const params = (body: Record<string, unknown>) =>
  body['parameters'] as { durationSeconds: number; resolution: string }

/** The GoogleApiError a call throws. */
function thrown(call: () => unknown): GoogleApiError {
  try {
    call()
  } catch (error) {
    if (error instanceof GoogleApiError) return error
    throw error
  }
  throw new Error('expected a GoogleApiError')
}

describe('Veo on the Gemini API', () => {
  it('animates first to last frame as an 8 s clip, with frames as bytesBase64Encoded', () => {
    const r = buildVeoRequest(veo, 'firstLast', {
      aspectRatio: '9:16',
      durationSeconds: 5,
      endImageUrl: END,
      prompt: 'dolly in',
      startImageUrl: START,
    })
    expect(r.model).toBe('veo-3.1-fast-generate-preview')
    expect(r.body).toEqual({
      instances: [
        {
          image: { bytesBase64Encoded: 'U1RBUlQ=', mimeType: 'image/png' },
          lastFrame: { bytesBase64Encoded: 'RU5E', mimeType: 'image/png' },
          prompt: 'dolly in',
        },
      ],
      parameters: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p' },
    })
  })

  it('makes first-to-last clips 8 s long whatever length was asked, since the API refuses shorter ones', () => {
    const firstLast = (durationSeconds: number, resolution?: string) =>
      params(
        buildVeoRequest(veo, 'firstLast', {
          durationSeconds,
          endImageUrl: END,
          prompt: 'p',
          resolution,
          startImageUrl: START,
        }).body,
      )
    expect(firstLast(4).durationSeconds).toBe(8)
    expect(firstLast(6, '1080p')).toEqual({ durationSeconds: 8, resolution: '1080p' })
    expect(
      params(
        buildVeoRequest(veo, 'image', { durationSeconds: 4, prompt: 'p', startImageUrl: START })
          .body,
      ).durationSeconds,
    ).toBe(4)
  })

  it.each([
    [3, 4],
    [7, 8],
    [12, 8],
  ])('snaps %d s to %d s', (asked, sent) => {
    expect(
      params(buildVeoRequest(veo, 'text', { durationSeconds: asked, prompt: 'p' }).body)
        .durationSeconds,
    ).toBe(sent)
  })

  it('makes 1080p only for 8-second clips', () => {
    const at = (d: number, resolution: string) =>
      params(buildVeoRequest(veo, 'text', { durationSeconds: d, prompt: 'p', resolution }).body)
        .resolution
    expect(at(8, '1080p')).toBe('1080p')
    expect(at(4, '1080p')).toBe('720p')
    expect(at(8, '768p')).toBe('720p')
  })

  it('says what to avoid in the prompt (Veo 3.1 Lite refuses negativePrompt), and refuses reference mode', () => {
    const r = buildVeoRequest(veo, 'image', {
      durationSeconds: 4,
      negativePrompt: ' text overlays ',
      prompt: 'p',
      startImageUrl: START,
    })
    expect(r.body).toEqual({
      instances: [
        {
          image: { bytesBase64Encoded: 'U1RBUlQ=', mimeType: 'image/png' },
          prompt: 'p\n\nAvoid: text overlays',
        },
      ],
      parameters: { durationSeconds: 4, resolution: '720p' },
    })
    expect(() => buildVeoRequest(veo, 'reference', { prompt: 'p' })).toThrow(/reference pictures/)
  })

  it('reads the clip URI, and turns a filtered clip into a policy block', () => {
    expect(
      veoVideoUri({
        done: true,
        name: 'op',
        response: {
          generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v' } }] },
        },
      }),
    ).toBe('https://v')
    const filtered = (reasons: string[]) =>
      thrown(() =>
        veoVideoUri({
          done: true,
          name: 'op',
          response: {
            generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: reasons },
          },
        }),
      )
    expect(filtered(['audio was flagged'])).toMatchObject({ providerCode: 'policy_blocked' })
    expect(filtered(['The input image violates our policies'])).toMatchObject({
      providerCode: 'policy_blocked_image',
    })
    expect(thrown(() => veoVideoUri({ done: true, name: 'op', response: {} }))).toMatchObject({
      providerCode: 'no_output',
    })
  })
})

describe('Omni Flash on the Gemini API', () => {
  it('sends both frames, then the prompt, and asks for a 3 s clip as a file URI (stored, as URI delivery needs)', () => {
    const r = buildOmniRequest(omni, 'firstLast', {
      aspectRatio: '9:16',
      durationSeconds: 2,
      endImageUrl: END,
      negativePrompt: 'text overlays',
      prompt: 'morph',
      startImageUrl: START,
    })
    expect(r.model).toBe('gemini-omni-1.1-flash')
    expect(r.body).toEqual({
      input: [
        { data: 'U1RBUlQ=', mime_type: 'image/png', type: 'image' },
        { data: 'RU5E', mime_type: 'image/png', type: 'image' },
        { text: 'morph\n\nAvoid: text overlays', type: 'text' },
      ],
      model: 'gemini-omni-1.1-flash',
      response_format: {
        aspect_ratio: '9:16',
        delivery: 'uri',
        duration: '3s',
        resolution: '720p',
        type: 'video',
      },
      store: true,
    })
  })

  it("asks for the clip's own length to the nearest second, from 3 to 10 s, never Veo's 8 s", () => {
    const seconds = (durationSeconds?: number) =>
      (
        buildOmniRequest(omni, 'firstLast', {
          durationSeconds,
          endImageUrl: END,
          prompt: 'p',
          startImageUrl: START,
        }).body['response_format'] as { duration: string }
      ).duration
    expect([5, 5.2, 5.6, 4.4, 7, 9.5].map(seconds)).toEqual(['5s', '5s', '6s', '4s', '7s', '10s'])
    expect([1.5, 12].map(seconds)).toEqual(['3s', '10s'])
    expect(seconds(undefined)).toBe('10s')
  })
})

describe('exact clip lengths on the Gemini API', () => {
  it('makes Veo first-to-last clips only at 8 s, so an exact 4 s one is refused', () => {
    const firstLast = (exactDurationSeconds: number) =>
      buildVeoRequest(veo, 'firstLast', {
        endImageUrl: END,
        exactDurationSeconds,
        prompt: 'p',
        startImageUrl: START,
      })
    expect(() => firstLast(4)).toThrow(
      'Model "veo-3.1-fast-google" can\'t make a first-to-last clip of exactly 4 s: with a last frame it makes 8 s only',
    )
    expect(params(firstLast(8).body).durationSeconds).toBe(8)
    const image = (exactDurationSeconds: number) =>
      buildVeoRequest(veo, 'image', { exactDurationSeconds, prompt: 'p', startImageUrl: START })
    expect(params(image(4).body).durationSeconds).toBe(4)
    expect(() => image(5)).toThrow(/exactly 5 s: it makes 4, 6 or 8 s/)
  })

  it('refuses an Omni length that is not a whole second from 3 to 10', () => {
    expect(() =>
      buildOmniRequest(omni, 'firstLast', {
        endImageUrl: END,
        exactDurationSeconds: 4.5,
        prompt: 'p',
        startImageUrl: START,
      }),
    ).toThrow(
      'Model "omni-flash-google" can\'t make a clip of exactly 4.5 s: it makes whole seconds from 3 to 10',
    )
  })
})

describe('Omni Flash loop clips', () => {
  const SOURCES = '[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]'
  const BODY = 'A 4-second vertical short-form clip.\n\nnon_diegetic_music: N/A'
  const LOOP_PROMPT = `${SOURCES}\n${BODY}`
  const text = (r: ReturnType<typeof buildOmniRequest>) =>
    (r.body['input'] as { text?: string }[]).at(-1)?.text

  it('asks for exactly 4 s at 720p with the Sources tag first and the music line last; sound is always on', () => {
    expect(
      buildOmniRequest(omni, 'firstLast', {
        aspectRatio: '9:16',
        durationSeconds: 3.6,
        endImageUrl: END,
        exactDurationSeconds: 4,
        generateAudio: false,
        prompt: LOOP_PROMPT,
        startImageUrl: START,
      }).body,
    ).toEqual({
      input: [
        { data: 'U1RBUlQ=', mime_type: 'image/png', type: 'image' },
        { data: 'RU5E', mime_type: 'image/png', type: 'image' },
        { text: LOOP_PROMPT, type: 'text' },
      ],
      model: 'gemini-omni-1.1-flash',
      response_format: {
        aspect_ratio: '9:16',
        delivery: 'uri',
        duration: '4s',
        resolution: '720p',
        type: 'video',
      },
      store: true,
    })
  })

  it('names only the pictures it sends in the Sources tag', () => {
    expect(omniSourcesTag(2)).toBe(SOURCES)
    expect(omniSourcesTag(1)).toBe('[# Sources <FIRST_FRAME>@Image1]')
    expect(omniSourcesTag(0)).toBe('')
    expect(
      text(buildOmniRequest(omni, 'image', { prompt: LOOP_PROMPT, startImageUrl: START })),
    ).toBe(`[# Sources <FIRST_FRAME>@Image1]\n${BODY}`)
    expect(text(buildOmniRequest(omni, 'text', { prompt: LOOP_PROMPT }))).toBe(BODY)
  })

  it('leaves a prompt without the tag as it is', () => {
    expect(
      text(
        buildOmniRequest(omni, 'firstLast', {
          endImageUrl: END,
          prompt: BODY,
          startImageUrl: START,
        }),
      ),
    ).toBe(BODY)
  })

  it('says what to avoid before the music line, which stays last', () => {
    expect(
      text(
        buildOmniRequest(omni, 'firstLast', {
          endImageUrl: END,
          negativePrompt: 'text',
          prompt: LOOP_PROMPT,
          startImageUrl: START,
        }),
      ),
    ).toBe(
      `${SOURCES}\nA 4-second vertical short-form clip.\n\nAvoid: text\n\nnon_diegetic_music: N/A`,
    )
  })
})

describe('Gemini clip frames', () => {
  async function png(width: number, height: number): Promise<string> {
    const buffer = await sharp({
      create: { background: { b: 40, g: 120, r: 200 }, channels: 3, height, width },
    })
      .png()
      .toBuffer()
    return `data:image/png;base64,${buffer.toString('base64')}`
  }

  it('crops an Omni keyframe and a carried H3 frame to 9:16 and scales both to 720x1280', async () => {
    const frames = await prepareGoogleVideoFrames(
      omni,
      { endImageUrl: await png(768, 1376), startImageUrl: await png(768, 1344) },
      { resolution: '768p' },
    )
    expect(await imageSizeOf(frames.startImageUrl ?? '')).toEqual({ height: 1280, width: 720 })
    expect(await imageSizeOf(frames.endImageUrl ?? '')).toEqual({ height: 1280, width: 720 })
  })

  it('fits landscape frames to 1280x720 and leaves a frame of the right size untouched', async () => {
    const start = await png(1280, 720)
    const frames = await prepareGoogleVideoFrames(omni, {
      endImageUrl: await png(1376, 768),
      startImageUrl: start,
    })
    expect(frames.startImageUrl).toBe(start)
    expect(await imageSizeOf(frames.endImageUrl ?? '')).toEqual({ height: 720, width: 1280 })
  })

  it('sends frames it cannot read, and every Veo frame, as they are', async () => {
    const asked = { endImageUrl: END, startImageUrl: START }
    expect(await prepareGoogleVideoFrames(omni, asked)).toEqual(asked)
    const keyframe = { startImageUrl: await png(768, 1376) }
    expect(await prepareGoogleVideoFrames(veo, keyframe)).toEqual(keyframe)
  })
})
