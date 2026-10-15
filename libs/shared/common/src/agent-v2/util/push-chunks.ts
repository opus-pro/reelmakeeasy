/**
 * Delivers workflow updates (status, project patches) to the API.
 *
 * Workers run inside the API process, so there is no network hop: the API
 * registers a sink at boot and every push is handed to it directly.
 */

import { getIsEvalMode } from '../../job-context'
import { logger } from '../../logger/index'
import { isTest } from '../../utils/env'

interface PushChunksResponse {
  error?: string
  success: boolean
}

export type PushedChunk = {
  [key: string]: unknown
  type: string
}

export type ChunkSink = (input: {
  chunks: PushedChunk[]
  projectId: string
  userId: string
}) => Promise<void>

let sink: ChunkSink | undefined

/** Called once by the API at boot. */
export function setChunkSink(next: ChunkSink | undefined): void {
  sink = next
}

export async function pushChunks(input: CallbackInput): Promise<PushChunksResponse> {
  // Jest and eval runs have no API to deliver to.
  if (isTest() || getIsEvalMode()) {
    return { success: true, error: '' }
  }

  const { projectId, userId, chunks } = input
  if (!sink) {
    const error = 'No chunk sink registered; is this running outside the API process?'
    logger.error(`Push chunks failed, project: ${projectId}: ${error}`)
    return { success: false, error }
  }

  try {
    await sink({ chunks, projectId, userId })
    return { success: true, error: '' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Push chunks failed, project: ${projectId}: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

type CallbackInput = {
  chunks: PushedChunk[]
  projectId: string
  userEmail?: string
  userId: string
}
