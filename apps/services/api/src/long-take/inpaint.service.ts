import { createHash, randomUUID } from 'node:crypto'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { LOCAL_USER_EMAIL } from '@reelmakeeasy/common/auth/local-identity'
import { fillState } from '@reelmakeeasy/common/inpaint/fill-state'
import { readInpaintState, writeInpaintStateIfAbsent } from '@reelmakeeasy/common/inpaint/state-store'
import { toInpaintPublicState } from '@reelmakeeasy/common/inpaint/project-public-state'
import type {
  InpaintPublicState,
  InpaintReference,
  InpaintRegion,
} from '@reelmakeeasy/common/inpaint/public-state'
import { inpaintDurableReferencePrefix } from '@reelmakeeasy/common/inpaint/reference-path'
import { inpaintSSEBusKey } from '@reelmakeeasy/common/inpaint/sse'
import type { InpaintGlobalState } from '@reelmakeeasy/common/inpaint/state'
import { deriveInpaintTimelineEvents } from '@reelmakeeasy/common/inpaint/timeline-events'
import type { InpaintHistoryData, InpaintModelFamily } from '@reelmakeeasy/common/inpaint/types'
import { Logger } from '@reelmakeeasy/common/logger'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import {
  copyStoredFile,
  keyIsUnder,
  parseStoreUri,
  storeUri,
} from '@reelmakeeasy/common/storage/stored-files'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { hexToUuidV4 } from '@reelmakeeasy/common/utils/uuid'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import { withWorkflowRevival } from '@reelmakeeasy/common/workflow/workflow-revival'
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowUpdateFailedError,
} from '@reelmakeeasy/workflow-engine/client'
import { ApplicationFailure, WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { InpaintTimelineEventsResponse } from '@shared/types/api/long-take'
import type { ProjectForBackend } from '@shared/types/api/project'

import { ProjectService } from '../projects/projects.service'

import { readInpaintBaseFiles } from './inpaint-base-files.util'
import { mapInpaintError } from './inpaint-errors'
import { resolveInpaintProvenanceFamily } from './inpaint-model-resolution.util'
import { resolvePlanModelFamily } from './inpaint-plan-model.util'
import { readDebugSettings } from './long-take-regenerate.util'

const INPAINT_WORKFLOW_NAME = 'InpaintWorkflow'

const KEY_MAX_LEN = 128

export interface CreateEditContextParams {
  // Opt the edit into server-side auto-apply on gen resolve (range-selection flow).
  autoApply?: boolean
  editId: string
  editPrompt?: string
  historyId: string
  // User-attached reference images, as store paths only (never bytes).
  references?: InpaintReference[]
  // Frame region the user boxed to scope the instruction.
  region?: InpaintRegion
  timestampSec: number
  transitionId: string
  transitionIds?: string[]
}

export interface GenerateEditVideoParams {
  anchorId: string
  clientId?: string
  editId: string
  // Retained only for wire compatibility with older clients; the server always
  // resolves the family server-side from source-video provenance and ignores this.
  modelFamily?: InpaintModelFamily
  nonce?: string
  planRunId: string
}

export interface RestoreTransitionParams {
  clientId?: string
  transitionId: string
  versionId: string
}

export interface RestoreTransitionsParams {
  clientId?: string
  clips: { transitionId: string; versionId: string }[]
}

export interface UpdateEditContextParams {
  clientId?: string
  editId: string
  editPrompt?: string
  // User-attached reference images, as store paths only (never bytes). Pass null to clear.
  references?: InpaintReference[] | null
  // Frame region the user boxed to scope the instruction. Pass null to clear.
  region?: InpaintRegion | null
  selectedAnchorId?: null | string
}

// executeUpdate() rejects with a bare ApplicationFailure only when the update
// handler itself throws one; the validator-rejection path (e.g. ALREADY_DONE)
// arrives wrapped in a WorkflowUpdateFailedError whose .cause is the
// ApplicationFailure. Unwrap both shapes so runUpdate's errorHandler sees either.
function toApplicationFailure(error: unknown): ApplicationFailure | undefined {
  if (error instanceof ApplicationFailure) {
    return error
  }
  if (error instanceof WorkflowUpdateFailedError && error.cause instanceof ApplicationFailure) {
    return error.cause
  }
  return undefined
}

// Returned by an errorHandler that declines to treat the unwrapped ApplicationFailure
// as success. runUpdate then falls through to mapInpaintError with the ORIGINAL caught
// error (not the unwrapped one), since mapInpaintError's richest branch reads
// WorkflowUpdateFailedError.cause.nonRetryable to pick the right HTTP status.
const UNHANDLED = Symbol('unhandled')

@Injectable()
export class InpaintService {
  private readonly logger = new Logger(InpaintService.name)

  constructor(private readonly projectsService: ProjectService) {}

  async applyEditContext(
    projectId: string,
    runId: string,
    editId: string,
    clientId?: string,
  ): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    const updateArgs = {
      at: Date.now(),
      clientId: clientId ? this.hashKey(clientId) : randomUUID(),
      editId,
      runId,
    }
    await this.runUpdate(projectId, 'inpaint.applyEditContext', [updateArgs])
  }

  async continueAsNew(projectId: string): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    const workflowId = this.buildWorkflowId(projectId)
    const client = await createClient()

    try {
      const handle = client.workflow.getHandle(workflowId)
      await handle.executeUpdate('inpaint.continueAsNew')
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) {
        throw error
      }
    }
  }

  async createEditContext(projectId: string, params: CreateEditContextParams): Promise<void> {
    const project = await this.assertCanAccess(projectId, 'write')
    // modelFamily is resolved server-side from provenance, never the client -- see the
    // comment on CreateEditContextParams.modelFamily.
    const modelFamily = resolveInpaintProvenanceFamily(readDebugSettings(project.debugSettings))
    const references = await this.promoteReferences(projectId, params.references)
    await this.runUpdate(projectId, 'inpaint.createEditContext', [
      {
        ...params,
        modelFamily,
        references,
        at: Date.now(),
        userId: getReqContext().user_id || undefined,
      },
    ])
  }

  async finish(projectId: string): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    const workflowId = this.buildWorkflowId(projectId)
    const client = await createClient()

    try {
      const handle = client.workflow.getHandle(workflowId)
      await handle.executeUpdate('inpaint.finish')
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) {
        throw error
      }
    }
  }

  async generateAnchorImage(
    projectId: string,
    editId: string,
    nonce: string,
    clientId?: string,
  ): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    const updateArgs = {
      at: Date.now(),
      clientId: clientId ? this.hashKey(clientId) : undefined,
      editId,
      nonce: this.hashKey(nonce),
    }
    await this.runUpdate(projectId, 'inpaint.generateAnchorImage', [updateArgs])
  }

  async generateEditVideo(projectId: string, params: GenerateEditVideoParams): Promise<void> {
    const project = await this.assertCanAccess(projectId, 'write')
    // modelFamily is resolved server-side, not read from params -- see the comment on
    // GenerateEditVideoParams.modelFamily; a stale/contradicting client value is ignored.
    const modelFamily = await resolvePlanModelFamily(
      projectId,
      params.planRunId,
      readDebugSettings(project.debugSettings),
      project.orgId,
    )
    const updateArgs = {
      ...params,
      modelFamily,
      at: Date.now(),
      clientId: params.clientId ? this.hashKey(params.clientId) : undefined,
      nonce: params.nonce ? this.hashKey(params.nonce) : undefined,
    }
    await this.runUpdate(projectId, 'inpaint.generateEditVideo', [updateArgs])
    // The clip's started event is emitted by the editor worker, off the workflow state,
    // so that it carries the same run id as the matching failed event and so that a
    // retry (which never reaches this method) reports a start too. See
    // gen-lifecycle-events.ts in the editor service.
  }

  async getSSEBus(projectId: string) {
    await this.assertCanAccess(projectId, 'read')
    const workflowId = this.buildWorkflowId(projectId)
    return SSEFactory.getSSEBus(inpaintSSEBusKey(workflowId))
  }

  async getState(projectId: string): Promise<{ state: InpaintPublicState }> {
    await this.assertCanAccess(projectId, 'read')
    return { state: toInpaintPublicState(await this.ensureInitialState(projectId)) }
  }

  async getTimelineEvents(
    projectId: string,
    limit?: number,
    before?: number,
    beforeId?: string,
  ): Promise<InpaintTimelineEventsResponse> {
    await this.assertCanAccess(projectId, 'read')
    // A legacy project with no blob yet still gets its initial base history
    // rather than an empty timeline, but this read never persists it.
    const { state } = await this.resolveInitialState(projectId)
    return deriveInpaintTimelineEvents(state.history, state.business.edits, {
      before,
      beforeId,
      limit,
    })
  }

  async goto(projectId: string, targetId: string): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    await this.runUpdate(projectId, 'inpaint.goto', [{ at: Date.now(), targetId }], (error) =>
      // ALREADY_DONE = validator rejected a no-op (already at targetId); treat as success.
      error.type === 'ALREADY_DONE' ? undefined : UNHANDLED,
    )
  }

  async hideEditContext(
    projectId: string,
    editId: string,
    hidden: boolean,
    clientId?: string,
  ): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    await this.runUpdate(projectId, 'inpaint.hideEditContext', [
      {
        at: Date.now(),
        clientId: clientId ? this.hashKey(clientId) : undefined,
        editId,
        hidden,
      },
    ])
  }

  async restoreTransition(projectId: string, params: RestoreTransitionParams): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    await this.runUpdate(
      projectId,
      'inpaint.restoreTransition',
      [
        {
          at: Date.now(),
          clientId: params.clientId ? this.hashKey(params.clientId) : undefined,
          transitionId: params.transitionId,
          versionId: params.versionId,
        },
      ],
      (error) =>
        // ALREADY_DONE = validator rejected a no-op (already at versionId); treat as success.
        error.type === 'ALREADY_DONE' ? undefined : UNHANDLED,
    )
  }

  async restoreTransitions(projectId: string, params: RestoreTransitionsParams): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    await this.runUpdate(
      projectId,
      'inpaint.restoreTransitions',
      [
        {
          at: Date.now(),
          clientId: params.clientId ? this.hashKey(params.clientId) : undefined,
          clips: params.clips,
        },
      ],
      (error) =>
        // ALREADY_DONE = validator rejected a no-op (already at versionId); treat as success.
        error.type === 'ALREADY_DONE' ? undefined : UNHANDLED,
    )
  }

  async retryRun(
    projectId: string,
    runId: string,
    modelFamilyOverride?: InpaintModelFamily,
  ): Promise<{ newRunId?: string; retried: boolean }> {
    await this.assertCanAccess(projectId, 'write')
    return this.runUpdate<
      [{ modelFamilyOverride?: InpaintModelFamily; runId: string }],
      { newRunId?: string; retried: boolean }
    >(projectId, 'inpaint.retryRun', [{ modelFamilyOverride, runId }])
  }

  async startSession(projectId: string) {
    await this.assertCanAccess(projectId, 'write')
    await this.doStartWorkflow(projectId)
    return {}
  }

  async updateEditContext(projectId: string, params: UpdateEditContextParams): Promise<void> {
    await this.assertCanAccess(projectId, 'write')
    const references = await this.promoteReferences(projectId, params.references)
    const updateArgs = {
      ...params,
      references,
      at: Date.now(),
      clientId: params.clientId ? this.hashKey(params.clientId) : undefined,
    }
    await this.runUpdate(projectId, 'inpaint.updateEditContext', [updateArgs])
  }

  private async assertCanAccess(
    projectId: string,
    mode: 'read' | 'write',
  ): Promise<ProjectForBackend> {
    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new UnauthorizedException('You are not authorized to access this project')
    }

    // Single-user instance: reads are always allowed; writes need the project to
    // belong to this instance's org or its local user.
    const reqOrgId = getReqContext().org_id
    if (
      mode === 'read' ||
      (reqOrgId && reqOrgId === project.orgId) ||
      project.ownerEmail === LOCAL_USER_EMAIL
    ) {
      return project
    }

    throw new UnauthorizedException('You are not authorized to access this project')
  }

  private async buildInitialHistory(projectId: string): Promise<InpaintHistoryData> {
    const storage = await createStorage(projectId)
    const { keyframes, transitions } = await readInpaintBaseFiles(storage)
    const baseId = hexToUuidV4(
      createHash('sha256').update(JSON.stringify({ keyframes, transitions })).digest('hex'),
    )
    return {
      base: { id: baseId, keyframes, transitions },
      currentId: baseId,
      diffs: {},
      latestId: baseId,
    }
  }

  private buildWorkflowId(projectId: string): string {
    return getWorkflowId(projectId, 'inpaint')
  }

  private async doStartWorkflow(projectId: string): Promise<void> {
    const workflowId = this.buildWorkflowId(projectId)
    const client = await createClient()
    const taskQueue = await resolveTaskQueueForClient('ao-editor')
    const state = await this.ensureInitialState(projectId)
    try {
      await client.workflow.start(INPAINT_WORKFLOW_NAME, {
        args: [{ projectId, state }],
        taskQueue,
        workflowId,
        workflowExecutionTimeout: '7 days',
      })
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        throw error
      }
    }
  }

  private async ensureInitialState(projectId: string): Promise<InpaintGlobalState> {
    const { built, state } = await this.resolveInitialState(projectId)
    if (!built) {
      return state
    }
    try {
      // The state stored first wins: a concurrent start gets that one back, not its own.
      return await writeInpaintStateIfAbsent(projectId, state)
    } catch (error) {
      this.logger.warn(
        `ensureInitialState: storing the state for ${projectId} failed: ${ensureError(error).message}`,
      )
      return state
    }
  }

  private hashKey(key: string): string {
    if (key.length > KEY_MAX_LEN) {
      throw new BadRequestException(`key must be at most ${KEY_MAX_LEN} characters`)
    }
    return createHash('sha256').update(key).digest('hex').slice(0, 16)
  }

  // Copies each accepted reference out of the client-writable tmp/ prefix into a
  // durable per-project prefix, so it survives project purge (which only sweeps
  // projects/{projectId}/ and agent/workspace/{projectId}/, never tmp/). Already-durable
  // references pass through untouched, which makes re-issuing the same edit args
  // (e.g. a timeline range drag that resends its merge-patch) idempotent.
  private async promoteReferences(
    projectId: string,
    references: InpaintReference[] | null | undefined,
  ): Promise<InpaintReference[] | null | undefined> {
    if (!references?.length) {
      return references
    }
    const durablePrefix = inpaintDurableReferencePrefix(projectId)
    return Promise.all(
      references.map(async (reference) => {
        // Judged by the checked key, the same way isAllowedInpaintReferencePath does.
        // Matching the raw address instead would treat an encoded form of an
        // already-durable path as a tmp/ path and copy it again, re-keying the anchor
        // cache for a file that is already where it belongs.
        const decodedSource = parseStoreUri(reference.fileUri)
        if (keyIsUnder(decodedSource, durablePrefix)) {
          return reference
        }
        const basename = decodedSource.split('/').findLast(Boolean) || 'reference'
        // Digest of the source path, NOT a fresh uuid: the stored fileUri is part of the
        // anchor cache key (editor cache-keys.ts), so a random destination would give a
        // retried request a different key, missing the cache and running the same
        // attachment a second time. Keying on the source makes the copy
        // idempotent, so a retry overwrites the same object with the same bytes.
        const destDir = createHash('sha256').update(decodedSource).digest('hex').slice(0, 32)
        const destUri = storeUri(`${durablePrefix}/${destDir}/${basename}`)
        // Deliberately not degraded the way uip-uploaded-assets.ts degrades: keeping the
        // tmp/ path would restore the retention gap this copy exists to close, and
        // dropping the reference would silently change what the user asked for. That
        // helper can afford to drop because it also decodes content; this only moves
        // bytes, so a failure has no safe fallback and must propagate.
        await copyStoredFile(reference.fileUri, destUri)
        return { ...reference, fileUri: destUri }
      }),
    )
  }

  // Read-only half of ensureInitialState: builds the initial state for a
  // project with no blob yet but never persists it, so a GET stays side-effect free.
  // `built` tells the caller whether persisting is still owed.
  private async resolveInitialState(
    projectId: string,
  ): Promise<{ built: boolean; state: InpaintGlobalState }> {
    const existing = await readInpaintState(projectId)
    if (existing) {
      return { built: false, state: existing }
    }
    const history = await this.buildInitialHistory(projectId)
    return {
      built: true,
      state: fillState({ business: { legacyDraftDropped: false }, history }),
    }
  }

  // Runs a workflow update with automatic session revival. The operation lets the
  // raw workflow error escape so withWorkflowRevival can detect a missing
  // workflow and start it. errorHandler is consulted with the unwrapped
  // ApplicationFailure (e.g. to special-case ALREADY_DONE as a no-op success) but
  // returning UNHANDLED defers to mapInpaintError on the original caught error, so
  // the wrapper-aware branches (e.g. WorkflowUpdateFailedError.cause.nonRetryable)
  // still apply.
  private async runUpdate<TArgs extends [unknown, ...unknown[]], TReturn = void>(
    projectId: string,
    updateName: string,
    args: TArgs,
    errorHandler?: (error: ApplicationFailure) => TReturn | typeof UNHANDLED,
  ): Promise<TReturn> {
    const workflowId = this.buildWorkflowId(projectId)
    try {
      const result = await withWorkflowRevival(
        workflowId,
        () => this.doStartWorkflow(projectId),
        async () => {
          const handle = (await createClient()).workflow.getHandle(workflowId)
          return (await handle.executeUpdate(updateName, { args })) as TReturn
        },
      )
      return result
    } catch (error) {
      const applicationFailure = toApplicationFailure(error)
      if (errorHandler && applicationFailure) {
        const handled = errorHandler(applicationFailure)
        if (handled !== UNHANDLED) {
          return handled
        }
      }
      mapInpaintError(error)
    }
  }
}
