import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { downloadStoredFile } from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException } from '@nestjs/common'

const run = promisify(execFile)

/** What a user's track can be: a real audio file between 5 s and 10 minutes, at most 50 MB. */
export const MUSIC_UPLOAD_LIMITS = { maxBytes: 50 * 1024 * 1024, maxSec: 600, minSec: 5 }

export interface MusicUploadDeps {
  download: (fileUri: string, localPath: string) => Promise<void>
  probe: (localPath: string) => Promise<{ durationSec: number; hasAudio: boolean }>
  sizeOf: (localPath: string) => Promise<number>
  transcode: (input: string, output: string) => Promise<void>
}

async function probeAudio(localPath: string): Promise<{ durationSec: number; hasAudio: boolean }> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type:format=duration',
    '-of',
    'json',
    localPath,
  ])
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: { codec_type?: string }[]
  }
  return {
    durationSec: Number(parsed.format?.duration ?? 0) || 0,
    hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === 'audio'),
  }
}

/** A standard mp3 (128 kbps, 44.1 kHz stereo), video stream dropped. */
async function transcodeToMp3(input: string, output: string): Promise<void> {
  await run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    input,
    '-vn',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    output,
  ])
}

export const musicUploadDeps: MusicUploadDeps = {
  download: downloadStoredFile,
  probe: probeAudio,
  sizeOf: async (localPath) => (await stat(localPath)).size,
  transcode: transcodeToMp3,
}

/**
 * Fetches the temp upload, checks it is a usable track (a plain reason when not) and
 * transcodes it to the standard mp3 in `workDir`. The caller owns `workDir`.
 */
export async function prepareMusicUpload(
  input: { tempFileUri: string; workDir: string },
  deps: MusicUploadDeps = musicUploadDeps,
): Promise<{ durationSec: number; localMp3: string; sizeBytes: number }> {
  const source = path.join(input.workDir, 'source')
  await deps.download(input.tempFileUri, source)
  const sizeBytes = await deps.sizeOf(source)
  if (sizeBytes > MUSIC_UPLOAD_LIMITS.maxBytes) {
    throw new BadRequestException('Tracks can be up to 50 MB')
  }
  let probed: { durationSec: number; hasAudio: boolean }
  try {
    probed = await deps.probe(source)
  } catch {
    throw new BadRequestException('That file has no audio')
  }
  if (!probed.hasAudio) throw new BadRequestException('That file has no audio')
  if (probed.durationSec > MUSIC_UPLOAD_LIMITS.maxSec) {
    throw new BadRequestException('Tracks can be up to 10 minutes')
  }
  if (probed.durationSec < MUSIC_UPLOAD_LIMITS.minSec) {
    throw new BadRequestException('Tracks must be at least 5 seconds')
  }
  const localMp3 = path.join(input.workDir, 'track.mp3')
  await deps.transcode(source, localMp3)
  return { durationSec: probed.durationSec, localMp3, sizeBytes }
}
