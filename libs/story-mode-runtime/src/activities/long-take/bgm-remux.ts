import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { pushChunks } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import {
  type BeatLoopRenderSpec,
  readBeatLoopRenderSpec,
} from '@reelmakeeasy/common/long-take/beat-loop-delivery'
import {
  BEAT_LOOP_SOUND_SOURCES,
  masterBeatLoopSound,
} from '@reelmakeeasy/common/long-take/beat-loop-music'
import { BEAT_CLIP_SECONDS } from '@reelmakeeasy/common/long-take/beat-loop-timing'
import { remuxBgmVariant, resolveBgmDuckDbForVolume } from '@reelmakeeasy/common/long-take/bgm-remux'
import { assertDeliveredVideoPlayable } from '@reelmakeeasy/common/long-take/validate-delivered-video'
import {
  downloadStoredFile,
  downloadStoredFileWithVersion,
  storedFileVersion,
  workspaceUri,
  isVersionConflictError,
  uploadToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { getProjectDataService } from '@shared/db-access-layer'

import type {
  RemuxLongTakeBgmActivityParams,
  RemuxLongTakeBgmActivityResult,
} from '../../workflows/long-take/types'

import {
  formatLogFields,
  isActivityCancelled,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage } from './storage'

const FINAL_VIDEO_NAME = 'final_video.mp4'
const WATERMARK_VIDEO_NAME = 'watermark_video.mp4'

// Lost-update guard: the remux is a read-compose-write of the
// delivered object, so each publish carries ifVersionMatch of the exact
// version the video stream was composed from. A concurrent writer (a
// render finalize, or a second remux run -- TERMINATE_EXISTING does not
// serialize two runs already past their downloads) lands first -> our publish
// 412s -> recompose from the fresh bytes and try again. Attempts are bounded;
// exhaustion throws so the activity retry (and any superseding start)
// takes over.
const MAX_GUARDED_PUBLISH_ATTEMPTS = 3

/**
 * Write back the bed->voice delta the final mix just measured, which
 * is what the live preview's duck curve reads as `bgmBedGainDb`. A restore of
 * a version recorded before per-version measurement can only approximate that
 * scalar; this is how the project heals to the measured truth.
 *
 * Fenced to the bed it was measured against. Two remuxes past their downloads
 * are not serialized (the same reason the publish path carries
 * ifVersionMatch), so a superseded run could otherwise attach ITS bed's
 * gain to whatever bed a restore has since selected -- and where a losing
 * publish recomposes itself, a wrong-bed scalar just sits there mistuning the
 * preview until some later remux overwrites it. The re-read sits immediately
 * before the write, which narrows the window to the round trip rather than the
 * whole transfer-dominated remux; project-patch has no compare-and-set, so
 * this is a read-then-write, not an atomic guard.
 *
 * Scalar ONLY: a patch carrying bgmVersions reads as a finished regeneration
 * downstream and fires a music-ready notification.
 */
async function persistMeasuredBedGain(params: {
  bedToVoiceGainDb: number
  bgmBedUri: string
  projectId: string
  userEmail?: string
  userId?: string
}): Promise<void> {
  const { bedToVoiceGainDb, bgmBedUri, projectId, userEmail, userId } = params
  const current = await getProjectDataService().getProject(projectId)
  if (current?.bgmBedUri !== bgmBedUri) {
    return
  }
  const pushResult = await pushChunks({
    chunks: [
      {
        content: { data: { bgmBedGainDb: bedToVoiceGainDb } },
        role: 'event',
        type: 'project-patch',
      },
    ],
    projectId,
    userEmail: userEmail || '',
    userId: userId || '',
  })
  if (!pushResult.success) {
    throw new Error(String(pushResult.error ?? 'project-patch push reported failure'))
  }
}

/**
 * Settings re-mux: rebuild the delivered video (and its watermark
 * variant) at the persisted BGM settings. The video stream is copied from the
 * current final video; the audio is reconstructed from the canonical voiceover
 * artifact, plus the bed at the slider-derived duck when music is on. Both
 * variants are re-published IN PLACE (final/watermark names are served with
 * no-cache, matching finalizeRender), so resultVideo URLs never change and the
 * next download simply signs the fresh bytes.
 *
 * Wall-clock is transfer-dominated, so the legs run concurrently: every input
 * downloads up front in one round, and the final variant publishes while the
 * watermark variant is still remuxing (the pipelines share only the gain
 * measured on the clean video). A failed final leg can therefore land next to
 * an already-published watermark; the workflow's retry -- and any superseding
 * TERMINATE_EXISTING start -- rewrites both variants, healing partial state.
 *
 * The delivered video is required; the watermark variant is best-effort (some
 * projects never published one). Bed-required failures propagate so activity
 * retries surface real infra errors instead of silently shipping a stale mix.
 *
 * A loop short's sound is not its voiceover: it is the voice over its clips' own
 * sound, mastered to -14 LUFS. Its sound is mastered again from those files, with
 * the bed under them when music is on, and copied under the picture as it is
 * (beat-loop-music.ts); music off puts back the exact sound it was delivered with.
 */
export async function remuxLongTakeBgm(
  params: RemuxLongTakeBgmActivityParams,
): Promise<RemuxLongTakeBgmActivityResult> {
  const { bgmBedUri, bgmEnabled, bgmVolume, projectId, userEmail, userId } = params

  return withLongTakeContext({ projectId, userEmail, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const withBed = bgmEnabled && bgmVolume > 0 && Boolean(bgmBedUri)
      if (bgmEnabled && bgmVolume > 0 && !bgmBedUri) {
        throw new Error(`BGM remux requested but the project has no bed uri (${projectId})`)
      }

      const storage = createLongTakeStorage(projectId)
      const workDir = await mkdtemp(path.join(tmpdir(), `bgm-remux-${projectId}-`))
      try {
        const loop = await readBeatLoopRenderSpec(storage)
        const inputs = await prefetchRemuxInputs({
          bgmBedUri: withBed ? bgmBedUri : undefined,
          loop: Boolean(loop),
          projectId,
          storage,
          workDir,
        })
        const { videoVersion, videoPath, watermark } = inputs
        const loopSound = await masterLoopSoundIfLoop({ bgmVolume, inputs, loop, workDir })
        // What each variant's audio is rebuilt from: a loop's mastered sound, copied in as it
        // is; any other video's voiceover, with the bed mixed in when music is on.
        const { bedPath, copyAudio, voiceoverPath } = loopSound
          ? { bedPath: undefined, copyAudio: true, voiceoverPath: loopSound.audioPath }
          : { bedPath: inputs.bedPath, copyAudio: false, voiceoverPath: inputs.voiceoverPath }
        const mixBed = loopSound ? false : withBed

        const duckDb = resolveBgmDuckDbForVolume(bgmVolume)
        const finalVariant = await remuxBgmVariant({
          bedPath,
          copyAudio,
          duckDb,
          outputBaseName: 'final_video_remux',
          videoPath,
          voiceoverPath,
          withBed: mixBed,
          workDir,
        })
        // Publish the final variant while the watermark variant remuxes: the
        // pipelines share only the measured gain, not each other's uploads.
        const [, watermarkUpdated] = await Promise.all([
          publishFinalVariantGuarded({
            bedPath,
            copyAudio,
            duckDb,
            firstOutputPath: finalVariant.outputPath,
            projectId,
            storage,
            videoVersion,
            voiceoverPath,
            withBed: mixBed,
            workDir,
          }),
          processWatermarkVariant({
            bedPath,
            copyAudio,
            duckDb,
            gainDb: finalVariant.gainDb,
            projectId,
            storage,
            voiceoverPath,
            watermark,
            withBed: mixBed,
            workDir,
          }),
        ])

        // The mix just measured this exact bed against this exact
        // voiceover, which is the value the live preview's duck curve needs
        // (bgmBedGainDb). Persist it back so a restore of a version recorded
        // before per-version measurement -- whose apply could only approximate
        // the scalar -- self-heals to the measured truth.
        // Best-effort: a delivered rebuild must never fail on it.
        const bedToVoiceGainDb = loopSound
          ? loopSound.bedToVoiceGainDb
          : finalVariant.bedToVoiceGainDb
        if (withBed && bgmBedUri && bedToVoiceGainDb !== undefined) {
          try {
            await persistMeasuredBedGain({
              bedToVoiceGainDb,
              bgmBedUri,
              projectId,
              userEmail,
              userId,
            })
          } catch (persistError) {
            logger.warn(
              `[long-take] BGM remux gain persist failed (non-fatal) ${formatLogFields({
                error: persistError instanceof Error ? persistError.message : String(persistError),
                projectId,
              })}`,
            )
          }
        }

        logger.info(
          `[long-take] BGM remux published ${formatLogFields({
            projectId,
            bgmEnabled,
            bgmVolume,
            duckDb,
            bedToVoiceGainDb,
            elapsedMs: Date.now() - startedAt,
            gainDb: finalVariant.gainDb,
            loop: Boolean(loopSound),
            watermarkUpdated,
            withBed,
          })}`,
        )
        return {
          applied: withBed ? 'mixed' : 'voiceover_only',
          gainDb: finalVariant.gainDb,
          watermarkUpdated,
        }
      } finally {
        await rm(workDir, { force: true, recursive: true }).catch(() => undefined)
      }
    }),
  )
}

