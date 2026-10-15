import type { LongTakeStatus } from '@shared/types/api/long-take'
import { act, renderHook } from '@testing-library/react'

import { useLongTakeArtifacts } from './useLongTakeArtifacts'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

const BED = 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_sfx.m4a?v=7'
const CLIPS = 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_clips.mp4?v=6'

// A delivered loop: the status stops being polled here unless something is still coming.
const delivered: LongTakeStatus = {
  loopClipsUrl: null,
  loopSfxBedPending: false,
  loopSfxBedUrl: null,
  loopSfxBedVolume: null,
  stage: 'completed',
  status: 'completed',
  videoUrl: 'http://localhost:5017/api/files/projects/p1/final_video.mp4',
} as LongTakeStatus

/** Answers each status read with the next status (the last one again once they run out). */
function answer(...statuses: LongTakeStatus[]) {
  let read = 0
  mockFetchApiDomain.mockImplementation(async () => {
    const data = statuses[Math.min(read, statuses.length - 1)]
    read += 1
    return { data: { data }, ok: true }
  })
}

/** One poll interval later, with the read it started answered. */
async function nextRead() {
  await act(async () => {
    jest.advanceTimersByTime(5000)
  })
}

describe('useLongTakeArtifacts', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchApiDomain.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  it("keeps reading a delivered loop's status while its clip sound bed is built, and gets the bed", async () => {
    answer(
      { ...delivered, loopSfxBedPending: true },
      { ...delivered, loopSfxBedPending: true },
      { ...delivered, loopClipsUrl: CLIPS, loopSfxBedUrl: BED, loopSfxBedVolume: 35 },
    )
    const { result } = renderHook(() => useLongTakeArtifacts('p1'))
    await act(async () => undefined)
    expect(result.current.status?.loopSfxBedPending).toBe(true)

    await nextRead()
    await nextRead()
    expect(result.current.status).toMatchObject({
      loopClipsUrl: CLIPS,
      loopSfxBedPending: false,
      loopSfxBedUrl: BED,
      loopSfxBedVolume: 35,
    })

    // Nothing more is coming: the reads stop.
    await nextRead()
    await nextRead()
    expect(mockFetchApiDomain).toHaveBeenCalledTimes(3)
  })

  it("takes a status whose loop's joined clips alone changed", async () => {
    const withBed = { ...delivered, loopClipsUrl: CLIPS, loopSfxBedUrl: BED, loopSfxBedVolume: 35 }
    const newClips = `${CLIPS.split('?')[0]}?v=9`
    answer(withBed, { ...withBed, loopClipsUrl: newClips })
    const { result } = renderHook(() => useLongTakeArtifacts('p1', true))
    await act(async () => undefined)
    expect(result.current.status?.loopClipsUrl).toBe(CLIPS)

    await nextRead()
    expect(result.current.status?.loopClipsUrl).toBe(newClips)
  })

  it("takes a status whose loop's flagged clips alone changed (a clip made again)", async () => {
    const flagged = { ...delivered, meta: { beatLoopClips: 6, beatLoopFlaggedClips: 's2' } }
    answer(flagged, { ...delivered, meta: { beatLoopClips: 6 } })
    const { result } = renderHook(() => useLongTakeArtifacts('p1', true))
    await act(async () => undefined)
    expect(result.current.status?.meta?.beatLoopFlaggedClips).toBe('s2')

    await nextRead()
    expect(result.current.status?.meta?.beatLoopFlaggedClips).toBeUndefined()
  })

  it('stops at a delivered video with no bed coming, as before', async () => {
    answer(delivered)
    renderHook(() => useLongTakeArtifacts('p1'))
    await act(async () => undefined)
    await nextRead()
    await nextRead()
    expect(mockFetchApiDomain).toHaveBeenCalledTimes(1)
  })
})
