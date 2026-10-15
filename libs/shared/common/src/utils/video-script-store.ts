import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { logger } from '../logger'
import type { VideoScript } from '../types/video-script'
import type { RenderVideoParams } from '../workflow/workflow/render/types'

import { downloadStoredFile, workspaceUri, uploadBufferToStore } from '../storage/stored-files'
import { readJsonFile } from './path.util'

/**
 * Returns the store address used for uploading a video script for a render workflow.
 * Path includes videoId so concurrent renders do not collide.
 */
export function getVideoScriptRenderUri(projectId: string, videoId: string): string {
  return workspaceUri(projectId, 'render', videoId, 'video-script-input.json')
}

/**
 * Serializes the video script to JSON, uploads it to storage, and returns the store address.
 * Callers should pass this URI in workflow params (videoScriptUri) instead of the full object.
 */
export async function uploadVideoScriptForRender(
  projectId: string,
  videoId: string,
  videoScript: VideoScript,
): Promise<string> {
  const fileUri = getVideoScriptRenderUri(projectId, videoId)
  const buffer = Buffer.from(JSON.stringify(videoScript), 'utf8')
  await uploadBufferToStore(buffer, fileUri, {
    contentType: 'application/json',
  })
  return fileUri
}

/**
 * Resolves the video script from render params: prefers videoScriptUri (download from storage),
 * falls back to inline videoScript. Throws if neither is present.
 */
export async function resolveVideoScript(
  renderParams: Partial<Pick<RenderVideoParams, 'videoScript' | 'videoScriptUri'>>,
): Promise<VideoScript> {
  if (renderParams.videoScriptUri) {
    const tmpPath = path.join(os.tmpdir(), `vs-${randomUUID()}.json`)
    try {
      await downloadStoredFile(renderParams.videoScriptUri, tmpPath)
      return (await readJsonFile<VideoScript>(tmpPath)) as VideoScript
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined)
    }
  }
  if (renderParams.videoScript) {
    const sizeBytes = Buffer.byteLength(JSON.stringify(renderParams.videoScript))
    if (sizeBytes > 2 * 1024 * 1024) {
      logger.warn(
        { sizeBytes },
        'videoScript passed inline exceeds 2MB -- should use videoScriptUri',
      )
    }
    return renderParams.videoScript
  }
  throw new Error('Neither videoScriptUri nor videoScript provided in RenderVideoParams')
}
