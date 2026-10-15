import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  libraryTrackPath,
  pickLibraryVariant,
  readMusicLibrary,
} from '@reelmakeeasy/common/long-take/music-library'
import { downloadStoredFile, projectUri } from '@reelmakeeasy/common/storage/stored-files'

import type {
  FitLongTakeBgmTrackActivityParams,
  GenerateLongTakeBgmBedActivityResult,
} from '../../workflows/long-take/types'

import { matchDurationLoopTrimFade } from './bgm/bgm-audio'
import { measureBedToVoiceGainDb } from './bgm'
import { formatLogFields, logger, withActivityHeartbeat, withLongTakeContext } from './common'
import { createLongTakeStorage } from './storage'

/**
 * A chosen track as a project bed: a library track's variant that covers the video (or
 * the user's own file), trimmed to the voice-over with the same fade a generated bed
 * gets, written to project storage under a content-hashed name and measured against the
 * voice. Returns the generated bed's shape, so persist, versions and the remux are
 * unchanged. Throws when the track is unknown; the callers decide what that costs.
 */
export async function fitLongTakeBgmTrack(
  params: FitLongTakeBgmTrackActivityParams,
): Promise<GenerateLongTakeBgmBedActivityResult> {
  const { durationSec, projectId, track, userEmail, userId } = params
  return withLongTakeContext({ projectId, userEmail, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const workDir = await mkdtemp(path.join(os.tmpdir(), `long-take-bgm-track-${projectId}-`))
      try {
        const bedPath = path.join(workDir, 'bed.mp3')
        if (track.source === 'library') {
          const entry = readMusicLibrary().tracks.find((t) => t.id === track.id)
          if (!entry) throw new Error(`Library track not found: ${track.id}`)
          await copyFile(libraryTrackPath(pickLibraryVariant(entry, durationSec)), bedPath)
        } else {
          if (!track.uri) throw new Error(`Uploaded track ${track.id} has no uri`)
          await downloadStoredFile(track.uri, bedPath)
        }
        await matchDurationLoopTrimFade(bedPath, durationSec)
        const hash = createHash('sha256')
          .update(await readFile(bedPath))
          .digest('hex')
        const name = `bed-${hash.slice(0, 16)}.mp3`
        await storage.uploadFile(bedPath, `bgm/${name}`)
        const fileUri = projectUri(projectId, 'bgm', name)
        const bedToVoiceGainDb = await measureBedToVoiceGainDb(storage, bedPath, workDir)
        logger.info(
          `[long-take] BGM track fitted ${formatLogFields({
            fileUri,
            projectId,
            source: track.source,
            trackId: track.id,
          })}`,
        )
        return {
          ...(bedToVoiceGainDb === undefined ? {} : { bedToVoiceGainDb }),
          // The address: its served URL is built when it is sent to a browser.
          cdnUrl: fileUri,
          durationMs: Math.round(durationSec * 1000),
          fileUri,
          model: '',
          prompt: '',
          source: track.source,
          trackId: track.id,
          trackName: track.title,
        }
      } finally {
        await rm(workDir, { force: true, recursive: true })
      }
    }),
  )
}
