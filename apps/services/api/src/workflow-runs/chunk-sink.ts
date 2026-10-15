import type { ChunkSink, PushedChunk } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import type { KvStore } from '@reelmakeeasy/common/kv/store'
import { logger } from '@reelmakeeasy/common/logger'
import { MUSIC_TRACK_NAME_MAX_LENGTH } from '@reelmakeeasy/common/long-take/music-craft'
import { isOwnMusicTrackUri } from '@reelmakeeasy/common/long-take/music-tracks'
import {
  getLongTakeStatusKey,
  LONG_TAKE_STATUS_TTL_SECONDS,
} from '@reelmakeeasy/common/long-take/status-constants'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { toSavedAddress, toSavedAddresses } from '@reelmakeeasy/common/storage/address'
import { PROJECT_STAGE } from '@shared/types/enums/project'

import { STATUS_CACHE_PREFIX } from '../long-take/long-take-status.util'
import type { PrismaService } from '../prisma/prisma.service'

interface ChunkSinkDeps {
  getBus?: typeof SSEFactory.getSSEBus
  kv: KvStore
  prisma: PrismaService
}

/**
 * Applies workflow updates in-process:
 * - `long-take-status`: stores the status blob the Story Mode status endpoint
 *   reads, and streams it to connected viewers. A failed run also marks the
 *   project FAILED, which is what the project list reads.
 * - `project-patch`: writes the patch to the project and streams it.
 * - `music-track`: adds a generated bed's composition to the pushing user's music.
 * Unknown chunk types are logged and dropped.
 */
export function createChunkSink(deps: ChunkSinkDeps): ChunkSink {
  const getBus = deps.getBus ?? ((projectId: string) => SSEFactory.getSSEBus(projectId))

  return async ({ chunks, projectId, userId }) => {
    for (const chunk of chunks) {
      switch (chunk.type) {
        case 'long-take-status': {
          await applyStatus(deps, getBus, projectId, chunk)
          break
        }
        case 'music-track': {
          await applyMusicTrack(deps, userId, chunk)
          break
        }
        case 'project-patch': {
          await applyProjectPatch(deps, getBus, projectId, chunk)
          break
        }
        default: {
          logger.warn(`[chunk-sink] Dropping unknown chunk type "${chunk.type}" for ${projectId}`)
        }
      }
    }
  }
}

async function applyStatus(
  deps: ChunkSinkDeps,
  getBus: NonNullable<ChunkSinkDeps['getBus']>,
  projectId: string,
  chunk: PushedChunk,
): Promise<void> {
  const status = chunk['status'] as Record<string, unknown> | undefined
  if (!status) return
  // Kept with addresses only (no host or port); served as URLs when it is read.
  await deps.kv.set(
    getLongTakeStatusKey(projectId),
    toSavedAddresses(status),
    LONG_TAKE_STATUS_TTL_SECONDS,
  )
  if (status['status'] === 'error' || status['status'] === 'rejected') {
    await markProjectFailed(deps, projectId, status['detail'])
  }
  const bus = await getBus(projectId)
  await bus?.push({ data: status, type: 'long-take-status' })
}

// A FINISHED project keeps its stage: the failed run was a follow-up job (a
// regenerate, a restyle) and the delivered video still stands.
async function applyProjectPatch(
  deps: ChunkSinkDeps,
  getBus: NonNullable<ChunkSinkDeps['getBus']>,
  projectId: string,
  chunk: PushedChunk,
): Promise<void> {
  const content = chunk['content'] as undefined | { data?: Record<string, unknown> }
  const patch = content?.data
  if (!patch || Object.keys(patch).length === 0) return
  // The project keeps addresses only: a served URL in the patch is saved as its address.
  await deps.prisma.project.update({ data: toSavedAddresses(patch), where: { id: projectId } })
  // The status endpoint caches its answer for a few seconds; a patch (a bed's fields, the
  // delivered duration) is what it reports, so the next read must rebuild it.
  await deps.kv.del(`${STATUS_CACHE_PREFIX}${projectId}`)
  const bus = await getBus(projectId)
  await bus?.push({ data: patch, type: 'project-patch' })
}

async function markProjectFailed(
  deps: ChunkSinkDeps,
  projectId: string,
  detail: unknown,
): Promise<void> {
  await deps.prisma.project.updateMany({
    data: {
      stage: PROJECT_STAGE.FAILED,
      ...(typeof detail === 'string' && detail ? { failedReason: detail } : {}),
    },
    where: { id: projectId, stage: { not: PROJECT_STAGE.FINISHED } },
  })
}

/**
 * A generated bed's composition, saved by the bed activity into the user's music folder:
 * recorded once, for the user who pushed it, and only for a file in that user's folder.
 */
async function applyMusicTrack(
  deps: ChunkSinkDeps,
  userId: string,
  chunk: PushedChunk,
): Promise<void> {
  const data = (chunk['content'] as undefined | { data?: Record<string, unknown> })?.data ?? {}
  const { cdnUrl, durationSec, fileUri, name, projectId, sizeBytes } = data
  if (
    !userId ||
    typeof fileUri !== 'string' ||
    !isOwnMusicTrackUri(userId, fileUri) ||
    typeof cdnUrl !== 'string' ||
    typeof durationSec !== 'number' ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    typeof sizeBytes !== 'number' ||
    typeof name !== 'string'
  ) {
    logger.warn(`[chunk-sink] Dropping an invalid music-track for ${userId}`)
    return
  }
  if (await deps.prisma.userMusicTrack.findFirst({ where: { fileUri } })) return
  const base =
    name
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MUSIC_TRACK_NAME_MAX_LENGTH - 4) || 'AI music'
  // The director reuses names: number a repeat, so a pick by name means one track.
  const taken = new Set(
    (
      await deps.prisma.userMusicTrack.findMany({
        select: { name: true },
        where: { name: { startsWith: base }, userId },
      })
    ).map((t) => t.name),
  )
  let unique = base
  let n = 1
  while (taken.has(unique)) {
    n += 1
    unique = `${base} ${n}`
  }
  await deps.prisma.userMusicTrack.create({
    data: {
      cdnUrl: toSavedAddress(cdnUrl),
      durationSec,
      fileUri,
      name: unique,
      ...(typeof projectId === 'string' ? { projectId } : {}),
      sizeBytes,
      source: 'generated',
      userId,
    },
  })
}
