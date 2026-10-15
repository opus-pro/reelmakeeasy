import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import type { TaskRequest } from '@reelmakeeasy/common/workflow/types'
import type {
  RenderContext,
  RenderPreviewResult,
  RenderVideoChunkedWorkflowDef,
  RenderVideoParams,
  RenderVideoResult,
  RenderVideoWorkflowDef,
} from '@reelmakeeasy/common/workflow/workflow/render/types'
import { DefineActivity } from '@shared/render-services/runtime/workflow'

import { RenderBaseService } from './base.service'

/**
 * Service contract for the VideoRender workflow group.
 *
 * Covers: RenderVideo, RenderPreview, RenderVideoChunked.
 * Implementation lives in apps/services/render/src/workflows/video-render.workflows.ts
 *              and    apps/services/render/src/activities/video-render/
 */
export class VideoRenderService extends RenderBaseService {
  /**
   * Render a preview image for a video.
   */
  RenderPreview(payload: RenderVideoParams): Promise<RenderPreviewResult> {
    return this.executeFromInstance('RenderPreview', payload)
  }

  /**
   * Render a preview image from the video script.
   */
  @DefineActivity({
    retry: { maximumAttempts: 3 },
    startToCloseTimeout: '5 minutes',
    heartbeatTimeout: '30 seconds',
    scheduleToCloseTimeout: '10 minutes',
  })
  renderPreview(
    params: TaskRequest<RenderVideoParams, RenderContext>,
  ): Promise<RenderPreviewResult> {
    return this.executeFromInstance('renderPreview', params)
  }

  /**
   * Render a single video segment.
   */
  RenderVideo(payload: RenderVideoParams): Promise<RenderVideoResult> {
    return this.executeFromInstance('RenderVideo', payload)
  }

  /**
   * Render a video from a video script.
   *
   * Story Mode long-take renders a 10-11min video in a single full-render pass
   * (concat 90-100 transition clips, mix audio, captions, watermark, encode to
   * 24fps 9:16 mp4). This runs ~10-20min, so the previous
   * 20min activity ceiling left no headroom and a retry was impossible inside
   * the 20min scheduleToClose. The retry budget below is 45 + 3 + 45 = 93min
   * (two full attempts plus the initialInterval back-off), so schedule-to-close
   * is set to 100min for headroom without leaving stuck activity slots open
   * for hours.
   */
  @DefineActivity({
    retry: { maximumAttempts: 2, initialInterval: '3 minutes' },
    startToCloseTimeout: '45 minutes',
    heartbeatTimeout: '30 seconds',
    scheduleToCloseTimeout: '100 minutes',
  })
  renderVideo(arg: RenderVideoWorkflowDef['arg']): Promise<RenderVideoResult> {
    return this.executeFromInstance('renderVideo', arg)
  }

  /**
   * Render a long video by splitting it into chunks and concatenating them.
   */
  RenderVideoChunked(
    payload: RenderVideoChunkedWorkflowDef['arg']['payload'],
  ): Promise<Required<RenderVideoChunkedWorkflowDef>['response']['data']> {
    return this.executeFromInstance('RenderVideoChunked', payload)
  }

  /**
   * Resolve a VideoScript object from inline data or store address.
   */
  @DefineActivity({
    retry: { maximumAttempts: 3 },
    startToCloseTimeout: '2 minutes',
  })
  resolveVideoScriptActivity(
    params: Pick<RenderVideoParams, 'videoScript' | 'videoScriptUri'>,
  ): Promise<VideoScript> {
    return this.executeFromInstance('resolveVideoScriptActivity', params)
  }
}
