import type { TaskRequest } from '@reelmakeeasy/common/workflow/types'
import type {
  ConcatContext,
  ConcatVideoParams,
  ConcatVideoResult,
} from '@reelmakeeasy/common/workflow/workflow/render/types'
import { DefineActivity } from '@shared/render-services/runtime/workflow'

import { RenderBaseService } from './base.service'

/**
 * Service contract for the VideoAssembly (Concat) workflow group.
 *
 * Covers: ConcatVideo.
 * Implementation lives in apps/services/render/src/workflows/concat.workflows.ts
 *              and    apps/services/render/src/activities/concat-video.activities.ts
 */
export class VideoConcatService extends RenderBaseService {
  /**
   * Concatenate multiple video segments into a single video.
   */
  ConcatVideo(payload: ConcatVideoParams): Promise<ConcatVideoResult> {
    return this.executeFromInstance('ConcatVideo', payload)
  }

  /**
   * Concatenate video files using FFmpeg.
   */
  @DefineActivity({
    retry: { maximumAttempts: 2, initialInterval: '30 seconds' },
    startToCloseTimeout: '15 minutes',
    heartbeatTimeout: '2 minutes',
    scheduleToCloseTimeout: '20 minutes',
  })
  concatVideos(params: TaskRequest<ConcatVideoParams, ConcatContext>): Promise<ConcatVideoResult> {
    return this.executeFromInstance('concatVideos', params)
  }
}
