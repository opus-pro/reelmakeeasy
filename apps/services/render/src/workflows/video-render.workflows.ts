import type {
  RenderContext,
  RenderPreviewResult,
  RenderVideoChunkedWorkflowDef,
  RenderVideoParams,
  RenderVideoResult,
  RenderVideoWorkflowDef,
} from '@reelmakeeasy/common/workflow/workflow/render/types'
import { executeChild, uuid4 } from '@reelmakeeasy/workflow-engine/workflow'
import { VideoRenderService } from '@shared/render-services/render'

// ============================================================================
// Chunked Render Video helpers
// ============================================================================

type RenderChunk = {
  endMs: number
  index: number
  startMs: number
}

type RenderedChunkResult = {
  chunkIndex: number
  videoUri: string
}

function getChunkVideoId(batchId: string, chunkIndex: number): string {
  return `vid-${batchId}-chunk${chunkIndex.toString().padStart(3, '0')}`
}

function routingFromRenderParent(
  parent: RenderContext,
): Pick<RenderContext, 'cluster' | 'requestContext'> {
  const out: Pick<RenderContext, 'cluster' | 'requestContext'> = {}
  if (parent.requestContext) {
    out.requestContext = parent.requestContext
  }
  if (parent.cluster !== undefined) {
    out.cluster = parent.cluster
  }
  return out
}

function splitDurationIntoChunks(
  totalDurationMs: number,
  chunkDurationMs: number,
  minChunkDurationMs: number,
): RenderChunk[] {
  const chunks: RenderChunk[] = []
  let currentStart = 0
  let index = 0
  if (chunkDurationMs < 0) {
    throw new Error('chunkDurationMs must be greater than 0')
  }
  while (currentStart < totalDurationMs) {
    let endMs = Math.min(currentStart + chunkDurationMs, totalDurationMs)
    const remaining = totalDurationMs - endMs
    if (remaining > 0 && remaining < minChunkDurationMs) {
      endMs = totalDurationMs
    }
    chunks.push({ endMs, index, startMs: currentStart })
    currentStart = endMs
    index++
  }
  return chunks
}

// ============================================================================
// VideoRenderWorkflows - implements RenderVideo, RenderPreview, RenderVideoChunked
// ============================================================================

export class VideoRenderWorkflows extends VideoRenderService {
  override RenderPreview(payload: RenderVideoParams): Promise<RenderPreviewResult> {
    this.logger.info('RenderPreview', { payload })
    return this.renderPreview({
      context: this.currentContext as unknown as RenderContext,
      payload,
    }).catch((error) => {
      this.logger.error('RenderPreview failed', { error })
      throw error
    })
  }

  override RenderVideo(payload: RenderVideoParams): Promise<RenderVideoResult> {
    this.logger.info('RenderVideo', payload)
    return this.renderVideo({
      context: this.currentContext as unknown as RenderContext,
      payload,
    }).catch((error) => {
      this.logger.error('RenderVideo failed', { error })
      throw error
    })
  }

  override async RenderVideoChunked(
    payload: RenderVideoChunkedWorkflowDef['arg']['payload'],
  ): Promise<Required<RenderVideoChunkedWorkflowDef>['response']['data']> {
    const { projectId, userId, userEmail } = this.currentContext as unknown as {
      projectId: string
      userEmail: string
      userId: string
    }
    const {
      videoScriptUri,
      totalDurationMs,
      type,
      chunkDurationMs = 30_000,
      minChunkDurationMs = 15_000,
      renderOptions,
    } = payload

    const videoScript = await this.resolveVideoScriptActivity({
      videoScript: payload.videoScript,
      videoScriptUri: videoScriptUri ?? '',
    })
    const videoScriptPayload = videoScriptUri ? { videoScriptUri, videoScript } : { videoScript }

    const batchId = uuid4().slice(0, 8)
    const chunks = splitDurationIntoChunks(totalDurationMs, chunkDurationMs, minChunkDurationMs)
    const chunkCount = chunks.length

    this.logger.info('RenderVideoChunked - Starting', {
      projectId,
      type,
      totalDurationMs,
      chunkCount,
    })

    const renderChunk = async (chunk: RenderChunk): Promise<RenderedChunkResult> => {
      const videoId = getChunkVideoId(batchId, chunk.index)
      try {
        const result = (await executeChild('RenderVideo', {
          args: [
            {
              context: {
                projectId,
                videoId,
                userId,
                userEmail,
                ...routingFromRenderParent(this.currentContext as unknown as RenderContext),
              },
              payload: {
                videoScriptUri: '',
                // Canvas/encode options first, then script routing: the
                // fan-out stays authoritative over videoScript fields while
                // callers control the canvas (e.g. the 4K composite's
                // explicit 2160p outputResolution).
                ...renderOptions,
                ...videoScriptPayload,
                segmentTimeRange: [chunk.startMs, chunk.endMs] as [number, number],
                segmentIndex: chunk.index,
                totalSegments: chunkCount,
              },
            },
          ],
          workflowId: `ao:${projectId}:render-${type}:${videoId}`,
          taskQueue: this.getTaskQueue(this.currentContext),
        })) as Required<RenderVideoWorkflowDef>['response']

        return { chunkIndex: chunk.index, videoUri: result.data.videoUri }
      } catch (error) {
        this.logger.error('RenderVideoChunked - Chunk failed', {
          projectId,
          chunkIndex: chunk.index,
          error,
        })
        throw error
      }
    }

    const chunkResults = await Promise.all(chunks.map(renderChunk))
    const videoUris = chunkResults
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((r) => r.videoUri)

    const audioUri =
      videoScript.tracks.find((t) => t.type === 'audio')?.segments[0]?.content?.sourceUri ?? ''

    const concatResult = (await executeChild('ConcatVideo', {
      args: [
        {
          context: {
            projectId,
            batchId,
            userId,
            userEmail,
            ...routingFromRenderParent(this.currentContext as unknown as RenderContext),
          },
          payload: { videoUris, outputFileName: 'final.mp4', audioUri },
        },
      ],
      workflowId: `ao:${projectId}:concat-${type}:${batchId}`,
      taskQueue: this.getTaskQueue(this.currentContext),
    })) as { data: { videoUri: string } }

    return {
      videoUri: concatResult.data.videoUri,
      chunkCount,
      message: `Successfully rendered ${chunkCount} chunks and concatenated`,
    }
  }
}
