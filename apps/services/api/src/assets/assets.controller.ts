import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Sse,
} from '@nestjs/common'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { Logger } from '@reelmakeeasy/common/logger'
import type { AssetState, AssetWorkflowProgress } from '@reelmakeeasy/common/media'
import { ASSET_PROGRESS_QUERY_NAME, getAssetSSEChannelKey } from '@reelmakeeasy/common/media'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import { Observable } from 'rxjs'

import {
  GenerateAssetAsyncResponseDto,
  GenerateAssetDto,
  SelectKeyframeDto,
  SelectKeyframeResponseDto,
} from './assets.dto'
import { AssetsService } from './assets.service'

@Controller('assets')
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name)

  constructor(private readonly assetsService: AssetsService) {}

  /**
   * Cancel an asset generation workflow
   * POST /assets/cancel/:workflowId
   */
  @Post('cancel/:workflowId')
  async cancelWorkflow(
    @Param('workflowId') workflowId: string,
  ): Promise<{ message: string; ok: boolean }> {
    this.logger.log(
      `Cancel request received for workflowId: ${workflowId}, org: ${getReqContext().org_id}`,
    )
    try {
      await this.assetsService.cancelWorkflow(workflowId)
      return { message: 'Workflow cancelled successfully', ok: true }
    } catch (e) {
      const error = ensureError(e)
      if (e instanceof WorkflowNotFoundError) {
        throw new NotFoundException(`Workflow not found: ${workflowId}`)
      }
      this.logger.error({ error }, 'Failed to cancel workflow')
      throw new HttpException(
        `Failed to cancel workflow: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * Generate asset endpoint (async, non-blocking)
   * POST /assets/generate-async
   *
   * Returns immediately with workflowId for SSE subscription.
   * Subscribe to /assets/events/:workflowId for progress updates.
   *
   * @param body - Request body containing prompt, type and projectId
   * @returns WorkflowId for SSE subscription
   */
  @Post('generate-async')
  async generateAsync(@Body() body: GenerateAssetDto): Promise<GenerateAssetAsyncResponseDto> {
    const { prompt, type, projectId, ratio, duration, referenceUrl, sceneId, shotId } = body
    // Default type to 'video' if not provided
    const assetType = type || 'video'

    this.logger.log(
      `Received async generate request - type: ${assetType}, projectId: ${projectId}, user: ${getReqContext().org_id}`,
    )
    this.logger.log(
      `Prompt: ${prompt}, Ratio: ${ratio || 'default'}, Duration: ${duration || 'default'}, ReferenceUrl: ${referenceUrl || 'none'}`,
    )
    this.logger.log(`Context anchors: sceneId=${sceneId}, shotId=${shotId}`)

    if (!sceneId || !shotId || !referenceUrl) {
      throw new BadRequestException('Scene ID, shot ID and reference URL are required')
    }
    try {
      // Set up JobContext with user and project information
      const context = {
        projectId,
        userId: getReqContext().login_id,
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        userEmail: getReqContext().pii?.email,
        sceneId: sceneId || '',
        shotId: shotId || '',
      }

      const { workflowId } = await JobContext.run(context, async () => {
        return await this.assetsService.startAssetGeneration(
          prompt,
          assetType,
          projectId,
          referenceUrl,
          sceneId,
          shotId,
          ratio,
          duration,
          getReqContext().login_id,
          // eslint-disable-next-line @nx/workspace-no-pii-field-access
          getReqContext().pii?.email,
          getReqContext().org_id,
        )
      })

      this.logger.log(`Workflow started: ${workflowId}, returning async response`)

      return new GenerateAssetAsyncResponseDto(workflowId, `${assetType} generation started`)
    } catch (e) {
      const error = ensureError(e)
      this.logger.error(
        { error, type: assetType, projectId, stack: error.stack },
        'Error starting generation workflow',
      )

      throw new HttpException(
        `Failed to start ${assetType} generation: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * Get current workflow progress (for state rehydration)
   * GET /assets/progress/:workflowId
   *
   * Query the workflow to get current state.
   * Useful for rehydrating UI state after page refresh or SSE reconnect.
   *
   * @param workflowId - Workflow ID from POST /assets/generate response
   * @returns Current workflow progress state
   */
  @Get('progress/:workflowId')
  async getProgress(@Param('workflowId') workflowId: string): Promise<AssetWorkflowProgress> {
    this.logger.log(`Progress query for workflowId: ${workflowId}`)

    try {
      return await this.queryWorkflowProgress(workflowId)
    } catch (error) {
      this.logger.warn(`Failed to query workflow progress: ${ensureError(error).message}`)

      // If workflow not found, throw 404 immediately
      if (error instanceof WorkflowNotFoundError) {
        throw new NotFoundException(`Workflow not found: ${workflowId}`)
      }

      // For other errors (e.g. query failed because workflow just started), assume it's queued
      return { status: 'queued' }
    }
  }

  /**
   * Human-in-the-Loop: submit selected keyframe to resume workflow
   * POST /assets/select-keyframe/:workflowId
   */
  @Post('select-keyframe/:workflowId')
  async selectKeyframe(
    @Param('workflowId') workflowId: string,
    @Body() body: SelectKeyframeDto,
  ): Promise<SelectKeyframeResponseDto> {
    this.logger.log(
      `Keyframe selection received for workflowId: ${workflowId}, org: ${getReqContext().org_id}`,
    )
    try {
      await this.assetsService.submitKeyframeSelection(workflowId, body.selectedLastFrameUri)
      return new SelectKeyframeResponseDto('Keyframe selection submitted')
    } catch (e) {
      const error = ensureError(e)
      if (e instanceof WorkflowNotFoundError) {
        throw new NotFoundException(`Workflow not found: ${workflowId}`)
      }
      this.logger.error({ error }, 'Failed to submit keyframe selection')
      throw new HttpException(
        `Failed to submit keyframe selection: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  /**
   * SSE endpoint for asset generation progress
   * GET /assets/events/:workflowId
   *
   * Subscribe to this endpoint to receive real-time state updates.
   * Uses a unified state model - each event is a complete state snapshot.
   *
   * Event type: 'update' with AssetState payload containing:
   * - status: 'queued' | 'processing' | 'completed' | 'failed'
   * - progress?: { percent, stage, message } (when processing)
   * - result?: { fileUri } (when completed)
   * - error?: { code, message } (when failed)
   * - updatedAt: timestamp
   *
   * On connect, automatically sends current state for rehydration.
   *
   * @param workflowId - Workflow ID from POST /assets/generate response
   * @returns Observable SSE stream
   */
  @Sse('events/:workflowId')
  async streamEvents(@Param('workflowId') workflowId: string): Promise<Observable<MessageEvent>> {
    this.logger.log(
      `SSE connection request for workflowId: ${workflowId}, org: ${getReqContext().org_id}`,
    )

    // Use the same channel key format as the worker notification service
    const channelKey = getAssetSSEChannelKey(workflowId)

    const bus = await SSEFactory.getSSEBus(channelKey)
    if (!bus) {
      throw new Error(`Failed to get SSE bus for workflow ${workflowId}`)
    }

    return bus.stream({
      onStart: async () => {
        this.logger.log(
          `👤 User connected to asset events: ${getReqContext().org_id} on ${workflowId}`,
        )

        // State rehydration: Query current workflow state and push to client
        try {
          const workflowProgress = await this.queryWorkflowProgress(workflowId)
          const currentState = this.mapWorkflowProgressToState(workflowProgress)
          this.logger.log(`Sending initial state for ${workflowId}: ${currentState.status}`)

          // Push current state as unified 'update' event
          await bus.push({
            type: 'update',
            data: JSON.stringify(currentState),
          })

          // If workflow is already completed or failed, end the stream
          if (currentState.status === 'completed' || currentState.status === 'failed') {
            this.logger.log(`Workflow ${workflowId} already finished, ending stream`)
            await bus.end()
          }
        } catch (error) {
          this.logger.warn(
            `Failed to get initial state for ${workflowId}: ${ensureError(error).message}`,
          )
          // Continue with stream even if initial state fetch fails
        }
      },
      onCleanup: () => {
        this.logger.log(
          `🔴 User disconnected from asset events: ${getReqContext().org_id} on ${workflowId}`,
        )
      },
    })
  }

  /**
   * Map workflow progress to unified AssetState format
   * This ensures consistent state representation across SSE events
   */
  private mapWorkflowProgressToState(progress: AssetWorkflowProgress): AssetState {
    const state: AssetState = {
      status: progress.status,
      updatedAt: Date.now(),
    }

    // Add keyframe candidates if available (HITL selection)
    if (progress.keyframeCandidates) {
      state.keyframeCandidates = progress.keyframeCandidates
    }

    // Add progress info if available
    if (progress.progressPercent !== undefined && progress.progressStage) {
      state.progress = {
        percent: progress.progressPercent,
        stage: progress.progressStage,
        message: progress.progressMessage,
      }
    }

    // Add result info if completed
    if (progress.status === 'completed' && progress.fileUri) {
      state.result = {
        fileUri: progress.fileUri,
        previewThumbnail: progress.previewThumbnail,
      }
    }

    // Add error info if failed
    if (progress.status === 'failed' && progress.errorMessage) {
      state.error = {
        code: progress.errorCategory || 'unknownError',
        message: progress.errorMessage,
      }
    }

    return state
  }

  /**
   * Query the workflow for current progress state
   */
  private async queryWorkflowProgress(workflowId: string): Promise<AssetWorkflowProgress> {
    const client = await createClient()
    const handle = client.workflow.getHandle(workflowId)

    // Query the workflow for current progress
    return await handle.query<AssetWorkflowProgress>(ASSET_PROGRESS_QUERY_NAME)
  }
}