/**
 * The canonical voiceover the video was rendered against: voice_over.m4a
 * (what the live editor streams as audioPreviewUrl), falling back to the
 * legacy voice_over.mp3. Missing both means the audio cannot be rebuilt.
 */
export async function downloadVoiceover(
  storage: ReturnType<typeof createLongTakeStorage>,
  workDir: string,
): Promise<string> {
  const m4aPath = STORY_LOADER_PATHS.audioVoiceoverPath.replace(/\.mp3$/i, '.m4a')
  for (const candidate of [m4aPath, STORY_LOADER_PATHS.audioVoiceoverPath]) {
    if (await storage.exists(candidate)) {
      const localPath = path.join(workDir, `voiceover${path.extname(candidate)}`)
      await storage.downloadFile(candidate, localPath)
      return localPath
    }
  }
  throw new Error('No canonical voiceover artifact found; cannot rebuild the delivery audio')
}

/** Bed download, skipped (undefined) on the voiceover-only path. */
async function downloadBed(
  bgmBedUri: string | undefined,
  workDir: string,
): Promise<string | undefined> {
  if (!bgmBedUri) {
    return undefined
  }
  const bedPath = path.join(workDir, 'bgm_bed.mp3')
  await downloadStoredFile(bgmBedUri, bedPath)
  return bedPath
}

