import type {
  ConcatContext,
  ConcatVideoParams,
  ConcatVideoResult,
} from '@reelmakeeasy/common/workflow/workflow/render/types'
import { VideoConcatService } from '@shared/render-services/render'

// ============================================================================
// ConcatWorkflows - implements ConcatVideo
// ============================================================================

export class VideoConcatWorkflows extends VideoConcatService {
  override ConcatVideo(payload: ConcatVideoParams): Promise<ConcatVideoResult> {
    const context = this.currentContext as unknown as ConcatContext
    this.logger.info('ConcatVideo', {
      projectId: context.projectId,
      batchId: context.batchId,
      videoCount: payload.videoUris.length,
    })
    return this.concatVideos({ context, payload }).catch((error) => {
      this.logger.error('ConcatVideo failed', { error })
      throw error
    })
  }
}
