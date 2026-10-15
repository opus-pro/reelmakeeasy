import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { renderHook } from '@testing-library/react'

import { loopClipsMatchState, loopPreviewMedia, useLoopSfxBedPlayback } from './loopPreview'
import { useBgmBedPlayback } from './useBgmBedPlayback'

jest.mock('./useBgmBedPlayback', () => ({ useBgmBedPlayback: jest.fn() }))

const FILES = 'http://localhost:5017/api/files/projects/p1/long_take'

/** A loop's clip in its state, as the state is served (file URLs). */
const stateClip = (k: number, file = `s${k + 1}.mp4`) => ({
  endMs: (k + 1) * 4000,
  startMs: k * 4000,
  videoUri: `${FILES}/transitions/${file}`,
})

/** The video script a loop's render saved: its media track names the clips it joined. */
const scriptOf = (...files: string[]) =>
  ({
    tracks: [
      {
        id: 'track-media',
        segments: files.map((file, k) => ({
          content: {
            resourceType: 'video',
            sourceUri: `store://projects/p1/long_take/transitions/${file}`,
          },
          id: `segment-long-take-${k}`,
          timeline: { in: k * 4000, out: (k + 1) * 4000 },
        })),
        type: 'media',
      },
      { id: 'track-facts', segments: [], type: 'facts' },
    ],
  }) as unknown as VideoScript

describe('loopPreviewMedia', () => {
  it("plays a loop's clip sound bed at its volume, over the joined clips its status names", () => {
    expect(
      loopPreviewMedia({
        loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=1760000000000100`,
        loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a?v=1760000000000300`,
        loopSfxBedVolume: 35,
      }),
    ).toEqual({
      bedUrl: `${FILES}/beat_loop_sfx.m4a?v=1760000000000300`,
      bedVolume: 35,
      // As the status gives it, keyed to the clips' own file.
      clipsUrl: `${FILES}/beat_loop_clips.mp4?v=1760000000000100`,
    })
    expect(
      loopPreviewMedia({
        loopClipsUrl: `${FILES}/beat_loop_clips.mp4`,
        loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a`,
        loopSfxBedVolume: 0,
      }),
    ).toMatchObject({ bedVolume: 0, clipsUrl: `${FILES}/beat_loop_clips.mp4` })
  })

  it('has nothing to play without a bed: any other video, or a loop whose bed is missing or stale', () => {
    expect(loopPreviewMedia(null)).toBeNull()
    expect(
      loopPreviewMedia({ loopClipsUrl: null, loopSfxBedUrl: null, loopSfxBedVolume: null }),
    ).toBeNull()
    expect(
      loopPreviewMedia({
        loopClipsUrl: `${FILES}/beat_loop_clips.mp4`,
        loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a`,
        loopSfxBedVolume: null,
      }),
    ).toBeNull()
    // No joined clips named: the bed has no picture to play beside (not guessed from its URL).
    expect(
      loopPreviewMedia({
        loopClipsUrl: null,
        loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a`,
        loopSfxBedVolume: 35,
      }),
    ).toBeNull()
    expect(
      loopPreviewMedia({ loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a`, loopSfxBedVolume: 35 }),
    ).toBeNull()
  })
})

describe('loopClipsMatchState', () => {
  it('matches when the clips in the state are the ones the last render joined, wherever each is served from', () => {
    // Served as file URLs, saved as store:// URIs, in any order.
    expect(loopClipsMatchState([stateClip(1), stateClip(0)], scriptOf('s1.mp4', 's2.mp4'))).toBe(
      true,
    )
    // A render reads from the current bucket, whatever bucket the state names; a version
    // query is not part of the file.
    expect(
      loopClipsMatchState(
        [
          {
            ...stateClip(0),
            videoUri: 'store://old-bucket/projects/p1/long_take/transitions/s1.mp4',
          },
          { ...stateClip(1), videoUri: `${FILES}/transitions/s2.mp4?v=3` },
        ],
        scriptOf('s1.mp4', 's2.mp4'),
      ),
    ).toBe(true)
  })

  it('does not when a clip in the state is another take (another file)', () => {
    expect(
      loopClipsMatchState(
        [stateClip(0), stateClip(1, 's2_take2.mp4')],
        scriptOf('s1.mp4', 's2.mp4'),
      ),
    ).toBe(false)
    // Lip sync picks the clip the render would: the base clip when it is off.
    expect(
      loopClipsMatchState(
        [
          stateClip(0),
          {
            ...stateClip(1, 's2_lipsync.mp4'),
            baseVideoUri: `${FILES}/transitions/s2_take2.mp4`,
            lipSyncEnabled: false,
            lipSyncVideoUri: `${FILES}/transitions/s2_lipsync.mp4`,
          },
        ],
        scriptOf('s1.mp4', 's2.mp4'),
      ),
    ).toBe(false)
  })

  it('does not without both to compare: no state, no script, no clips, or another count', () => {
    expect(loopClipsMatchState(undefined, scriptOf('s1.mp4'))).toBe(false)
    expect(loopClipsMatchState([stateClip(0)], undefined)).toBe(false)
    expect(loopClipsMatchState([], scriptOf())).toBe(false)
    expect(loopClipsMatchState([stateClip(0)], { tracks: [] } as unknown as VideoScript)).toBe(
      false,
    )
    expect(loopClipsMatchState([stateClip(0)], scriptOf('s1.mp4', 's2.mp4'))).toBe(false)
  })
})

describe('useLoopSfxBedPlayback', () => {
  beforeEach(() => jest.mocked(useBgmBedPlayback).mockClear())

  it('plays the bed beside the engine on a loop of its length, at its volume as measured', () => {
    const loop = loopPreviewMedia({
      loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=6`,
      loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a?v=7`,
      loopSfxBedVolume: 35,
    })
    renderHook(() =>
      useLoopSfxBedPlayback({ engineMs: 1200, loop, playing: true, totalMs: 32_000 }),
    )
    expect(useBgmBedPlayback).toHaveBeenLastCalledWith({
      // Not the music's duck curve: the bed's volume maps linearly, as it was measured.
      bedGainDb: null,
      enabled: true,
      engineMs: 1200,
      loopMs: 32_000,
      playing: true,
      url: `${FILES}/beat_loop_sfx.m4a?v=7`,
      volume: 35,
    })
  })

  it('plays nothing for any other video', () => {
    renderHook(() =>
      useLoopSfxBedPlayback({ engineMs: 0, loop: null, playing: true, totalMs: 32_000 }),
    )
    expect(useBgmBedPlayback).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, url: null }),
    )
  })
})