/** A downloaded current-variant snapshot: local bytes + the version read. */
interface VariantSnapshot {
  version: string
  localPath: string
}

/**
 * Watermark download, undefined when the project never published one (or the
 * fetch fails) -- the variant is best-effort and must not fail the delivered
 * video's rebuild.
 */
async function downloadWatermarkBestEffort(
  projectId: string,
  workDir: string,
  attempt = 0,
): Promise<undefined | VariantSnapshot> {
  const watermarkPath = path.join(workDir, `current_watermark_video_${attempt}.mp4`)
  try {
    const version = await downloadStoredFileWithVersion(
      workspaceUri(projectId, WATERMARK_VIDEO_NAME),
      watermarkPath,
    )
    return { version, localPath: watermarkPath }
  } catch (watermarkError) {
    logger.warn(
      `[long-take] BGM remux skipped the watermark variant ${formatLogFields({
        projectId,
        err: watermarkError instanceof Error ? watermarkError.message : String(watermarkError),
      })}`,
    )
    return undefined
  }
}

/** Re-fetch the delivered video for a guarded retry (attempt-scoped filename). */
async function downloadFinalVideoSnapshot(
  projectId: string,
  workDir: string,
  attempt: number,
): Promise<VariantSnapshot> {
  const localPath = path.join(workDir, `current_final_video_${attempt}.mp4`)
  const version = await downloadStoredFileWithVersion(
    workspaceUri(projectId, FINAL_VIDEO_NAME),
    localPath,
  )
  return { version, localPath }
}

