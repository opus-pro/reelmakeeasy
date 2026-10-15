import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { serveStoredUrls, toSavedAddresses } from '@reelmakeeasy/common/storage/address'
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'
import type {
  LongTakeEditorDraft,
  SaveLongTakeEditorDraftRequest,
} from '@shared/types/api/long-take'

import type { ProjectService } from '../projects/projects.service'

import { readOptionalJsonFile } from './long-take-helpers.util'

const logger = createSubLogger('long-take-editor-draft')

/** stored file path (relative to the project root `projects/{projectId}/`). */
export const EDITOR_DRAFT_PATH = 'long_take/editor_draft.json'

export async function getEditorDraftForProject(
  projectsService: Pick<ProjectService, 'canVisitProject'>,
  projectId: string,
): Promise<LongTakeEditorDraft | null> {
  if (!(await projectsService.canVisitProject(projectId))) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }
  // The draft keeps addresses; the browser wrote it with URLs, and gets them back.
  const draft = await readEditorDraft(await createStorage(projectId))
  return draft && serveStoredUrls(draft, { everyField: true })
}

export async function readEditorDraft(
  storage: Awaited<ReturnType<typeof createStorage>>,
): Promise<LongTakeEditorDraft | null> {
  return (await readOptionalJsonFile<LongTakeEditorDraft>(storage, EDITOR_DRAFT_PATH)) ?? null
}

export async function saveEditorDraftForProject(
  projectsService: Pick<ProjectService, 'canVisitProject'>,
  projectId: string,
  input: SaveLongTakeEditorDraftRequest,
): Promise<LongTakeEditorDraft> {
  if (!(await projectsService.canVisitProject(projectId))) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }
  const body = input as null | Partial<SaveLongTakeEditorDraftRequest> | undefined
  if (
    !body ||
    typeof body.baseRevision !== 'string' ||
    !body.baseRevision ||
    !Array.isArray(body.snapshots)
  ) {
    throw new BadRequestException('baseRevision and a snapshots array are required')
  }
  if (
    body.workingState !== undefined &&
    (!body.workingState ||
      !Array.isArray(body.workingState.keyframes) ||
      !Array.isArray(body.workingState.transitions))
  ) {
    throw new BadRequestException('workingState must contain keyframes and transitions arrays')
  }
  const storage = await createStorage(projectId)
  // Optimistic concurrency: reject a save built on a stale draft so a second
  // editor of the same (now org-shared) project cannot silently clobber a newer
  // draft. Matches the render path's expectedRevision guard.
  const current = await readEditorDraft(storage)
  if (current && current.updatedAt !== body.baseUpdatedAt) {
    logger.warn(
      { baseUpdatedAt: body.baseUpdatedAt, currentUpdatedAt: current.updatedAt, projectId },
      'Rejecting editor draft save: baseUpdatedAt does not match the stored draft',
    )
    throw new ConflictException('Editor draft was updated elsewhere; reload to get the latest')
  }
  const draft: LongTakeEditorDraft = {
    baseRevision: body.baseRevision,
    snapshots: body.snapshots,
    ...(body.workingState ? { workingState: body.workingState } : {}),
    updatedAt: Date.now(),
  }
  // Saved with addresses in place of the URLs the browser sent: nothing saved holds a
  // host or port.
  await writeEditorDraft(storage, toSavedAddresses(draft, { everyField: true }))
  return draft
}

export async function writeEditorDraft(
  storage: Awaited<ReturnType<typeof createStorage>>,
  draft: LongTakeEditorDraft,
): Promise<void> {
  await storage.writeFile(EDITOR_DRAFT_PATH, JSON.stringify(draft))
}
