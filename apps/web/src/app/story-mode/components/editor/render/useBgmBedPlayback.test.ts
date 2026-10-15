import { renderHook } from '@testing-library/react'

import { loopPreviewMedia, useLoopSfxBedPlayback } from './loopPreview'
import {
  BED_DRIFT_TOLERANCE_MS,
  resolveBedSyncAction,
  resolveBedVolume,
  useBgmBedPlayback,
} from './useBgmBedPlayback'

describe('resolveBedSyncAction', () => {
  it('seeks and plays a paused bed when the engine is playing', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 0,
        audioPaused: true,
        engineMs: 4200,
        shouldPlay: true,
      }),
    ).toBe('seek-and-play')
  })

  it('leaves an in-sync playing bed alone', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 4100,
        audioPaused: false,
        engineMs: 4200,
        shouldPlay: true,
      }),
    ).toBe('none')
  })

  it('snaps a playing bed that drifted past the tolerance', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 4200 + BED_DRIFT_TOLERANCE_MS + 1,
        audioPaused: false,
        engineMs: 4200,
        shouldPlay: true,
      }),
    ).toBe('seek')
  })

  it('tolerates drift exactly at the boundary', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 4200 + BED_DRIFT_TOLERANCE_MS,
        audioPaused: false,
        engineMs: 4200,
        shouldPlay: true,
      }),
    ).toBe('none')
  })

  it('pauses the bed when the engine stops', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 4200,
        audioPaused: false,
        engineMs: 4200,
        shouldPlay: false,
      }),
    ).toBe('pause')
  })

  it('follows scrubbing while parked so resume starts at the playhead', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 0,
        audioPaused: true,
        engineMs: 9000,
        shouldPlay: false,
      }),
    ).toBe('seek')
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 9000,
        audioPaused: true,
        engineMs: 9000,
        shouldPlay: false,
      }),
    ).toBe('none')
  })
})

describe('resolveBedSyncAction on a loop', () => {
  const loopMs = 32_000

  it("doesn't re-seek a bed that wrapped a moment before or after the engine", () => {
    // The bed repeats on its own: 50 ms into its next pass while the engine ends this one.
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 50,
        audioPaused: false,
        engineMs: 31_950,
        loopMs,
        shouldPlay: true,
      }),
    ).toBe('none')
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 31_950,
        audioPaused: false,
        engineMs: 40,
        loopMs,
        shouldPlay: true,
      }),
    ).toBe('none')
  })

  it('still snaps a bed that drifted within the loop', () => {
    expect(
      resolveBedSyncAction({
        audioCurrentMs: 16_000,
        audioPaused: false,
        engineMs: 0,
        loopMs,
        shouldPlay: true,
      }),
    ).toBe('seek')
  })
})

/** The audio elements the hook made (jsdom can't play): what it set on them. */
class FakeAudio {
  static made: FakeAudio[] = []
  crossOrigin: null | string = null
  currentTime = 0
  loop = false
  paused = true
  pause = jest.fn(() => {
    this.paused = true
  })
  play = jest.fn(() => {
    this.paused = false
    return Promise.resolve()
  })
  preload = ''
  volume = 1
  constructor(readonly src: string) {
    FakeAudio.made.push(this)
  }
}

describe('useBgmBedPlayback', () => {
  const realAudio = globalThis.Audio
  beforeEach(() => {
    FakeAudio.made = []
    globalThis.Audio = FakeAudio as unknown as typeof Audio
  })
  afterAll(() => {
    globalThis.Audio = realAudio
  })

  type Params = Parameters<typeof useBgmBedPlayback>[0]
  const bed = (initial: Params) =>
    renderHook((params: Params) => useBgmBedPlayback(params), { initialProps: initial })
  const LOOP: Params = {
    bedGainDb: null,
    enabled: true,
    engineMs: 0,
    loopMs: 32_000,
    playing: false,
    url: 'http://localhost:5017/api/files/p1/long_take/beat_loop_sfx.m4a?v=7',
    volume: 35,
  }

  it("plays a loop's bed on a loop, at its volume", () => {
    bed(LOOP)
    const [audio] = FakeAudio.made
    expect(audio.src).toBe(LOOP.url)
    expect(audio.loop).toBe(true)
    expect(audio.volume).toBeCloseTo(0.35)
  })

  it('plays any other bed once', () => {
    bed({ ...LOOP, loopMs: undefined })
    expect(FakeAudio.made[0].loop).toBe(false)
  })

  it('starts, follows and stops with the engine, and starts again from the top when the engine wraps', () => {
    const { rerender } = bed(LOOP)
    const [audio] = FakeAudio.made
    rerender({ ...LOOP, engineMs: 4200, playing: true })
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.currentTime).toBeCloseTo(4.2)

    // The engine reports the loop's end (its last time) and goes on from 0; the bed had stopped.
    audio.paused = true
    rerender({ ...LOOP, engineMs: 32_000, playing: true })
    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalledTimes(2)

    rerender({ ...LOOP, engineMs: 1000, playing: false })
    expect(audio.pause).toHaveBeenCalled()
    // One element the whole time.
    expect(FakeAudio.made).toHaveLength(1)
  })
})

