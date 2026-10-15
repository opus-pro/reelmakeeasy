import * as fs from 'node:fs'
import * as path from 'node:path'

import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'

import { formatError, formatLogFields, logger } from './common'
import { createLongTakeStorage } from './storage'

export const LONG_TAKE_TRANSITION_ARTIFACTS_DIR = 'long_take/transitions/artifacts'

export async function ensureLongTakeTransitionArtifactsDir(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<void> {
  await storage.ensureDir(LONG_TAKE_TRANSITION_ARTIFACTS_DIR)
}

export async function persistTransitionArtifacts(params: {
  attempt: number
  generatedPath: string
  projectId: string
  storage: ReturnType<typeof createLongTakeStorage>
  tempDir: string
  transitionId: string
}): Promise<void> {
  const { attempt, generatedPath, projectId, storage, tempDir, transitionId } = params

  await Promise.all([
    uploadTransitionArtifact({
      label: 'first_frame_resized',
      localPath: path.join(tempDir, `${transitionId}_first_frame_resized.png`),
      projectId,
      storage,
      storagePath: `${LONG_TAKE_TRANSITION_ARTIFACTS_DIR}/${transitionId}/first_frame_resized.png`,
      transitionId,
    }),
    uploadTransitionArtifact({
      label: 'last_frame_resized',
      localPath: path.join(tempDir, `${transitionId}_last_frame_resized.png`),
      projectId,
      storage,
      storagePath: `${LONG_TAKE_TRANSITION_ARTIFACTS_DIR}/${transitionId}/last_frame_resized.png`,
      transitionId,
    }),
    uploadTransitionArtifact({
      label: 'pre_retime_video',
      localPath: generatedPath,
      projectId,
      storage,
      storagePath: `${LONG_TAKE_TRANSITION_ARTIFACTS_DIR}/${transitionId}/attempt-${attempt}_pre_retime.mp4`,
      transitionId,
    }),
  ])
}

async function uploadTransitionArtifact(params: {
  label: string
  localPath: string
  projectId: string
  storage: ReturnType<typeof createLongTakeStorage>
  storagePath: string
  transitionId: string
}): Promise<void> {
  const { label, localPath, projectId, storage, storagePath, transitionId } = params

  try {
    await fs.promises.access(localPath, fs.constants.F_OK)
  } catch {
    return
  }

  try {
    await uploadToStore(localPath, storage.getFullPath(storagePath))
    logger.info(
      `[long-take] Saved transition artifact ${formatLogFields({
        artifact: storagePath,
        label,
        projectId,
        transitionId,
      })}`,
    )
  } catch (error) {
    logger.warn(
      `[long-take] Failed to save transition artifact ${formatLogFields({
        artifact: storagePath,
        err: formatError(error),
        label,
        projectId,
        transitionId,
      })}`,
    )
  }
}