/**
 * Download every remux input in one concurrent round: transfers dominate this
 * activity's wall-clock, so the voiceover, delivered video, bed and watermark
 * fetch together instead of one after another. The watermark is best-effort;
 * the rest are required and propagate their failures (the activity retries). The
 * two current-variant downloads record the version they were read at so
 * the republish can be guarded against concurrent writers.
 */
async function prefetchRemuxInputs(params: {
  bgmBedUri?: string
  /** A loop short: its sound's sources instead of the voiceover (BEAT_LOOP_SOUND_SOURCES). */
  loop: boolean
  projectId: string
  storage: ReturnType<typeof createLongTakeStorage>
  workDir: string
}): Promise<RemuxInputs> {
  const { bgmBedUri, loop, projectId, storage, workDir } = params
  const [sound, video, bedPath, watermark] = await Promise.all([
    loop ? downloadLoopSoundSources(storage, workDir) : downloadVoiceover(storage, workDir),
    downloadFinalVideoSnapshot(projectId, workDir, 0),
    downloadBed(bgmBedUri, workDir),
    downloadWatermarkBestEffort(projectId, workDir),
  ])
  return {
    bedPath,
    ...(typeof sound === 'string' ? {} : { loopSources: sound }),
    videoVersion: video.version,
    videoPath: video.localPath,
    voiceoverPath: typeof sound === 'string' ? sound : '',
    watermark,
  }
}

/** The remux's downloaded inputs. */
interface RemuxInputs {
  bedPath?: string
  /** A loop short's sound sources, local. */
  loopSources?: { clipsPath: string; voicePath: string }
  videoVersion: string
  videoPath: string
  /** The voiceover; empty for a loop, whose sound is mastered from `loopSources`. */
  voiceoverPath: string
  watermark?: VariantSnapshot
}

/**
 * A loop's voice-over and joined clips, the files its finish pass mixed. Without them its sound
 * cannot be rebuilt, and rebuilding it from the voiceover alone would drop the clips' sound.
 */
async function downloadLoopSoundSources(
  storage: ReturnType<typeof createLongTakeStorage>,
  workDir: string,
): Promise<{ clipsPath: string; voicePath: string }> {
  const download = async (relativePath: string, name: string) => {
    if (!(await storage.exists(relativePath))) {
      throw new Error(
        `The loop's ${relativePath} is missing, so its sound can't be rebuilt with the music: render the loop again, then change the music.`,
      )
    }
    const localPath = path.join(workDir, `${name}${path.extname(relativePath)}`)
    await storage.downloadFile(relativePath, localPath)
    return localPath
  }
  const [clipsPath, voicePath] = await Promise.all([
    download(BEAT_LOOP_SOUND_SOURCES.clips, 'loop_clips'),
    download(BEAT_LOOP_SOUND_SOURCES.voice, 'loop_voice'),
  ])
  return { clipsPath, voicePath }
}

