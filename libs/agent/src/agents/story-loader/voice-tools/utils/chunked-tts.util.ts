import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { SpeechToTextChunkResponseModel } from '@reelmakeeasy/common/elevenlabs/client'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { logger } from '@reelmakeeasy/common/logger'
import { runCommand, runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'
import { detectSilences } from '@reelmakeeasy/common/utils/silence'
import pLimit from 'p-limit'

import { generateTranscriptionStep } from './elevenlabs-audio-pipeline.util'
import type { TtsProvider } from './provider-tts.util'

const MAX_TTS_CHUNK_WORDS = 360
export const MIN_LONG_TTS_WORDS = 420
const TTS_CHUNK_STITCH_BITRATE = '128k'
const TTS_CHUNK_STITCH_SAMPLE_RATE = '44100'
const TTS_CHUNK_BOUNDARY_TARGET_GAP_SECONDS = 0.18
const TTS_CHUNK_BOUNDARY_MIN_INSERT_SECONDS = 0.03
const TTS_CHUNK_BOUNDARY_SILENCE_THRESHOLD_DB = -50
const TTS_CHUNK_BOUNDARY_SILENCE_DETECT_MIN_SECONDS = 0.03
const TTS_CHUNK_BOUNDARY_EDGE_TOLERANCE_SECONDS = 0.02
const TTS_CHUNK_LOUDNESS_TARGET_LUFS = -16
const TTS_CHUNK_MAX_GAIN_DB = 6
const TTS_CHUNK_GAIN_EPSILON_DB = 0.25
const TTS_FINAL_LIMITER_FILTER = 'alimiter=limit=0.891'

// Cap concurrent TTS chunk generations. Each ElevenLabs/MiniMax
// call streams a multi-MB mp3 buffer and runs an ASR validation pass;
// running all chunks for a 10-min video (5+) in parallel together with
// downstream chunked transcript correction ran the process out of memory.
const TTS_CHUNK_CONCURRENCY = 5

type BoundarySilenceInfo = {
  leadingSeconds: number
  trailingSeconds: number
}

type ChunkGenerationResult = {
  attempt: number
  isValid: boolean
  llmTtsQualityCheckEnabled: boolean
  llmTtsQualityCheckVariant: 'legacy_strict' | 'relaxed_asr_drift'
  provider: TtsProvider
  qualityIssues: string[]
  tagLeakageDetected: boolean
  transcription: null | SpeechToTextChunkResponseModel
  ttsModel: string
  usedUntaggedFallback: boolean
}

type ChunkLoudnessReport = {
  afterLufs?: number
  beforeLufs?: number
  error?: string
  gainDb?: number
  gainLimited?: boolean
  index: number
}

type GenerateChunkedAudioAndTranscriptParams = {
  generateChunk: (text: string, outputPath: string) => Promise<ChunkGenerationResult>
  // BCP-47 script language tag, logged as the expected language per chunk so
  // it can be compared against the ASR-detected language of the generated audio.
  languageCode?: string
  llmTtsQualityCheckMetadata: Pick<
    ChunkGenerationResult,
    'llmTtsQualityCheckEnabled' | 'llmTtsQualityCheckVariant'
  >
  outputPath?: string
  projectId: string
  provider: TtsProvider
  routing?: {
    originalProvider?: TtsProvider
    originalVoiceId?: string
    reason?: string
  }
  text: string
  ttsModel: string
  voiceId: string
}

type StitchAudioChunksResult = {
  finalLimiterApplied: boolean
  finalPath: string
  loudnessReports: ChunkLoudnessReport[]
}

type TtsTextChunk = {
  index: number
  text: string
  wordCount: number
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export async function generateChunkedAudioAndTranscriptWithRetries({
  generateChunk,
  languageCode,
  llmTtsQualityCheckMetadata,
  outputPath,
  projectId,
  provider,
  routing,
  text,
  ttsModel,
  voiceId,
}: GenerateChunkedAudioAndTranscriptParams): Promise<ChunkGenerationResult> {
  const chunks = splitTextForChunkedTts(text)

  logger.info(
    `[ProviderRouter] Chunked TTS enabled: ${countWords(text)} words split into ${chunks.length} chunks (max ${TTS_CHUNK_CONCURRENCY} in parallel)`,
  )

  const limit = pLimit(TTS_CHUNK_CONCURRENCY)
  const chunkOutputs = await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const chunkOutputPath = `story_loader/audio/chunks/voice_over_chunk_${chunk.index
          .toString()
          .padStart(3, '0')}.mp3`
        logger.info(
          `[ProviderRouter] Generating TTS chunk ${chunk.index + 1}/${chunks.length} (${chunk.wordCount} words)`,
        )
        // Scope generation to this chunk so the logger mixin tags every line in
        // its async subtree (incl. the provider's language-decision log) with the
        // chunk index, keeping per-chunk decisions attributable under parallel generation.
        return JobContext.run(
          { ttsChunkCount: chunks.length, ttsChunkIndex: chunk.index },
          async () => {
            const result = await generateChunk(chunk.text, chunkOutputPath)
            // Language actually produced by TTS, read from the ASR transcript the
            // quality pass already computed (no extra ASR/model call). Compared against the
            // expected script-language tag to spot per-chunk drift (e.g. French -> English).
            logger.info(
              `[voiceover-lang] chunk produced expected=${languageCode ?? 'none'} ` +
                `detected=${result.transcription?.languageCode ?? 'unknown'} ` +
                `probability=${result.transcription?.languageProbability ?? 'na'}`,
            )
            return { outputPath: chunkOutputPath, result, textChunk: chunk }
          },
        )
      }),
    ),
  )
  const qualityIssues: string[] = chunkOutputs.flatMap(({ result, textChunk }) =>
    result.qualityIssues.map((issue) => `chunk ${textChunk.index + 1}: ${issue}`),
  )

  const stitchResult = await stitchAudioChunks(
    projectId,
    chunkOutputs.map((chunk) => chunk.outputPath),
    outputPath,
  )
  const finalPath = stitchResult.finalPath

  const { transcription, issues: finalAsrIssues } = await generateTranscriptionStep(
    projectId,
    finalPath,
  )
  qualityIssues.push(...finalAsrIssues.map((issue) => `stitched audio: ${issue}`))

  const firstInvalidChunk = chunkOutputs.find((chunk) => !chunk.result.isValid)
  const highestAttempt = Math.max(...chunkOutputs.map((chunk) => chunk.result.attempt))
  const tagLeakageDetected = chunkOutputs.some((chunk) => chunk.result.tagLeakageDetected)
  const usedUntaggedFallback = chunkOutputs.some((chunk) => chunk.result.usedUntaggedFallback)

  await saveChunkedTtsDebugInfo(projectId, {
    provider,
    outputPath: finalPath,
    textWordCount: countWords(text),
    chunkLoudnessReports: stitchResult.loudnessReports,
    finalAsrSucceeded: Boolean(transcription),
    finalLimiterApplied: stitchResult.finalLimiterApplied,
    boundaryGapTargetSeconds: TTS_CHUNK_BOUNDARY_TARGET_GAP_SECONDS,
    loudnessMaxGainDb: TTS_CHUNK_MAX_GAIN_DB,
    loudnessTargetLufs: TTS_CHUNK_LOUDNESS_TARGET_LUFS,
    routing,
    ttsModel,
    voiceId,
    chunks: chunkOutputs.map((chunk) => ({
      index: chunk.textChunk.index,
      wordCount: chunk.textChunk.wordCount,
      outputPath: chunk.outputPath,
      isValid: chunk.result.isValid,
      attempt: chunk.result.attempt,
      detectedLanguage: chunk.result.transcription?.languageCode ?? null,
      languageProbability: chunk.result.transcription?.languageProbability ?? null,
      qualityIssues: chunk.result.qualityIssues,
    })),
  })

  return {
    isValid: !firstInvalidChunk && Boolean(transcription),
    transcription,
    ttsModel,
    attempt: highestAttempt,
    qualityIssues,
    provider,
    tagLeakageDetected,
    usedUntaggedFallback,
    ...llmTtsQualityCheckMetadata,
  }
}

