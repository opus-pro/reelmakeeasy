import type { RenderPlan, VideoSeg } from '@reelmakeeasy/common/types/render-plan-struct'
import { AssetType, SegType, TrackType } from '@reelmakeeasy/common/types/render-plan-struct'

import { extractPrefetchTasksFromRenderPlan } from './extract-prefetch-tasks'

function planWithVideo(uri: string, totalMs = 12_000): RenderPlan {
  const seg: VideoSeg = {
    id: 'v-loop-clips',
    type: SegType.Video,
    assetType: AssetType.Video,
    uri,
    in: 0,
    out: totalMs,
    trimStart: 0,
    trimEnd: totalMs,
    cropPosition: [{ ft: 0, mode: 0, v: [0, 0] }],
    cropSize: [{ ft: 0, mode: 0, v: [1, 1] }],
    loop: 0,
    volume: 0,
  }
  return {
    tracks: [{ id: 'track-video', type: TrackType.Video, segs: [seg] }],
  } as unknown as RenderPlan
}

describe('extractPrefetchTasksFromRenderPlan', () => {
  it('prefetches a video seg by time range at video priority', () => {
    const [task] = extractPrefetchTasksFromRenderPlan(
      planWithVideo('http://localhost:5017/api/files/p/beat_loop_clips.mp4'),
    )
    expect(task).toMatchObject({ isTimeRange: true, priority: 1, start: -100, end: 12_100 })
  })

  // The loop's joined clips carry their version (`?v=`): still a video, warmed up by time
  // range, not fetched whole at media priority.
  it('treats a versioned mp4 URL as a video', () => {
    const url = 'http://localhost:5017/api/files/p/beat_loop_clips.mp4?v=1760000000000'
    const [task] = extractPrefetchTasksFromRenderPlan(planWithVideo(url))
    expect(task).toMatchObject({ url, isTimeRange: true, priority: 1, start: -100, end: 12_100 })
  })
})
