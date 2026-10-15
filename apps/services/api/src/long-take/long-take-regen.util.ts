import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { Logger } from '@reelmakeeasy/common/logger'
import { sanitizeCameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import { regenerateOutputName } from '@reelmakeeasy/common/long-take/regenerate-output'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { asStoreUri } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { AllVideoModels } from '@reelmakeeasy/common/veo3/model'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import {
  LongTakeKeyframe,
  LongTakeRenderRequest,
  LongTakeTransition,
} from '@shared/types/api/long-take'
import { DebugSettings } from '@shared/types/project/debug-settings'

import {
  type GenerationRecordSummary,
  resolveSuccessfulTransitionFields,
} from './long-take-generation-record-fields.util'

const logger = new Logger('long-take-regen')

export interface RegenDeps {
  buildTransitionKeyframeWorkflowId: (projectId: string, shotId: string) => string
  // Only the transition-video regen path uses this (to read full prompts from the generation
  // record); other RegenDeps consumers (keyframe regen) leave it unset.
  prisma?: {
    generationRecord: {
      findMany: (args: {
        orderBy?: unknown
        select?: unknown
        take?: number
        where?: unknown
      }) => Promise<GenerationRecordSummary[]>
    }
  }
  projectsService: {
    canVisitProject: (projectId: string) => Promise<boolean>
    getProject: (projectId: string) => Promise<null | {
      cameraStyle?: null | string
      debugSettings?: unknown
      generationResolution?: unknown
      imageModel?: null | string
      longTakeRatio?: null | string
      styleText?: null | string
    }>
  }
}

export function hasCanonicalRenderSnapshot(
  input: LongTakeRenderRequest,
): input is LongTakeRenderRequest & {
  expectedRevision: string
  keyframes: LongTakeKeyframe[]
  transitions: LongTakeTransition[]
} {
  return (
    !!input.expectedRevision &&
    Array.isArray(input.keyframes) &&
    Array.isArray(input.transitions) &&
    input.transitions.length > 0
  )
}

export async function regenerateTransition(
  deps: RegenDeps,
  projectId: string,
  transitionId: string,
  body: {
    keyframeDriven?: boolean
    prompt?: string
    transitionList: Array<{
      firstFrameUrl: string
      lastFrameUrl: string
      transitionId: string
    }>
  },
  user: UserInfo,
  // Transition video model resolved by the caller. When provided it
  // takes precedence over the persisted debugSettings read below. Undefined =>
  // fall back to the persisted value.
  resolvedTransitionVideoModel?: string,
): Promise<{ started: boolean; workflowId: string }> {
  const canVisit = await deps.projectsService.canVisitProject(projectId)
  if (!canVisit) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }

  if (!body.transitionList?.length) {
    throw new BadRequestException('transitionList must not be empty')
  }

  if (!body.transitionList.some((item) => item.transitionId === transitionId)) {
    throw new BadRequestException(
      `transitionList must include the target transition ${transitionId}`,
    )
  }

  const frameUrlById = new Map(
    body.transitionList.map((item) => [
      item.transitionId,
      {
        firstFrameUri: asStoreUri(item.firstFrameUrl),
        lastFrameUri: asStoreUri(item.lastFrameUrl),
      },
    ]),
  )

  const storage = await createStorage(projectId)
  const transitions = await storage.readJsonFile<Array<LongTakeTransition>>(
    'long_take/transition_videos.json',
  )
  // The shots' scenes and narration: the model writes the new clip prompt from the user's
  // instruction with these beside it.
  const shots = await storage
    .readJsonFile<
      Array<{ audio?: string; keyframe_prompt?: string; shot_id: string }>
    >('long_take/shot_plan.json')
    .catch(() => null)
  const shotById = new Map((shots ?? []).map((s) => [s.shot_id, s]))
  const stamp = Date.now().toString(36)

  if (!transitions?.some((t) => t.transitionId === transitionId)) {
    throw new BadRequestException(`Transition ${transitionId} not found`)
  }

  // The prompt persisted in transition_videos.json is truncated to 512 chars for the render
  // payload. The editor worker has no DB access, so fetch the full prompt from the generation
  // record here and thread it through as originalPrompt for regen context.
  const transitionRecords = await fetchTransitionGenerationRecords(
    deps,
    projectId,
    body.transitionList.map((item) => item.transitionId),
  )

  const transitionList = body.transitionList
    .map((item) => {
      const raw = transitions?.find((t) => t.transitionId === item.transitionId)
      if (!raw) {
        return null
      }
      const frames = frameUrlById.get(item.transitionId) ?? {
        firstFrameUri: '',
        lastFrameUri: '',
      }
      return {
        transitionId: raw.transitionId,
        fromShotId: raw.fromShotId,
        toShotId: raw.toShotId,
        startMs: raw.startMs,
        endMs: raw.endMs,
        fromAudio: shotById.get(raw.fromShotId)?.audio,
        fromKeyframePrompt: shotById.get(raw.fromShotId)?.keyframe_prompt,
        toAudio: shotById.get(raw.toShotId)?.audio,
        toKeyframePrompt: shotById.get(raw.toShotId)?.keyframe_prompt,
        outputName: regenerateOutputName(raw.transitionId, stamp),
        prompt: item.transitionId === transitionId ? (body.prompt ?? raw.prompt) : raw.prompt,
        keyframeDriven: item.transitionId === transitionId ? body.keyframeDriven : undefined,
        originalPrompt:
          resolveSuccessfulTransitionFields(
            { transitionId: raw.transitionId, videoUri: raw.videoUri },
            transitionRecords,
          ).finalVideoPrompt ?? undefined,
        firstFrameUri: frames.firstFrameUri,
        lastFrameUri: frames.lastFrameUri,
      }
    })
    .filter((item) => item !== null)

  if (transitionList.length === 0) {
    throw new BadRequestException('No valid transitions found for regeneration')
  }

  const project = await deps.projectsService.getProject(projectId)
  const debugSettings = project?.debugSettings as DebugSettings | null | undefined
  // Prefer the caller-resolved model. Fall back to the persisted
  // debugSettings value when no override is supplied. Both are run through the
  // AllVideoModels membership guard so an unknown id is dropped (workflow then
  // resolves the default).
  const candidateTransitionVideoModel =
    resolvedTransitionVideoModel ??
    (typeof debugSettings?.transitionVideoModel === 'string'
      ? debugSettings.transitionVideoModel
      : undefined)
  const validModels = new Set<string>(AllVideoModels)
  const transitionVideoModel =
    candidateTransitionVideoModel && validModels.has(candidateTransitionVideoModel)
      ? candidateTransitionVideoModel
      : undefined

  const modelSwitch = debugSettings?.llm

  const client = await createClient()
  const taskQueue = await resolveTaskQueueForClient('ao-editor')
  const workflowId = getWorkflowId(projectId, 'story-mode', 'transition-regen', transitionId)

  try {
    await client.workflow.start('RegenerateTransitionWorkflow', {
      args: [
        {
          projectId,
          aspectRatio: project?.longTakeRatio ?? undefined,
          // The project's camera style shapes the rewritten clip prompt (Calm or Dynamic).
          ...(project?.cameraStyle
            ? { cameraStyle: sanitizeCameraStyle(project.cameraStyle) }
            : {}),
          // Org id, threaded to the workflow; undefined => identical to today.
          orgId: user.orgId,
          userId: user.sub,
          userEmail: user.email,
          transitionList,
          ...(transitionVideoModel ? { transitionVideoModel } : {}),
          modelSwitch,
        },
      ],
      taskQueue,
      workflowId,
      workflowExecutionTimeout: '2 hours',
    })
  } catch (error) {
    const err = ensureError(error)
    if (err.name === 'WorkflowExecutionAlreadyStartedError') {
      return { workflowId, started: false }
    }
    throw error
  }

  return { workflowId, started: true }
}

