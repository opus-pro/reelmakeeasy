import type { NarrativeContext } from '@reelmakeeasy/common/media/types'
import { Storyboard } from '@agent-lib/agents/storyboard/types'
import { BadRequestException, Injectable } from '@nestjs/common'
import { STORY_LOADER_PATHS, STORYBOARD_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { EDITOR_TASK_QUEUE } from '@reelmakeeasy/common/agent-v2/util/tool-queue-map'
import { Logger } from '@reelmakeeasy/common/logger'
import { AspectRatio } from '@reelmakeeasy/common/media'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { asStoreUri } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { cancelProjectWorkflow } from '../long-take/long-take-cancel.util'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectService } from '../projects/projects.service'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

/**
 * Result of starting an async asset generation workflow
 */
export interface StartAssetGenerationResult {
  /** Workflow ID for tracking/SSE subscription */
  workflowId: string
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectService,
  ) {
    this.logger.log('AssetsService initialized with workflow support')
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const parts = workflowId.split(':')
    if (parts.length < 3 || parts[0] !== 'ao' || !parts[1]) {
      throw new BadRequestException(`Invalid asset-gen workflowId: ${workflowId}`)
    }
    const projectId = parts[1]
    await cancelProjectWorkflow(
      { logger: this.logger, projectsService: this.projectsService },
      projectId,
      workflowId,
    )
  }

  /**
   * Start asset generation workflow (non-blocking)
   * Returns immediately with workflowId for SSE subscription
   *
   * @param prompt - Generation prompt (user's change request)
   * @param type - Asset type: 'image' or 'video'. Defaults to 'video' if not specified
   * @param projectId - Project ID
   * @param ratio - Aspect ratio: '1:1', '16:9', or '9:16'. Defaults to '1:1' for images and '9:16' for videos
   * @param duration - Video duration in seconds (4-8s). Only applies to videos. Defaults to 5s
   * @param referenceUrl - Optional URL of reference image/video (Visual Anchor)
   * @param sceneId - Optional scene ID for context-aware regeneration (Narrative Anchor)
   * @param shotId - Optional shot ID for context-aware regeneration (Narrative Anchor)
   * @param userId - User ID for tracking
   * @param userEmail - User email for tracking
   * @returns WorkflowId for SSE subscription
   */
  async startAssetGeneration(
    prompt: string,
    type: 'image' | 'video',
    projectId: string,
    referenceUrl: string,
    sceneId: string,
    shotId: string,
    ratio?: AspectRatio,
    duration?: number,
    userId?: string,
    userEmail?: string,
    orgId?: string,
  ): Promise<StartAssetGenerationResult> {
    this.logger.log(`Starting ${type} generation for project ${projectId} with prompt: ${prompt}`)

    // Attempt to fetch narrative context if sceneId and shotId are provided
    let narrativeContext: NarrativeContext | null = null
    if (sceneId && shotId) {
      this.logger.log(`Context anchors provided: sceneId=${sceneId}, shotId=${shotId}`)
      try {
        narrativeContext = await this.fetchNarrativeContext(projectId, sceneId, shotId)
      } catch (e) {
        const error = ensureError(e)
        this.logger.warn(
          `Failed to fetch narrative context, using original prompt: ${error.message}`,
        )
        // Continue with original prompt if context retrieval fails
      }
    }
    // Deterministic workflowId (no per-call timestamp) so FE retries dedup via
    // WorkflowExecutionAlreadyStartedError instead of starting a second run.
    const client = await createClient()
    const taskQueue = await resolveTaskQueueForClient(EDITOR_TASK_QUEUE)
    const workflowId = `ao:${projectId}:asset-gen:${sceneId || 'no-scene'}:${shotId || 'no-shot'}`

    this.logger.log(
      `Starting GenerateAssetWorkflow (async), ${JSON.stringify({
        workflowId,
        taskQueue,
        projectId,
        type,
      })}`,
    )

    try {
      await client.workflow.start('GenerateAssetWorkflow', {
        args: [
          {
            prompt,
            type,
            projectId,
            ratio,
            duration,
            referenceUrl,
            narrativeContext,
            sceneId,
            shotId,
            userId,
            userEmail,
            orgId,
          },
        ],
        taskQueue,
        workflowId,
        // Outer backstop only. The per-activity scheduleToCloseTimeout is the real
        // bound and fails into the workflow catch; this must stay above the total
        // activity budget so it never hard-terminates past the catch.
        workflowExecutionTimeout: '4 hours',
      })
    } catch (error) {
      if (ensureError(error).name !== 'WorkflowExecutionAlreadyStartedError') {
        throw error
      }
    }
    this.logger.log(`Workflow started, returning immediately, workflowId: ${workflowId}`)
    return { workflowId }
  }

  /**
   * Human-in-the-Loop: submit user-selected keyframe to resume the workflow.
   * Accepts either store address (store://) or CDN URL and converts to store address.
   */
  async submitKeyframeSelection(workflowId: string, selectedLastFrameUri: string): Promise<void> {
    // Convert CDN URL to store address if needed
    const fileUri = isStoreUri(selectedLastFrameUri)
      ? selectedLastFrameUri
      : asStoreUri(selectedLastFrameUri)

    const client = await createClient()
    const handle = client.workflow.getHandle(workflowId)
    await handle.signal('userSelection', fileUri)
  }

  /**
   * Fetch narrative context from storyboard.json and script.txt
   * This provides the "soul" of the shot - why it exists in the story.
   *
   * @param projectId - Project ID
   * @param sceneId - Scene ID
   * @param shotId - Shot ID
   * @returns Narrative context or null if not found
   */
  private async fetchNarrativeContext(
    projectId: string,
    sceneId: string,
    shotId: string,
  ): Promise<NarrativeContext | null> {
    const storage = await createStorage(projectId)

    // Fetch storyboard and script in parallel
    const [storyboardResult, scriptResult] = await Promise.allSettled([
      storage.readJsonFile<Storyboard>(STORYBOARD_PATHS.shotsBaseInfoPath),
      storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath),
    ])

    // Storyboard is required
    if (storyboardResult.status === 'rejected') {
      this.logger.warn(
        `Failed to read storyboard.json: ${ensureError(storyboardResult.reason).message}`,
      )
      return null
    }
    const storyboard = storyboardResult.value

    // Script is optional
    let wholeScript = ''
    if (scriptResult.status === 'fulfilled') {
      wholeScript = scriptResult.value
    } else {
      this.logger.warn(`Failed to read script.txt: ${ensureError(scriptResult.reason).message}`)
    }

    // Find specific shot data
    const scene = storyboard.find((s) => s.scene_id === sceneId)
    if (!scene) {
      this.logger.warn(`Scene not found: ${sceneId}`)
      return null
    }

    const shot = scene.shots.find((s) => s.shot_id === shotId)
    if (!shot) {
      this.logger.warn(`Shot not found: ${shotId} in scene ${sceneId}`)
      return null
    }

    return {
      shotVoiceOver: shot.voice_over,
      shotDescription: shot.shot_description,
      sceneDescription: scene.scene_description,
      sceneVoiceOver: scene.voice_over,
      wholeScript,
    }
  }
}
