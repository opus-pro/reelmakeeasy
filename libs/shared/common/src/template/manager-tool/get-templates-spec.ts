import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { cloneDeep } from 'lodash-es'

import { createStorage, type Storage } from '../../agent-v2/storage/storage'
import { getEvalSandboxId, getIsEvalMode } from '../../job-context'
import { logger } from '../../logger/index'
import {
  storedFileExists,
  downloadStoredFile,
  workspaceUri,
  uploadToStore,
} from '../../storage/stored-files'
import {
  RenderTemplate,
  TemplateGroup,
  TemplateInfo,
  TemplateMetadata,
  TemplateParams,
} from '../type'

import { getTemplatesUri } from './template-paths'
import {
  AVATAR_GROUP_NAME_DESC_MAP,
  extractTemplatesGroupList,
  extractTemplatesInfo,
  extractTemplatesMetadata,
  extractTemplatesParams,
  GROUP_NAME_DESC_MAP,
  preprocessAvatarTemplates,
  preprocessTemplates,
} from './utils'

export async function getAllTemplatesSpec(): Promise<RenderTemplate[]> {
  const gsUrl = getTemplatesUri('current_template_snapshot.json')

  let data: RenderTemplate[] = []

  try {
    try {
      const tmpDir = os.tmpdir()
      const tmpFile = path.join(tmpDir, `current_template_snapshot_${Date.now()}.json`)
      await downloadStoredFile(gsUrl, tmpFile)
      const jsonString = await fsPromises.readFile(tmpFile, 'utf8')
      await fsPromises.unlink(tmpFile)
      data = JSON.parse(jsonString) as RenderTemplate[]
    } catch (error) {
      logger.error({ error }, 'Failed to parse templates from storage')
      const jsonString = await fsPromises.readFile(
        path.join(
          process.cwd(),
          'libs/shared/common/src/template/manager-tool/current_template_snapshot.json',
        ),
        'utf8',
      )
      data = JSON.parse(jsonString) as RenderTemplate[]
    }
  } catch (error) {
    logger.error({ error }, 'Failed to get templates info')
  }

  return data
}
export async function getAvatarTemplatesGroupList(projectId: string): Promise<TemplateGroup[]> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessAvatarTemplates(templates)
  return extractTemplatesGroupList(templates, AVATAR_GROUP_NAME_DESC_MAP)
}
export async function getAvatarTemplatesInfo(projectId: string): Promise<TemplateInfo> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessAvatarTemplates(templates)
  return extractTemplatesInfo(templates)
}
export async function getAvatarTemplatesMetadata(
  projectId: string,
): Promise<Record<string, TemplateMetadata>> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessAvatarTemplates(templates)
  return extractTemplatesMetadata(templates)
}
export async function getAvatarTemplatesParams(projectId: string): Promise<TemplateParams> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessAvatarTemplates(templates)
  return extractTemplatesParams(templates)
}
export async function getAvatarTemplatesSpec(projectId: string) {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessAvatarTemplates(templates)
  return templates
}
export async function getTemplatesGroupList(
  projectId: string,
  filterCb?: (template: RenderTemplate) => boolean,
): Promise<TemplateGroup[]> {
  let templates = await getProjectTemplatesSpec(projectId)
  preprocessTemplates(templates)
  filterCb && (templates = templates.filter(filterCb))
  return extractTemplatesGroupList(templates, GROUP_NAME_DESC_MAP)
}
export async function getTemplatesInfo(projectId: string): Promise<TemplateInfo> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessTemplates(templates)
  return extractTemplatesInfo(templates)
}
export async function getTemplatesMetadata(
  projectId: string,
): Promise<Record<string, TemplateMetadata>> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessTemplates(templates)
  return extractTemplatesMetadata(templates)
}
export async function getTemplatesParams(projectId: string): Promise<TemplateParams> {
  const templates = await getProjectTemplatesSpec(projectId)
  preprocessTemplates(templates)
  return extractTemplatesParams(templates)
}
export async function setProjectTemplatesSpec(projectId: string) {
  const templates = await getAllTemplatesSpec()

  const projectStoreUri = workspaceUri(projectId, 'atomic-templates', 'spec.json')

  // Check if the file already exists
  const fileExists = await storedFileExists(projectStoreUri)

  if (fileExists) {
    logger.info({ projectStoreUri }, 'Templates already exist at')
  } else {
    // Create a temporary file
    const tempDir = os.tmpdir()
    const tempFilePath = path.join(tempDir, `reelmakeeasy-templates-${Date.now()}.json`)

    try {
      // Write templates to temporary file
      await fs.promises.writeFile(tempFilePath, JSON.stringify(templates, null, 2))

      // Upload to storage
      await uploadToStore(tempFilePath, projectStoreUri)

      logger.info({ projectStoreUri }, 'Successfully uploaded templates to')
    } catch (error) {
      logger.error({ error, projectStoreUri }, 'Failed to upload templates to')
      throw error
    } finally {
      // Clean up temporary file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath)
      }
    }
  }
}