export async function regenerateTransitionKeyframe(
  deps: RegenDeps,
  projectId: string,
  shotId: string,
  body: { keyframeUrl?: string; prompt: string; referenceImageUrl?: string },
  user: UserInfo,
): Promise<{ started: boolean; workflowId: string }> {
  const canVisit = await deps.projectsService.canVisitProject(projectId)
  if (!canVisit) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }

  let currentKeyframeUri = asStoreUri(body.keyframeUrl?.trim()) || ''
  if (!currentKeyframeUri) {
    const storage = await createStorage(projectId)
    const keyframes = await storage.readJsonFile<Array<{ keyframeUrl: string; shotId: string }>>(
      'long_take/keyframes.json',
    )
    currentKeyframeUri = keyframes?.find((kf) => kf.shotId === shotId)?.keyframeUrl ?? ''
  }

  if (!currentKeyframeUri) {
    throw new BadRequestException(`Keyframe not found for shot ${shotId}`)
  }

  const project = await deps.projectsService.getProject(projectId)
  const styleText = project?.styleText?.trim() || undefined

  const client = await createClient()
  const taskQueue = await resolveTaskQueueForClient('ao-editor')
  const workflowId = deps.buildTransitionKeyframeWorkflowId(projectId, shotId)

  try {
    await client.workflow.start('RegenerateTransitionKeyframeWorkflow', {
      args: [
        {
          projectId,
          shotId,
          userPrompt: body.prompt,
          currentKeyframeUri,
          aspectRatio: project?.longTakeRatio ?? undefined,
          referenceImageUrl: asStoreUri(body.referenceImageUrl?.trim()) || undefined,
          styleText,
          orgId: user.orgId,
          userId: user.sub,
          userEmail: user.email,
        },
      ],
      taskQueue,
      workflowId,
      // Outer backstop only; the per-activity scheduleToCloseTimeout is the real bound
      // and fails into the workflow catch. Keep above the activity budget.
      workflowExecutionTimeout: '90 minutes',
    })
  } catch (error) {
    const err = ensureError(error)
    if (err.name === 'WorkflowExecutionAlreadyStartedError') {
      return { workflowId, started: false }
    }
    throw error
  }

  return { workflowId, started: true }
}

/** The successful generation records of the clips (their full prompts); none when the read
 *  fails or there is no database. */
export async function fetchTransitionGenerationRecords(
  deps: Pick<RegenDeps, 'prisma'>,
  projectId: string,
  transitionIds: string[],
): Promise<GenerationRecordSummary[]> {
  if (!deps.prisma) {
    return []
  }
  try {
    return await deps.prisma.generationRecord.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        anchorId: true,
        attempt: true,
        inputText: true,
        meta: true,
        model: true,
        outputUris: true,
      },
      take: 200,
      where: {
        anchorId: { in: transitionIds },
        anchorType: 'transition',
        projectId,
        status: 'success',
        task: 'long-take-transition',
        type: 'video',
      },
    })
  } catch (error) {
    logger.warn(
      `Failed to load transition generation records for ${projectId}: ${ensureError(error).message}`,
    )
    return []
  }
}
