import type { CaptionKind } from '@reelmakeeasy/common/adapters/caption/caption-look'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import {
  BEAT_LOOP_CONCAT_PATH,
  BEAT_LOOP_STORYBOARD_PATH,
  parseBeatLoopRenderSpec,
} from '@reelmakeeasy/common/long-take/beat-loop-delivery'
import {
  BEAT_LOOP_SFX_BED_PATH,
  readBeatLoopSfxBed,
  rebuildBeatLoopSfxBed,
} from '@reelmakeeasy/common/long-take/beat-loop-sfx-bed'
import { BEAT_CLIP_SECONDS } from '@reelmakeeasy/common/long-take/beat-loop-timing'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import type { LongTakeStatus } from '@shared/types/api/long-take'

/**
 * A loop's clip sound bed in its status (beat-loop-sfx-bed.ts): what the chat plays beside the
 * engine to hear the clips' sound effects under the voice-over.
 *
 * Every loop render writes the bed. A loop finished before beds existed, or whose bed no longer
 * matches its clips, has none: the status reads null and the chat plays the delivered file. Such
 * a bed is built in the background when the status of a finished loop is read (no render
 * running), never in the request: the build downloads the clips and runs FFmpeg for a few
 * seconds. Until it is done the status says so (`loopSfxBedPending`), so the chat can keep
 * reading the status past delivery and switch to the live preview once the bed is there; it
 * stops saying so when the build fails, or when there is nothing to build from. Not left to the
 * next render: a loop nobody renders again would never play live in the chat.
 */

type LoopSfxBedStatus = Required<
  Pick<LongTakeStatus, 'loopClipsUrl' | 'loopSfxBedPending' | 'loopSfxBedUrl' | 'loopSfxBedVolume'>
>

type StatusStorage = Awaited<ReturnType<typeof createStorage>>

interface WarnLogger {
  warn: (message: string) => void
}

const NO_BED: LoopSfxBedStatus = {
  loopClipsUrl: null,
  loopSfxBedPending: false,
  loopSfxBedUrl: null,
  loopSfxBedVolume: null,
}

// The status is polled every few seconds: a build that failed is tried again only after this.
const REBUILD_RETRY_MS = 10 * 60_000

/**
 * Background bed builds, one at a time in the order asked (each runs FFmpeg), and at most one
 * queued per project. A project whose build failed is not tried again for `retryMs`.
 */
export function createLoopSfxBedRebuilds(options: {
  build: (projectId: string) => Promise<unknown>
  now?: () => number
  retryMs?: number
}) {
  const { build, now = Date.now, retryMs = REBUILD_RETRY_MS } = options
  const queued = new Set<string>()
  const failedAt = new Map<string, number>()
  let queue: Promise<void> = Promise.resolve()
  return {
    /** Resolves once every build asked for so far is done. */
    idle: (): Promise<void> => queue,
    /** Whether the project has a build queued or running. */
    pending: (projectId: string): boolean => queued.has(projectId),
    /** Queues a build for the project; false when one is queued or failed lately. */
    schedule(projectId: string, logger: WarnLogger): boolean {
      const failed = failedAt.get(projectId)
      if (queued.has(projectId) || (failed !== undefined && now() - failed < retryMs)) {
        return false
      }
      queued.add(projectId)
      failedAt.delete(projectId)
      queue = queue.then(async () => {
        try {
          await build(projectId)
        } catch (error) {
          failedAt.set(projectId, now())
          logger.warn(
            `[long-take] Could not build the loop's clip sound bed ${JSON.stringify({
              error: error instanceof Error ? error.message.split('\n')[0] : String(error),
              projectId,
            })}`,
          )
        } finally {
          queued.delete(projectId)
        }
      })
      return true
    },
  }
}

/** The app's background bed builds: from the project's stored clips and voice-over. */
export const loopSfxBedRebuilds = createLoopSfxBedRebuilds({
  build: async (projectId) => {
    const storage = await createStorage(projectId)
    const spec = parseBeatLoopRenderSpec(
      await storage.readJsonFile<unknown>(BEAT_LOOP_STORYBOARD_PATH),
    )
    return rebuildBeatLoopSfxBed(storage, {
      clipsPath: BEAT_LOOP_CONCAT_PATH,
      durationS: spec.clipCount * BEAT_CLIP_SECONDS,
    })
  },
})

/**
 * The bed's URL (built on read, keyed to the file's version so a player loads a new bed after a
 * render) and volume, with the joined clips it was made from (keyed to theirs), for a loop whose
 * bed matches its clips; null otherwise, pending while one is built in the background.
 * `settled`: the loop has a delivered file and no render running, so a missing or stale bed may
 * be built.
 */
export async function readLoopSfxBedStatus(
  storage: null | Pick<
    StatusStorage,
    'exists' | 'getFullPath' | 'getObjectMetadata' | 'readJsonFile'
  >,
  current: { kind: CaptionKind; projectId: string; settled: boolean },
  logger: WarnLogger,
): Promise<LoopSfxBedStatus> {
  if (current.kind !== 'loop' || !storage) return NO_BED
  // A build already under way when this read starts: if it ends while the bed is read, the read
  // may still see no bed, and must neither queue another build nor say none is coming.
  const building = loopSfxBedRebuilds.pending(current.projectId)
  try {
    const bed = await readBeatLoopSfxBed(storage, { clipsPath: BEAT_LOOP_CONCAT_PATH })
    if (bed.state === 'current') {
      return {
        loopClipsUrl: versionedUrl(storage, BEAT_LOOP_CONCAT_PATH, bed.clipsVersion),
        loopSfxBedPending: false,
        loopSfxBedUrl: versionedUrl(storage, BEAT_LOOP_SFX_BED_PATH, bed.version),
        loopSfxBedVolume: bed.record.volume,
      }
    }
    // While a render runs nothing is built or awaited here: the render writes the bed itself.
    if (!current.settled) return NO_BED
    // The next read sees what that build made, or that it failed.
    if (building) return { ...NO_BED, loopSfxBedPending: true }
    if (await storage.exists(BEAT_LOOP_CONCAT_PATH)) {
      loopSfxBedRebuilds.schedule(current.projectId, logger)
    }
  } catch (error) {
    logger.warn(
      `[long-take] Could not read the loop's clip sound bed ${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        projectId: current.projectId,
      })}`,
    )
  }
  // Queued by this read or an earlier one; false once built (read above) or given up on, and
  // while a render runs.
  return {
    ...NO_BED,
    loopSfxBedPending: current.settled && loopSfxBedRebuilds.pending(current.projectId),
  }
}

// A stored file's URL for a player, keyed to its version (when the storage reports one), so a
// player loads it again once a render rewrites it.
function versionedUrl(
  storage: Pick<StatusStorage, 'getFullPath'>,
  file: string,
  version: string | undefined,
): string {
  const url = storeUriToUrl(storage.getFullPath(file))
  return version ? `${url}?v=${version}` : url
}