// Relative path of the per-project templates spec within its storage root
// (projects/{projectId}/... for storage, evals/sandbox/{sandboxId}/projects/{projectId}/...
// for the eval sandbox, tmp/agents_workspace/{projectId}/... for legacy NFS).
const TEMPLATES_SPEC_RELATIVE_PATH = 'atomic-templates/spec.json'

/**
 * Whether a storage error confirms the object is genuinely absent (as opposed to
 * a transient storage / network failure). Only a confirmed-missing object may fall
 * back to the global default templates; every other error must propagate so a
 * customized project is never rendered with defaults on a transient blip.
 */
function isConfirmedMissingError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    // storage download throws ApiError with code 404; local fs throws ENOENT.
    return code === 404 || code === 'ENOENT'
  }
  return false
}

/**
 * Read (and, when confirmed-missing, seed) the project's templates spec through
 * the file store. `createStorage` resolves the eval sandbox vs default
 * root internally, so the seed on a cache-miss writes to the SAME location the
 * read looked at instead of the legacy
 * `projects/{projectId}` path that `setProjectTemplatesSpec` uploads to.
 */
async function getProjectTemplatesSpecFromStore(projectId: string): Promise<RenderTemplate[]> {
  const storage: Storage = await createStorage(projectId)

  try {
    return await storage.readJsonFile<RenderTemplate[]>(TEMPLATES_SPEC_RELATIVE_PATH)
  } catch (error) {
    if (!isConfirmedMissingError(error)) {
      // Transient error: do NOT silently return global defaults, which would
      // render a customized project with defaults. Propagate so the caller retries.
      logger.error(
        { error, projectId },
        'Transient error reading project templates spec from storage; propagating',
      )
      throw error
    }

    // Confirmed missing: seed defaults through the same storage the read used.
    const defaultTemplates = await getAllTemplatesSpec()
    if (defaultTemplates.length === 0) {
      // getAllTemplatesSpec swallows load/parse errors and returns []. Never
      // persist an empty spec -- that would turn a transient snapshot outage
      // into durable missing-template data. Propagate so the caller retries.
      throw new Error(
        `Refusing to seed empty templates spec for ${projectId}: default snapshot failed to load`,
      )
    }
    // Guard against a writer that populated the spec between our 404 and this
    // seed (a concurrent render seeding, or a customization write): re-read once
    // and prefer an existing spec over clobbering it with defaults.
    try {
      return await storage.readJsonFile<RenderTemplate[]>(TEMPLATES_SPEC_RELATIVE_PATH)
    } catch (reReadError) {
      if (!isConfirmedMissingError(reReadError)) {
        throw reReadError
      }
    }
    await storage.writeJsonFile(TEMPLATES_SPEC_RELATIVE_PATH, defaultTemplates)
    logger.info({ projectId }, 'Seeded default project templates spec to storage')
    return defaultTemplates
  }
}

/**
 * Coalescing key for concurrent `getProjectTemplatesSpec` calls. Keying by
 * projectId alone would let eval runs (isolated per sandbox) share a result, so
 * the sandbox id is folded into the key so differing contexts never
 * cross-contaminate.
 */
function buildPendingKey(projectId: string): string {
  const sandboxId = getIsEvalMode() ? getEvalSandboxId() : null
  return `${projectId}::sandbox=${sandboxId ?? ''}`
}

const pendingProjectTemplatesRequests = new Map<string, Promise<RenderTemplate[]>>()
export async function getProjectTemplatesSpec(projectId: string): Promise<RenderTemplate[]> {
  const pendingKey = buildPendingKey(projectId)
  let pending = pendingProjectTemplatesRequests.get(pendingKey)

  if (pending) {
    logger.info('Reusing pending request for project templates')
  } else {
    pending = getProjectTemplatesSpecFromStore(projectId).finally(() => {
      pendingProjectTemplatesRequests.delete(pendingKey)
    })
    pendingProjectTemplatesRequests.set(pendingKey, pending)
  }

  const templates = await pending
  return cloneDeep(templates)
}
