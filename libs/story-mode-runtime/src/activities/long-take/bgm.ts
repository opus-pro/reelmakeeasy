import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { pushChunks } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import { measureIntegratedLufs } from '@reelmakeeasy/common/long-take/bgm-mix'
import { musicTrackUri } from '@reelmakeeasy/common/long-take/music-tracks'
import { projectUri, uploadToStore } from '@reelmakeeasy/common/storage/stored-files'

import type {
  GenerateLongTakeBgmBedActivityParams,
  GenerateLongTakeBgmBedActivityResult,
  PersistLongTakeBgmBedActivityParams,
} from '../../workflows/long-take/types'

import { readBgmReportFields } from './bgm/bgm-report-fields'
import { generateBed } from './bgm/generate-bed'
import {
  formatLogFields,
  getVideoDurationSeconds,
  isActivityCancelled,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage } from './storage'

/** The voice-over the bed is measured against, whichever the pipeline wrote. */
const VOICE_OVER_PATHS = ['story_loader/audio/voice_over.m4a', 'story_loader/audio/voice_over.mp3']

/**
 * Story Mode BGM generation: the video's report fields and the user's wish go to the
 * director, the music model makes a ~30 s clip, it is sized to the voice-over, written to
 * project storage under a content-hashed name (a regenerated bed never overwrites the old
 * one, which the version history keeps) and measured against the voice. Throws on
 * failure; the workflow callers keep a bed non-fatal.
 */
export async function generateLongTakeBgmBed(
  params: GenerateLongTakeBgmBedActivityParams,
): Promise<GenerateLongTakeBgmBedActivityResult | null> {
  const {
    cameraStyle,
    durationSec,
    hasVoiceover,
    numShots,
    numTransitions,
    projectId,
    promptOverride,
    styleName,
    styleText,
    userEmail,
    userId,
    userRequest,
  } = params

  return withLongTakeContext({ projectId, userEmail, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const fields = await readBgmReportFields(storage, {
        ...(cameraStyle ? { cameraStyle } : {}),
        durationSec,
        hasVoiceover,
        numShots,
        numTransitions,
        styleName,
        styleText,
        userRequest,
      })
      const workDir = await mkdtemp(path.join(os.tmpdir(), `long-take-bgm-${projectId}-`))
      try {
        const bed = await generateBed(fields, durationSec, workDir, promptOverride)
        const hash = createHash('sha256')
          .update(await readFile(bed.localPath))
          .digest('hex')
        const name = `bed-${hash.slice(0, 16)}.mp3`
        await storage.uploadFile(bed.localPath, `bgm/${name}`)
        const fileUri = projectUri(projectId, 'bgm', name)
        const bedToVoiceGainDb = await measureBedToVoiceGainDb(storage, bed.localPath, workDir)
        await saveToUserMusic({
          name: bed.trackName,
          projectId,
          rawPath: bed.rawPath,
          userEmail,
          userId,
        })
        logger.info(
          `[long-take] BGM bed generated ${formatLogFields({
            fileUri,
            model: bed.model,
            projectId,
            trackName: bed.trackName,
          })}`,
        )
        return {
          ...(bedToVoiceGainDb === undefined ? {} : { bedToVoiceGainDb }),
          // The address: its served URL is built when it is sent to a browser.
          cdnUrl: fileUri,
          durationMs: bed.durationMs,
          fileUri,
          model: bed.model,
          prompt: bed.prompt,
          source: 'generated',
          trackName: bed.trackName,
        }
      } finally {
        await rm(workDir, { force: true, recursive: true })
      }
    }),
  )
}

/**
 * Adds a generated bed's whole composition to the user's music (marked AI generated), so
 * they can reuse it on other videos. Best effort: the bed stands whatever happens here.
 */
async function saveToUserMusic(input: {
  name: string
  projectId: string
  rawPath: string
  userEmail?: string
  userId: string
}): Promise<void> {
  const { name, projectId, rawPath, userEmail, userId } = input
  // An attempt the engine gave up on (Stop, a timeout) finishes in the background: its
  // music was never used, so it does not belong in the user's list.
  if (isActivityCancelled()) return
  try {
    const durationSec = await getVideoDurationSeconds(rawPath)
    const { size: sizeBytes } = await stat(rawPath)
    const fileUri = musicTrackUri(userId, randomUUID())
    await uploadToStore(rawPath, fileUri)
    if (isActivityCancelled()) return
    const pushResult = await pushChunks({
      chunks: [
        {
          content: {
            data: {
              // The address: its served URL is built when it is sent to a browser.
              cdnUrl: fileUri,
              durationSec,
              fileUri,
              name,
              projectId,
              sizeBytes,
              source: 'generated',
            },
          },
          role: 'event',
          type: 'music-track',
        },
      ],
      projectId,
      userEmail: userEmail || '',
      userId,
    })
    if (!pushResult.success) throw new Error(String(pushResult.error ?? 'push failed'))
  } catch (error) {
    logger.warn(
      `[long-take] generated music not added to the user's music ${formatLogFields({
        error: error instanceof Error ? error.message : String(error),
        projectId,
      })}`,
    )
  }
}