/** A loop's sound at the music settings (see remuxLongTakeBgm); undefined for other videos. */
async function masterLoopSoundIfLoop(params: {
  bgmVolume: number
  inputs: RemuxInputs
  loop?: BeatLoopRenderSpec
  workDir: string
}): Promise<undefined | { audioPath: string; bedToVoiceGainDb?: number }> {
  const { bgmVolume, inputs, loop, workDir } = params
  if (!loop || !inputs.loopSources) return undefined
  return masterBeatLoopSound({
    ...(inputs.bedPath ? { bedPath: inputs.bedPath } : {}),
    bgmVolume,
    clipsPath: inputs.loopSources.clipsPath,
    durationS: loop.clipCount * BEAT_CLIP_SECONDS,
    outputPath: path.join(workDir, 'loop_sound.m4a'),
    voicePath: inputs.loopSources.voicePath,
  })
}

/**
 * Publish the delivered variant under the version guard, recomposing from
 * fresh bytes on each 412 (see MAX_GUARDED_PUBLISH_ATTEMPTS). The first
 * attempt reuses the remux already produced from the prefetched video so the
 * happy path costs nothing extra.
 */
async function publishFinalVariantGuarded(params: {
  bedPath?: string
  copyAudio: boolean
  duckDb: number
  firstOutputPath: string
  projectId: string
  storage: ReturnType<typeof createLongTakeStorage>
  videoVersion: string
  voiceoverPath: string
  withBed: boolean
  workDir: string
}): Promise<void> {
  const {
    bedPath,
    copyAudio,
    duckDb,
    firstOutputPath,
    projectId,
    storage,
    voiceoverPath,
    withBed,
    workDir,
  } = params
  let outputPath = firstOutputPath
  let version = params.videoVersion
  for (let attempt = 1; attempt <= MAX_GUARDED_PUBLISH_ATTEMPTS; attempt += 1) {
    // Superseded-run fence: a TERMINATE_EXISTING start of the shared workflow
    // id orphans this activity but does not stop it. Once cancellation is
    // observed (via the heartbeat channel), stop publishing -- a retry here
    // would recompose the newer run's bytes with THIS run's stale settings
    // and CAS-win over the newer intent.
    if (isActivityCancelled()) {
      throw new Error(`BGM remux superseded mid-publish; yielding to the newer run (${projectId})`)
    }
    try {
      await publishVariant(projectId, storage, outputPath, FINAL_VIDEO_NAME, version)
      return
    } catch (publishError) {
      if (!isVersionConflictError(publishError) || attempt === MAX_GUARDED_PUBLISH_ATTEMPTS) {
        throw publishError
      }
      // A 412 usually means the superseding run already published: re-check
      // the fence BEFORE burning a re-download on a run that must yield.
      if (isActivityCancelled()) {
        throw new Error(
          `BGM remux superseded mid-publish; yielding to the newer run (${projectId})`,
        )
      }
      logger.warn(
        `[long-take] BGM remux lost the publish race, recomposing from fresh bytes ${formatLogFields(
          { attempt, version, projectId },
        )}`,
      )
      const fresh = await downloadFinalVideoSnapshot(projectId, workDir, attempt)
      version = fresh.version
      outputPath = (
        await remuxBgmVariant({
          bedPath,
          copyAudio,
          duckDb,
          outputBaseName: `final_video_remux_${attempt}`,
          videoPath: fresh.localPath,
          voiceoverPath,
          withBed,
          workDir,
        })
      ).outputPath
    }
  }
}

/**
 * Remux + publish the watermark variant, reusing the gain measured on the
 * clean video (same voiceover) like the export bake does. Best-effort: any
 * failure logs and reports false rather than failing the delivered rebuild.
 * Publishes under the same version guard as the delivered variant,
 * recomposing from fresh bytes on a lost race.
 */
