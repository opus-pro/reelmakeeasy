import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { downloadStoredFile, isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

export type ResolveVideoPathResult = {
  cleanup: () => Promise<void>
  localPath: string
}

const noop = async () => undefined

export async function resolveVideoPath(videoPath: string): Promise<ResolveVideoPathResult> {
  if (!isStoreUri(videoPath)) {
    return {
      localPath: videoPath,
      cleanup: noop,
    }
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelmakeeasy_video_'))
  const localPath = path.join(tempDir, path.basename(videoPath))
  let cleanedUp = false

  const cleanup = async () => {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    await fsp.rm(tempDir, { recursive: true, force: true })
  }

  try {
    await downloadStoredFile(videoPath, localPath)
    return {
      localPath,
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
