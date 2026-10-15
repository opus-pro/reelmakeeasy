import type { LongTakeStatus } from '@shared/types/api/long-take'
import { renderHook } from '@testing-library/react'

import { useLongTakeArtifacts } from '@/app/long-take/hooks/useLongTakeArtifacts'

import { usePolledProjectProgress } from './useProjectProgress'

jest.mock('@/app/long-take/hooks/useLongTakeArtifacts', () => ({ useLongTakeArtifacts: jest.fn() }))
jest.mock('@/hooks/useApi', () => ({
  useApi: () => ({ fetchApiDomain: jest.fn(async () => ({ ok: false })) }),
}))

const BED = 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_sfx.m4a?v=7'
const CLIPS = 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_clips.mp4?v=6'

function polled(status: Partial<LongTakeStatus>) {
  jest.mocked(useLongTakeArtifacts).mockReturnValue({
    audioPreviewUrl: 'http://localhost:5017/api/files/p1/voice_over.mp3',
    script: null,
    status: { stage: 'completed', status: 'completed', ...status } as LongTakeStatus,
    videoUrl: 'http://localhost:5017/api/files/p1/final_video.mp4',
  } as ReturnType<typeof useLongTakeArtifacts>)
  return renderHook(() => usePolledProjectProgress('p1')).result.current
}

describe('usePolledProjectProgress', () => {
  it("gives the players a loop's clip sound bed, its volume, its joined clips and whether one is being built", () => {
    const bed = {
      loopClipsUrl: CLIPS,
      loopSfxBedPending: false,
      loopSfxBedUrl: BED,
      loopSfxBedVolume: 35,
    }
    expect(polled(bed)).toMatchObject(bed)
    expect(polled({ loopSfxBedPending: true })).toMatchObject({
      loopClipsUrl: null,
      loopSfxBedPending: true,
      loopSfxBedUrl: null,
      loopSfxBedVolume: null,
    })
  })

  it('has none for any other video', () => {
    expect(polled({})).toMatchObject({
      loopClipsUrl: null,
      loopSfxBedPending: false,
      loopSfxBedUrl: null,
      loopSfxBedVolume: null,
    })
  })

  it('names the clips a finished loop kept although they still fail a check', () => {
    const meta = { beatLoopClips: 6, beatLoopFlaggedClips: 's2,s4' }
    expect(polled({ meta }).flaggedClips).toEqual(['s2', 's4'])
    // None flagged, a story video, or a run not finished yet: none.
    expect(polled({ meta: { beatLoopClips: 6 } }).flaggedClips).toEqual([])
    expect(polled({}).flaggedClips).toEqual([])
    expect(
      polled({ meta, stage: 'render', status: 'in_progress' } as Partial<LongTakeStatus>)
        .flaggedClips,
    ).toEqual([])
  })
})
