import { getLongTakeStatusKey, LONG_TAKE_STATUS_TTL_SECONDS } from '@reelmakeeasy/common/long-take'
import {
  deleteLongTakeAdmissionPayload,
  enqueueLongTakeAdmission,
  type LongTakeAdmissionPayload,
  removeQueuedLongTakeProject,
  STORY_MODE_ADMISSION_TIER,
} from '@reelmakeeasy/common/long-take/queue-admission'
import { STORY_MODE_WORKFLOW_NAME } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getIgnoredAdmissionControl } from '@shared/render-services/story-mode/admission.service'

import {
  buildQueuedAdmissionMeta,
  LONG_TAKE_QUEUED_WORKFLOW_TIMEOUT,
} from './long-take-workflow.util'
import type { WorkflowDeps } from './types'

export async function startStandaloneAdmissionWorkflow(
  deps: WorkflowDeps,
  createClient: () => Promise<{
    workflow: {
      start: (name: string, opts: Record<string, unknown>) => Promise<unknown>
    }
  }>,
  buildQueuedAdmissionMetaFn: typeof buildQueuedAdmissionMeta,
  params: {
    resolvedProjectId: string
    taskQueue: string
    user: UserInfo
    workflowArgs: Record<string, unknown>
    workflowId: string
    // Workflow type to start; defaults to the standard Story Mode workflow.
    // The regenerate flow rides the same admission queue with its own slim
    // workflow (same start-paused signal contract).
    workflowName?: string
  },
): Promise<{ projectId: string; workflowId: string }> {
  const {
    resolvedProjectId,
    taskQueue,
    user,
    workflowArgs,
    workflowId,
    workflowName = STORY_MODE_WORKFLOW_NAME,
  } = params

  const client = await createClient()
  const admissionTier = STORY_MODE_ADMISSION_TIER
  const queuedAtMs = Date.now()
  const startPaused = !getIgnoredAdmissionControl()
  const queuedWorkflowArgs = { ...workflowArgs, admissionTier, queuedAtMs, startPaused }
  const admissionPayload: LongTakeAdmissionPayload = {
    projectId: resolvedProjectId,
    queuedAtMs,
    taskQueue,
    tier: admissionTier,
    userEmail: user.email || undefined,
    userId: user.sub,
    workflowArgs: queuedWorkflowArgs,
    workflowExecutionTimeout: LONG_TAKE_QUEUED_WORKFLOW_TIMEOUT,
    workflowId,
    workflowName,
    workflowRunTimeout: LONG_TAKE_QUEUED_WORKFLOW_TIMEOUT,
  }

  await enqueueLongTakeAdmission(deps.kv, admissionPayload)

  try {
    await client.workflow.start(workflowName, {
      args: [queuedWorkflowArgs],
      taskQueue,
      workflowId,
      workflowRunTimeout: LONG_TAKE_QUEUED_WORKFLOW_TIMEOUT,
      workflowExecutionTimeout: LONG_TAKE_QUEUED_WORKFLOW_TIMEOUT,
    })
  } catch (error) {
    await Promise.all([
      removeQueuedLongTakeProject(deps.kv, {
        projectId: admissionPayload.projectId,
        taskQueue: admissionPayload.taskQueue,
        tier: admissionPayload.tier,
      }),
      deleteLongTakeAdmissionPayload(deps.kv, admissionPayload.projectId),
    ]).catch((cleanupError) => {
      deps.logger.warn(
        {
          cleanupError: ensureError(cleanupError),
          projectId: resolvedProjectId,
        },
        'Failed to clean up Story Mode admission state after start failure',
      )
    })
    throw error
  }

  try {
    const queuedMeta = await buildQueuedAdmissionMetaFn(deps, resolvedProjectId, admissionPayload)
    // Publish status directly (KV store + SSE) -- pushChunks is worker-to-API only.
    const statusData = {
      meta: queuedMeta,
      stage: 'queued' as const,
      status: 'in_progress' as const,
      updatedAt: new Date().toISOString(),
    }
    const statusKey = getLongTakeStatusKey(resolvedProjectId)
    await deps.kv.set(statusKey, statusData, LONG_TAKE_STATUS_TTL_SECONDS)
    const bus = await SSEFactory.getSSEBus(resolvedProjectId)
    await bus?.push({ type: 'long-take-status', data: statusData })
  } catch (statusError) {
    const statusErr = ensureError(statusError)
    deps.logger.warn(
      `Failed to publish queued Story Mode admission status ${JSON.stringify({
        projectId: resolvedProjectId,
        error: { message: statusErr.message, name: statusErr.name },
      })}`,
    )
  }

  deps.logger.log(
    `Story Mode workflow started in paused admission state ${JSON.stringify({
      admissionTier,
      projectId: resolvedProjectId,
      workflowId,
      taskQueue,
    })}`,
  )

  return { projectId: resolvedProjectId, workflowId }
}