describe('resolveBedVolume', () => {
  it('maps the slider linearly without a measured gain', () => {
    expect(resolveBedVolume(50)).toBe(0.5)
    expect(resolveBedVolume(140)).toBe(1)
    expect(resolveBedVolume(-5)).toBe(0)
  })

  it('follows the export duck curve with a measured bed-to-voice gain', () => {
    // Volume 90 is a 4 dB duck: a bed measured 1.13 dB under the voice plays at
    // 10^((1.13 - 4) / 20) of full scale, as the download mixes it.
    expect(resolveBedVolume(90, 1.13)).toBeCloseTo(10 ** ((1.13 - 4) / 20), 5)
    expect(resolveBedVolume(0, 1.13)).toBe(0)
  })
})

describe("a loop's clip sound beside its music", () => {
  const realAudio = globalThis.Audio
  beforeEach(() => {
    FakeAudio.made = []
    globalThis.Audio = FakeAudio as unknown as typeof Audio
  })
  afterAll(() => {
    globalThis.Audio = realAudio
  })

  const FILES = 'https://files/p1/long_take'
  const loop = loopPreviewMedia({
    loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=2`,
    loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a?v=3`,
    loopSfxBedVolume: 35.1,
  })
  // The editor and the chat play both: the music bed (when on) and the loop's clip sound bed.
  const both = (music: { enabled: boolean; volume: number }, clipSound = loop) =>
    renderHook(() => {
      useBgmBedPlayback({
        bedGainDb: 1.13,
        enabled: music.enabled,
        engineMs: 0,
        playing: false,
        url: music.enabled ? `${FILES}/bgm_bed.m4a?v=1` : null,
        volume: music.volume,
      })
      useLoopSfxBedPlayback({ engineMs: 0, loop: clipSound, playing: false, totalMs: 32_000 })
    })

  it("plays a loop's clip sound once, at its own linear level, whatever the music does", () => {
    both({ enabled: true, volume: 90 })
    const sfx = FakeAudio.made.filter((audio) => audio.src.includes('beat_loop_sfx'))
    expect(sfx).toHaveLength(1)
    expect(sfx[0].volume).toBeCloseTo(0.351, 5)
    // The music plays in addition, at its Volume on the export's duck curve.
    const music = FakeAudio.made.filter((audio) => audio.src.includes('bgm_bed'))
    expect(music).toHaveLength(1)
    expect(music[0].volume).toBeCloseTo(10 ** ((1.13 - 4) / 20), 5)

    FakeAudio.made = []
    both({ enabled: false, volume: 90 })
    expect(FakeAudio.made.map((audio) => audio.src)).toEqual([`${FILES}/beat_loop_sfx.m4a?v=3`])
    expect(FakeAudio.made[0].volume).toBeCloseTo(0.351, 5)
  })

  it('plays no clip sound for other videos, or a loop whose bed is not there yet', () => {
    expect(loopPreviewMedia(null)).toBeNull()
    expect(
      loopPreviewMedia({
        loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=2`,
        loopSfxBedUrl: undefined,
        loopSfxBedVolume: 35,
      }),
    ).toBeNull()
    both({ enabled: true, volume: 50 }, null)
    expect(FakeAudio.made.map((audio) => audio.src)).toEqual([`${FILES}/bgm_bed.m4a?v=1`])
  })
})