/**
 * Voice LUFS minus bed LUFS: the live preview and the export mix set the bed's level from
 * it. Best effort: absent when the voice-over is missing or unmeasurable.
 */
export async function measureBedToVoiceGainDb(
  storage: Pick<ProjectStore, 'downloadFile' | 'exists'>,
  bedPath: string,
  workDir: string,
): Promise<number | undefined> {
  try {
    let voiceStoragePath: string | undefined
    for (const candidate of VOICE_OVER_PATHS) {
      if (await storage.exists(candidate)) {
        voiceStoragePath = candidate
        break
      }
    }
    if (!voiceStoragePath) return undefined
    const voicePath = path.join(workDir, path.basename(voiceStoragePath))
    await storage.downloadFile(voiceStoragePath, voicePath)
    return (await measureIntegratedLufs(voicePath)) - (await measureIntegratedLufs(bedPath))
  } catch (error) {
    logger.warn(
      `[long-take] BGM gain measurement skipped ${formatLogFields({
        error: error instanceof Error ? error.message : String(error),
      })}`,
    )
    return undefined
  }
}

/**
 * Persist a generated bed's metadata onto the project via a partial
 * project-patch chunk (agents-callback -> internalUpdateProject, which accepts
 * the bgm fields). Writes ONLY the contract fields here
 * plus, on the regenerate path, the caller-assembled bgmVersions
 * history; bgmDuckDb / bgmVolume are owned by other slices. Throws on push
 * failure so the activity retries -- the workflow caller keeps BGM non-fatal.
 */
export async function persistLongTakeBgmBed(
  params: PersistLongTakeBgmBedActivityParams,
): Promise<void> {
  const { bed, bgmRun, bgmVersions, projectId, userEmail, userId } = params
  return withLongTakeContext({ projectId, userEmail, userId }, () =>
    withActivityHeartbeat(async () => {
      const pushResult = await pushChunks({
        chunks: [
          {
            content: {
              data: {
                bgmBedCdnUrl: bed.cdnUrl,
                ...(bed.bedToVoiceGainDb === undefined
                  ? {}
                  : { bgmBedGainDb: bed.bedToVoiceGainDb }),
                bgmBedUri: bed.fileUri,
                bgmModel: bed.model,
                bgmPrompt: bed.prompt,
                // A bed from before the library carries no source: it was generated.
                bgmSource: bed.source ?? 'generated',
                bgmTrackId: bed.trackId ?? null,
                bgmTrackName: bed.trackName,
                ...(bgmRun ? { bgmRun } : {}),
                ...(bgmVersions ? { bgmVersions } : {}),
              },
            },
            role: 'event',
            type: 'project-patch',
          },
        ],
        projectId,
        userEmail: userEmail || '',
        userId,
      })
      if (!pushResult.success) {
        throw new Error(`Failed to persist BGM project-patch: ${pushResult.error}`)
      }
      logger.info(`[long-take] BGM bed metadata persisted ${formatLogFields({ projectId })}`)
    }),
  )
}

/**
 * Clear the status-pill run record when a regenerate fails or is
 * skipped by the gate, so the card stops showing a spinner for a run that will
 * never settle. Null routes through internalUpdateProject's DbNull mapping.
 * Throws on push failure so the activity retries; the workflow caller swallows the
 * final failure -- the card's staleness ceiling is the backstop.
 */
export async function clearLongTakeBgmRun(params: {
  projectId: string
  userEmail?: string
  userId: string
}): Promise<void> {
  const { projectId, userEmail, userId } = params
  return withLongTakeContext({ projectId, userEmail, userId }, () =>
    withActivityHeartbeat(async () => {
      const pushResult = await pushChunks({
        chunks: [
          {
            content: { data: { bgmRun: null } },
            role: 'event',
            type: 'project-patch',
          },
        ],
        projectId,
        userEmail: userEmail || '',
        userId,
      })
      if (!pushResult.success) {
        throw new Error(`Failed to clear the BGM run record: ${pushResult.error}`)
      }
      logger.info(`[long-take] BGM run record cleared ${formatLogFields({ projectId })}`)
    }),
  )
}