async function processWatermarkVariant(params: {
  bedPath?: string
  copyAudio: boolean
  duckDb: number
  gainDb?: number
  projectId: string
  storage: ReturnType<typeof createLongTakeStorage>
  voiceoverPath: string
  watermark?: VariantSnapshot
  withBed: boolean
  workDir: string
}): Promise<boolean> {
  const {
    bedPath,
    copyAudio,
    duckDb,
    gainDb,
    projectId,
    storage,
    voiceoverPath,
    withBed,
    workDir,
  } = params
  let snapshot = params.watermark
  if (!snapshot) {
    return false
  }
  try {
    for (let attempt = 1; attempt <= MAX_GUARDED_PUBLISH_ATTEMPTS; attempt += 1) {
      // Same superseded-run fence as the delivered variant: an orphaned run
      // must not recompose with stale settings after losing the race.
      if (isActivityCancelled()) {
        logger.warn(
          `[long-take] BGM remux superseded; skipping the watermark variant ${formatLogFields({
            projectId,
          })}`,
        )
        return false
      }
      const watermarkVariant = await remuxBgmVariant({
        bedPath,
        copyAudio,
        duckDb,
        gainDb,
        outputBaseName: `watermark_video_remux_${attempt}`,
        videoPath: snapshot.localPath,
        voiceoverPath,
        withBed,
        workDir,
      })
      try {
        await publishVariant(
          projectId,
          storage,
          watermarkVariant.outputPath,
          WATERMARK_VIDEO_NAME,
          snapshot.version,
        )
        return true
      } catch (publishError) {
        if (!isVersionConflictError(publishError) || attempt === MAX_GUARDED_PUBLISH_ATTEMPTS) {
          throw publishError
        }
        logger.warn(
          `[long-take] BGM remux lost the watermark publish race, recomposing ${formatLogFields({
            attempt,
            projectId,
          })}`,
        )
        snapshot = await downloadWatermarkBestEffort(projectId, workDir, attempt)
        if (!snapshot) {
          return false
        }
      }
    }
    return false
  } catch (watermarkError) {
    logger.warn(
      `[long-take] BGM remux skipped the watermark variant ${formatLogFields({
        projectId,
        err: watermarkError instanceof Error ? watermarkError.message : String(watermarkError),
      })}`,
    )
    return false
  }
}

/**
 * Publish a variant to both destinations finalizeRender writes: the v1
 * workspace uri (the CDN-served resultVideo object) and the v2 project
 * storage copy, with the same no-cache + attachment metadata. The CDN-served
 * object is written FIRST, guarded with ifVersionMatch of the version
 * this remux composed from -- a concurrent writer makes it 412 so
 * a stale composition can never overwrite fresher bytes. The mirror is only
 * written after the guarded primary wins, so a lost race touches nothing.
 */
async function publishVariant(
  projectId: string,
  storage: ReturnType<typeof createLongTakeStorage>,
  localPath: string,
  objectName: string,
  ifVersionMatch: string,
): Promise<void> {
  // This overwrites the already-delivered object in place, so it must
  // never replace a good final_video.mp4 (or watermark) with a corrupt remux
  // output. A throw propagates for the required final variant (the workflow
  // retries and heals) and is caught for the best-effort watermark variant.
  await assertDeliveredVideoPlayable(localPath, logger, projectId, { requireAudioStream: true })
  await uploadToStore(localPath, workspaceUri(projectId, objectName), { ifVersionMatch })
  // The mirror gets its own guard: its version is read right after the
  // primary win (0 = create-only when it does not exist yet), so any mirror
  // write landing between the read and this upload 412s us instead of being
  // clobbered. A 412 means a newer writer already owns the mirror -- yield
  // rather than leave the two delivery copies pointing at different winners
  // (v2 consumers like the final-video thumbnail read this copy).
  const mirrorVersion = await storedFileVersion(storage.getFullPath(objectName))
  try {
    await storage.uploadFile(localPath, objectName, { ifVersionMatch: mirrorVersion ?? 0 })
  } catch (mirrorError) {
    if (!isVersionConflictError(mirrorError)) {
      throw mirrorError
    }
    logger.warn(
      `[long-take] BGM remux yielded the v2 mirror to a newer writer ${formatLogFields({
        objectName,
        projectId,
      })}`,
    )
  }
}
