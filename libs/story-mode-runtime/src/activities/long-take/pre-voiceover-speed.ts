import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import type { TranscriptData } from '@shared/types/agent/transcript'

import type {
  ApplyLongTakePreVoiceoverSpeedActivityParams,
  GenerateLongTakeVoiceoverActivityResult,
} from '../../workflows/long-take/types'

import { generateLongTakeVoiceoverM4a } from './audio'
import {
  downloadAssetToLocal,
  formatLogFields,
  getVideoDurationSeconds,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage } from './storage'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

const execFileAsync = promisify(execFile)

const PREVOICEOVER_SPEED_BACKUP_DIR = 'story_loader/audio/.voice_preview_speed'

async function applyAtempoToMp3(
  inputMp3Path: string,
  outputMp3Path: string,
  speed: number,
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-i',
    inputMp3Path,
    '-filter:a',
    `atempo=${speed}`,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-y',
    outputMp3Path,
  ])
}

/**
 * Apply a UIP-selected pre-voiceover playback speed to the generated voiceover
 * and its transcript before the long-take pipeline consumes them. Idempotent
 * via a one-time backup of the original audio + transcript, so re-running with
 * a different speed always scales from the originals rather than compounding.
 */
export async function applyLongTakePreVoiceoverSpeed(
  params: ApplyLongTakePreVoiceoverSpeedActivityParams,
): Promise<GenerateLongTakeVoiceoverActivityResult> {
  const {
    audioDurationSeconds,
    projectId,
    scriptText,
    speed: rawSpeed,
    transcriptPath,
    userEmail,
    userId,
    voiceOverPath,
  } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const speed = normalizeVoicePreviewSpeed(rawSpeed)
      if (speed === 1) {
        return { audioDurationSeconds, scriptText, transcriptPath, voiceOverPath }
      }

      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `long-take-prevoice-speed-${projectId}-`),
      )
      const localInputPath = path.join(tempDir, 'voice_over_original.mp3')
      const localOutputPath = path.join(tempDir, 'voice_over_sped.mp3')

      try {
        await ensurePreVoiceoverSpeedOriginalAudio({
          localPath: localInputPath,
          storage,
          voiceOverPath,
        })
        await applyAtempoToMp3(localInputPath, localOutputPath, speed)
        await storage.uploadFile(localOutputPath, voiceOverPath)

        const transcript = await readPreVoiceoverSpeedOriginalTranscript(storage, transcriptPath)
        const scaledTranscript = scaleTranscriptTiming(transcript, speed)
        await storage.writeJsonFile(transcriptPath, scaledTranscript)
        await generateLongTakeVoiceoverM4a(projectId, { skipIfExists: false })

        const nextAudioDurationSeconds = await getVideoDurationSeconds(localOutputPath)
        logger.info(
          `[long-take] UIP pre-voiceover speed applied ${formatLogFields({
            projectId,
            userId,
            voiceOverPath,
            transcriptPath,
            speed,
            audioDurationSeconds: nextAudioDurationSeconds,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          audioDurationSeconds: nextAudioDurationSeconds,
          scriptText,
          transcriptPath,
          voiceOverPath,
        }
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true })
      }
    }),
  )
}

async function ensurePreVoiceoverSpeedOriginalAudio(params: {
  localPath: string
  storage: ReturnType<typeof createLongTakeStorage>
  voiceOverPath: string
}): Promise<void> {
  const { localPath, storage, voiceOverPath } = params
  const backupPath = `${PREVOICEOVER_SPEED_BACKUP_DIR}/original_voice_over.mp3`
  if (await storage.exists(backupPath)) {
    await storage.downloadFile(backupPath, localPath)
    return
  }

  const voiceOverUri = isStoreUri(voiceOverPath)
    ? voiceOverPath
    : storage.getFullPath(voiceOverPath)
  await downloadAssetToLocal(voiceOverUri, localPath)
  await storage.ensureDir(PREVOICEOVER_SPEED_BACKUP_DIR)
  await storage.uploadFile(localPath, backupPath)
}

function normalizeVoicePreviewSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Number(Math.min(2, Math.max(0.5, value)).toFixed(2))
}

async function readPreVoiceoverSpeedOriginalTranscript(
  storage: ReturnType<typeof createLongTakeStorage>,
  transcriptPath: string,
): Promise<TranscriptData> {
  const backupPath = `${PREVOICEOVER_SPEED_BACKUP_DIR}/original_transcript.json`
  if (await storage.exists(backupPath)) {
    return (await storage.readJsonFile(backupPath)) as TranscriptData
  }

  const transcript = (await storage.readJsonFile(transcriptPath)) as TranscriptData
  await storage.ensureDir(PREVOICEOVER_SPEED_BACKUP_DIR)
  await storage.writeJsonFile(backupPath, transcript)
  return transcript
}

function scaleTimestamp(value: number, scale: number): number {
  if (!Number.isFinite(value)) {
    return value
  }
  return Number(Math.max(0, value * scale).toFixed(3))
}

function scaleTranscriptTiming(transcript: TranscriptData, speed: number): TranscriptData {
  const scale = 1 / speed
  return {
    ...transcript,
    segments: (transcript.segments ?? []).map((segment) => ({
      ...segment,
      end: scaleTimestamp(segment.end, scale),
      start: scaleTimestamp(segment.start, scale),
      words: (segment.words ?? []).map((word) => ({
        ...word,
        end: scaleTimestamp(word.end, scale),
        start: scaleTimestamp(word.start, scale),
      })),
    })),
  }
}
