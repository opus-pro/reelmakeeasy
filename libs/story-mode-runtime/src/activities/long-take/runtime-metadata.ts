import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  RecordLongTakeRuntimeMetadataActivityParams,
  SaveLongTakePipelineContextActivityParams,
} from '../../workflows/long-take/types'

import { formatError, formatLogFields, logger, withLongTakeContext } from './common'
import {
  createLongTakeStorage,
  LONG_TAKE_PIPELINE_CONTEXT_PATH,
  LONG_TAKE_RUNTIME_METADATA_PATH,
  type LongTakeRuntimeMetadata,
} from './storage'

type LocalBuildInfoPayload = {
  gitSha?: string
}

export async function recordLongTakeRuntimeMetadata(
  params: RecordLongTakeRuntimeMetadataActivityParams,
): Promise<void> {
  const { projectId, userEmail, userId } = params

  await withLongTakeContext({ projectId, userEmail, userId }, async () => {
    try {
      const storage = createLongTakeStorage(projectId)
      const payload: LongTakeRuntimeMetadata = {
        gitSha: await readLocalGitSha(),
        recordedAt: new Date().toISOString(),
        workerType: resolveWorkerType(),
      }

      await storage.writeJsonFile(LONG_TAKE_RUNTIME_METADATA_PATH, payload)
      logger.info(
        `[long-take] Runtime metadata recorded ${formatLogFields({
          gitSha: payload.gitSha || 'unknown',
          projectId,
          workerType: payload.workerType,
        })}`,
      )
    } catch (error) {
      logger.warn(
        `[long-take] Failed to record runtime metadata ${formatLogFields({
          err: formatError(error),
          projectId,
        })}`,
      )
    }
  })
}

export async function saveLongTakePipelineContext(
  params: SaveLongTakePipelineContextActivityParams,
): Promise<void> {
  const { pipelineContext, projectId, userId } = params

  await withLongTakeContext({ projectId, userId }, async () => {
    try {
      const storage = createLongTakeStorage(projectId)
      await storage.writeJsonFile(LONG_TAKE_PIPELINE_CONTEXT_PATH, {
        entries: pipelineContext,
        savedAt: new Date().toISOString(),
      })
      logger.info(
        `[long-take] Pipeline context saved ${formatLogFields({
          entryCount: pipelineContext.length,
          projectId,
        })}`,
      )
    } catch (error) {
      logger.warn(
        `[long-take] Failed to save pipeline context ${formatLogFields({
          err: formatError(error),
          projectId,
        })}`,
      )
    }
  })
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

function normalizeGitSha(value: unknown): null | string {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  return /^[0-9a-f]{7,40}$/.test(trimmed) ? trimmed.slice(0, 7) : null
}

async function readLocalGitSha(): Promise<null | string> {
  for (const candidate of resolveBuildInfoCandidates()) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8')) as LocalBuildInfoPayload
      const gitSha = normalizeGitSha(parsed?.gitSha)
      if (gitSha) {
        return gitSha
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        logger.warn(
          `[long-take] Failed to read local build info ${formatLogFields({
            err: formatError(error),
            path: candidate,
          })}`,
        )
      }
    }
  }

  return null
}

function resolveBuildInfoCandidates(): string[] {
  const candidates = [
    process.env['WORKER_BUILD_INFO_PATH'],
    process.argv[1]
      ? path.join(path.dirname(path.resolve(process.argv[1])), 'build-info.json')
      : '',
    path.join(process.cwd(), 'build-info.json'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return Array.from(new Set(candidates))
}

/** Story Mode's workers run inside the API process. */
function resolveWorkerType(): string {
  return 'story-mode-worker'
}