async function applyFinalLimiter(
  stitchedPath: string,
  tempDir: string,
): Promise<{ applied: boolean; outputPath: string }> {
  const limitedPath = path.join(tempDir, 'voice_over_stitched_limited.mp3')
  try {
    await runFfmpeg(
      '-i',
      stitchedPath,
      '-vn',
      '-af',
      TTS_FINAL_LIMITER_FILTER,
      '-c:a',
      'libmp3lame',
      '-b:a',
      TTS_CHUNK_STITCH_BITRATE,
      '-ar',
      TTS_CHUNK_STITCH_SAMPLE_RATE,
      limitedPath,
    )
    return { applied: true, outputPath: limitedPath }
  } catch (err) {
    logger.warn({ err, stitchedPath }, '[ProviderRouter] Failed to apply final TTS limiter')
    return { applied: false, outputPath: stitchedPath }
  }
}

async function buildConcatInputPaths(
  localChunkPaths: string[],
  tempDir: string,
): Promise<string[]> {
  if (localChunkPaths.length <= 1) {
    return localChunkPaths
  }

  const boundarySilences = await Promise.all(localChunkPaths.map(detectBoundarySilence))
  const concatInputPaths: string[] = []
  for (let i = 0; i < localChunkPaths.length; i += 1) {
    concatInputPaths.push(localChunkPaths[i])
    if (i >= localChunkPaths.length - 1) {
      continue
    }
    const existingGapSeconds =
      boundarySilences[i].trailingSeconds + boundarySilences[i + 1].leadingSeconds
    const insertSeconds = TTS_CHUNK_BOUNDARY_TARGET_GAP_SECONDS - existingGapSeconds
    if (insertSeconds < TTS_CHUNK_BOUNDARY_MIN_INSERT_SECONDS) {
      continue
    }
    const silencePath = path.join(tempDir, `boundary_gap_${i.toString().padStart(3, '0')}.mp3`)
    await runFfmpeg(
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${TTS_CHUNK_STITCH_SAMPLE_RATE}:cl=mono`,
      '-t',
      insertSeconds.toFixed(3),
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      TTS_CHUNK_STITCH_BITRATE,
      '-ar',
      TTS_CHUNK_STITCH_SAMPLE_RATE,
      silencePath,
    )
    concatInputPaths.push(silencePath)
  }

  return concatInputPaths
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

async function detectBoundarySilence(filePath: string): Promise<BoundarySilenceInfo> {
  const durationSeconds = await getAudioDurationSeconds(filePath)
  if (!durationSeconds) {
    return { leadingSeconds: 0, trailingSeconds: 0 }
  }

  try {
    const { silences: intervals } = await detectSilences(filePath, {
      durationSeconds,
      minSeconds: TTS_CHUNK_BOUNDARY_SILENCE_DETECT_MIN_SECONDS,
      noiseDb: TTS_CHUNK_BOUNDARY_SILENCE_THRESHOLD_DB,
    })

    const leading = intervals.find(
      (interval) => interval.start <= TTS_CHUNK_BOUNDARY_EDGE_TOLERANCE_SECONDS,
    )
    const trailing = intervals
      .toReversed()
      .find(
        (interval) => interval.end >= durationSeconds - TTS_CHUNK_BOUNDARY_EDGE_TOLERANCE_SECONDS,
      )
    return {
      leadingSeconds: leading ? Math.max(0, leading.end - leading.start) : 0,
      trailingSeconds: trailing ? Math.max(0, trailing.end - trailing.start) : 0,
    }
  } catch (err) {
    logger.warn({ err, filePath }, '[ProviderRouter] Failed to detect TTS chunk boundary silence')
    return { leadingSeconds: 0, trailingSeconds: 0 }
  }
}

function escapeFfmpegConcatPath(filePath: string): string {
  return filePath.replaceAll("'", String.raw`'\''`)
}

function formatGainDb(value: number): string {
  return `${value.toFixed(2)}dB`
}

async function getAudioDurationSeconds(filePath: string): Promise<null | number> {
  try {
    const { stdout } = await runCommand([
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    return parseSeconds(stdout.trim())
  } catch (err) {
    logger.warn({ err, filePath }, '[ProviderRouter] Failed to probe TTS chunk duration')
    return null
  }
}

async function matchChunkLoudness(
  localChunkPaths: string[],
  tempDir: string,
): Promise<{ loudnessReports: ChunkLoudnessReport[]; outputPaths: string[] }> {
  const loudnessReports: ChunkLoudnessReport[] = []
  const outputPaths: string[] = []

  for (let index = 0; index < localChunkPaths.length; index += 1) {
    const inputPath = localChunkPaths[index]
    const beforeLufs = await measureLoudnessLufs(inputPath)
    if (beforeLufs === null) {
      loudnessReports.push({ error: 'measure_failed', index })
      outputPaths.push(inputPath)
      continue
    }

    const rawGainDb = TTS_CHUNK_LOUDNESS_TARGET_LUFS - beforeLufs
    const gainDb = clamp(rawGainDb, -TTS_CHUNK_MAX_GAIN_DB, TTS_CHUNK_MAX_GAIN_DB)
    const gainLimited = Math.abs(gainDb - rawGainDb) > 0.01

    if (Math.abs(gainDb) < TTS_CHUNK_GAIN_EPSILON_DB) {
      loudnessReports.push({ afterLufs: beforeLufs, beforeLufs, gainDb: 0, gainLimited, index })
      outputPaths.push(inputPath)
      continue
    }

    const outputPath = path.join(tempDir, `chunk_${index.toString().padStart(3, '0')}_matched.mp3`)
    try {
      await runFfmpeg(
        '-i',
        inputPath,
        '-vn',
        '-af',
        `volume=${formatGainDb(gainDb)}`,
        '-c:a',
        'libmp3lame',
        '-b:a',
        TTS_CHUNK_STITCH_BITRATE,
        '-ar',
        TTS_CHUNK_STITCH_SAMPLE_RATE,
        outputPath,
      )
      const afterLufs = (await measureLoudnessLufs(outputPath)) ?? undefined
      loudnessReports.push({ afterLufs, beforeLufs, gainDb, gainLimited, index })
      outputPaths.push(outputPath)
    } catch (err) {
      logger.warn(
        { err, index, inputPath },
        '[ProviderRouter] Failed to match TTS chunk loudness; using original chunk',
      )
      loudnessReports.push({
        beforeLufs,
        error: err instanceof Error ? err.message : String(err),
        gainDb,
        gainLimited,
        index,
      })
      outputPaths.push(inputPath)
    }
  }

  return { loudnessReports, outputPaths }
}

async function measureLoudnessLufs(filePath: string): Promise<null | number> {
  try {
    const { stderr, stdout } = await runCommand([
      'ffmpeg',
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-af',
      `loudnorm=I=${TTS_CHUNK_LOUDNESS_TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`,
      '-f',
      'null',
      '-',
    ])
    return parseLoudnessLufs(`${stdout}\n${stderr}`)
  } catch (err) {
    logger.warn({ err, filePath }, '[ProviderRouter] Failed to measure TTS chunk loudness')
    return null
  }
}

function parseLoudnessLufs(output: string): null | number {
  const start = output.lastIndexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }

  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as { input_i?: string }
    const inputI = Number.parseFloat(parsed.input_i ?? '')
    return Number.isFinite(inputI) ? inputI : null
  } catch {
    return null
  }
}

function parseSeconds(value: string | undefined): null | number {
  if (!value) {
    return null
  }
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

async function saveChunkedTtsDebugInfo(
  projectId: string,
  payload: {
    boundaryGapTargetSeconds: number
    chunkLoudnessReports: ChunkLoudnessReport[]
    chunks: Array<{
      attempt: number
      detectedLanguage: null | string
      index: number
      isValid: boolean
      languageProbability: null | number
      outputPath: string
      qualityIssues: string[]
      wordCount: number
    }>
    finalAsrSucceeded: boolean
    finalLimiterApplied: boolean
    loudnessMaxGainDb: number
    loudnessTargetLufs: number
    outputPath: string
    provider: TtsProvider
    routing?: {
      originalProvider?: TtsProvider
      originalVoiceId?: string
      reason?: string
    }
    textWordCount: number
    ttsModel: string
    voiceId: string
  },
): Promise<void> {
  try {
    const storage = await createStorage(projectId)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await storage.writeJsonFile(`story_loader/audio/debug/chunked_tts_${timestamp}.json`, {
      timestamp: new Date().toISOString(),
      ...payload,
    })
  } catch (err) {
    logger.warn({ error: err }, '[ProviderRouter] Failed to save chunked TTS debug info')
  }
}

function splitOversizedSentence(sentence: string, maxWords: number): string[] {
  const words = sentence.trim().split(/\s+/).filter(Boolean)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '))
  }

  return chunks
}

function splitTextForChunkedTts(text: string, maxWords = MAX_TTS_CHUNK_WORDS): TtsTextChunk[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return []
  }

  const sentenceCandidates = normalized.match(/[^.!?。！？]+[.!?。！？"')\]]*|[^.!?。！？]+$/g) ?? [
    normalized,
  ]
  const pieces = sentenceCandidates.flatMap((sentence) => {
    const trimmed = sentence.trim()
    if (!trimmed) {
      return []
    }
    return countWords(trimmed) > maxWords ? splitOversizedSentence(trimmed, maxWords) : [trimmed]
  })

  const chunks: string[] = []
  let current: string[] = []
  let currentWords = 0

  for (const piece of pieces) {
    const pieceWords = countWords(piece)
    if (current.length > 0 && currentWords + pieceWords > maxWords) {
      chunks.push(current.join(' '))
      current = []
      currentWords = 0
    }
    current.push(piece)
    currentWords += pieceWords
  }

  if (current.length > 0) {
    chunks.push(current.join(' '))
  }

  return chunks.map((chunk, index) => ({
    index,
    text: chunk,
    wordCount: countWords(chunk),
  }))
}

async function stitchAudioChunks(
  projectId: string,
  chunkPaths: string[],
  outputPath?: string,
): Promise<StitchAudioChunksResult> {
  const storage = await createStorage(projectId)
  const finalPath = outputPath || 'story_loader/audio/voice_over.mp3'
  const tempDir = path.join(os.tmpdir(), `tts-stitch-${projectId}-${Date.now()}`)

  await mkdir(tempDir, { recursive: true })
  let finalLimiterApplied = false

  try {
    const localChunkPaths: string[] = []
    for (let i = 0; i < chunkPaths.length; i += 1) {
      const localChunkPath = path.join(tempDir, `chunk_${i.toString().padStart(3, '0')}.mp3`)
      await writeFile(localChunkPath, await storage.readFile(chunkPaths[i]))
      localChunkPaths.push(localChunkPath)
    }

    const { loudnessReports, outputPaths: loudnessMatchedChunkPaths } = await matchChunkLoudness(
      localChunkPaths,
      tempDir,
    )
    const concatInputPaths = await buildConcatInputPaths(loudnessMatchedChunkPaths, tempDir)
    const fileListPath = path.join(tempDir, 'concat.txt')
    await writeFile(
      fileListPath,
      concatInputPaths.map((localPath) => `file '${escapeFfmpegConcatPath(localPath)}'`).join('\n'),
    )

    const stitchedPath = path.join(tempDir, 'voice_over_stitched.mp3')
    await runFfmpeg(
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      fileListPath,
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      TTS_CHUNK_STITCH_BITRATE,
      '-ar',
      TTS_CHUNK_STITCH_SAMPLE_RATE,
      stitchedPath,
    )

    const limiterResult = await applyFinalLimiter(stitchedPath, tempDir)
    finalLimiterApplied = limiterResult.applied

    await storage.writeFile(finalPath, await readFile(limiterResult.outputPath))
    return { finalLimiterApplied, finalPath, loudnessReports }
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined)
  }
}
