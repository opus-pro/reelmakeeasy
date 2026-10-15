import type { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { renderHook, waitFor } from '@testing-library/react'

import type { StorySegment } from '@/app/story-mode/long-take.types'

import { factStampStripUrl } from './factStampStripUrl'
import { StoryRenderPlanBuilder } from './StoryRenderPlanBuilder'
import useRenderPlan from './useRenderPlan'

jest.mock('./StoryRenderPlanBuilder', () => ({ StoryRenderPlanBuilder: { build: jest.fn() } }))
jest.mock('@/app/projects/[projectId]/editor/utils/extract-prefetch-tasks', () => ({
  extractPrefetchTasksFromRenderPlan: () => [],
}))
jest.mock('@/app/projects/[projectId]/editor/utils/media-data-manager', () => ({
  __esModule: true,
  default: { abortWarmup: jest.fn(), warmup: jest.fn() },
}))

const clip = {
  endMs: 4000,
  kind: 'transition',
  startMs: 0,
  transitionId: 'clip-0',
  videoUri: 'http://localhost:5017/api/files/p1/clip-0.mp4',
} as StorySegment

const params = {
  allSegments: [clip],
  aspectRatio: '9 / 16',
  captionEnabled: true,
  loopClipsUrl: 'http://localhost:5017/api/files/p1/long_take/beat_loop_clips.mp4',
  totalMs: 4000,
  transcript: undefined,
  videoScript: undefined,
}

describe('useRenderPlan', () => {
  beforeEach(() => jest.mocked(StoryRenderPlanBuilder.build).mockReset())

  it("builds the plan with a loop's joined clips", async () => {
    const plan = { id: '#Root', tracks: [] } as unknown as RenderPlan
    jest.mocked(StoryRenderPlanBuilder.build).mockResolvedValue(plan)
    const { result } = renderHook(() => useRenderPlan(params))
    await waitFor(() => expect(result.current.renderPlan).toBe(plan))
    expect(result.current.failed).toBe(false)
    expect(StoryRenderPlanBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({ loopClipsUrl: params.loopClipsUrl }),
    )
  })

  it("draws a loop's fact stamp strips from images made in the page", async () => {
    jest.mocked(StoryRenderPlanBuilder.build).mockResolvedValue({ tracks: [] } as never)
    renderHook(() => useRenderPlan(params))
    await waitFor(() =>
      expect(StoryRenderPlanBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({ factStripUrl: factStampStripUrl }),
      ),
    )
  })

  it("says so when the plan can't be built, so a player can show the file instead", async () => {
    jest.mocked(StoryRenderPlanBuilder.build).mockRejectedValue(new Error('bad caption track'))
    const { result } = renderHook(() => useRenderPlan(params))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.renderPlan).toBeNull()
  })
})
