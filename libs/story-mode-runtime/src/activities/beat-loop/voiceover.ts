/**
 * A loop's voiceover (beat-loop skill, section 6), made first because it is cheap and fails
 * fast: one TTS call per clip line (none for a line `make_beat_loop` already said in this
 * voice: its kept audio is reused, so it is checked and paid for once), each line's speech
 * fitted into the 3.45 s between 0.15 s and 3.6 s of its clip (sped up to 1.3x at most, else
 * the run fails and names the line), its words timed on its own audio (the local aligner or
 * Whisper, else the cloud aligner, else the skill's pause fallback), and the line placed at
 * (k-1) x 4 + 0.15 s on a track of N x 4 s.
 * Writes the long-take voiceover and transcript: one segment per caption chunk, shown for its
 * own window, its accent word marked, which the render draws with the app's caption engine.
 */
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import {
  type BeatLoopLineInput,
  lineAudioExtension,
  measureSpokenLine,
  resolveLoopVoiceRoute,
  speakBeatLoopLine,
} from '@agent-lib/agents/story-loader/voice-tools/utils/beat-loop-lines.util'
import { resolveTtsModel } from '@agent-lib/agents/story-loader/voice-tools/utils/provider-tts.util'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { alignTextToWords, type TimedWord } from '@reelmakeeasy/common/asr/align-text'
import {
  type CaptionTiming,
  timeCaptionWordsFromAudio,
} from '@reelmakeeasy/common/asr/caption-timing'
import { generateForcedAlignment } from '@reelmakeeasy/common/asr/elevenlabs'
import {
  type BeatCaptionChunk,
  beatLoopCaptionChunks,
} from '@reelmakeeasy/common/long-take/beat-loop-captions'
import {
  BEAT_CLIP_SECONDS,
  BEAT_LINE_OFFSET_SECONDS,
  BEAT_LINE_SECONDS,
  BEAT_MAX_SPEEDUP,
  fitBeatLoopLine,
  narrationTarget,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import { stripDeliveryMarkup } from '@reelmakeeasy/common/tts/delivery-markup'
import { measureClipLoudness } from '@reelmakeeasy/common/utils/beat-lock'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { TranscriptData } from '@shared/types/agent/transcript'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

import { generateLongTakeVoiceoverM4a } from '../long-take/audio'
import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'

const execFileAsync = promisify(execFile)

/** The fit rule, shared with `make_beat_loop`'s check (beat-loop-craft). */
export { BEAT_LINE_SECONDS, fitBeatLoopLine } from '@reelmakeeasy/common/long-take/beat-loop-craft'
/** The voice track's level before the mix (the broadcast reference the finish pass mixes at). */
const VOICE_LUFS = -23
/** Kept under full scale when levelling. */
const VOICE_PEAK_LIMIT = 10 ** (-1 / 20)
const SAMPLE_RATE = 48_000
/** Kept after a line's last word: the tail of its sound. */
const LINE_TAIL_SECONDS = 0.05
/** A fade-in at the cut-in point, so a line never starts with a click. */
const LINE_FADE_IN_SECONDS = 0.005
const PCM_MAX_BUFFER_BYTES = 256 * 1024 * 1024

export interface BeatLoopVoiceLine {
  clipId: string
  clipIndex: number
  /** The line's speech as the voice said it, before any speed-up. */
  speechSeconds: number
  /** Where the line starts on the video's clock. */
  startS: number
  /** 1, or the speed-up (at most 1.3) that fits the line in its clip. */
  tempo: number
  timing: Pick<CaptionTiming, 'fallbackMode' | 'rejected' | 'source'>
  /** The narration's words on the line's own clock (0 = its first word). */
  words: TimedWord[]
}

export interface GenerateBeatLoopVoiceoverParams {
  orgId?: string
  projectId: string
  storyboard: BeatLoopStoryboard
  userEmail?: string
  userId: string
  /** The voice for every line; when unset (or one that can't run here), a free local voice
   *  when one is installed, else the default voice (`resolveLoopVoiceRoute`). */
  voiceId?: string
}

export interface GenerateBeatLoopVoiceoverResult {
  durationSeconds: number
  lines: BeatLoopVoiceLine[]
  transcriptPath: string
  ttsProvider: string
  voiceId: string
  voiceOverPath: string
}

/** Activity: the loop's voiceover, its word timing and its caption chunks. */
export async function generateBeatLoopVoiceover(
  params: GenerateBeatLoopVoiceoverParams,
): Promise<GenerateBeatLoopVoiceoverResult> {
  const { projectId, storyboard, userId } = params
  return withLongTakeContext({ projectId, sceneId: 'beat_loop', userId }, () =>
    withActivityHeartbeat(async () => {
      const route = await resolveLoopVoiceRoute(params.voiceId || undefined)
      const ttsModel = resolveTtsModel(route.provider)
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `beat-loop-vo-${projectId}-`),
      )
      try {
        // Every line is spoken and measured before any fails, so the reply names all the long ones.
        const spoken = []
        for (const [clipIndex, clip] of storyboard.clips.entries()) {
          const line: BeatLoopLineInput = {
            projectId,
            route,
            text: clip.narration,
            ttsModel,
            userContext: params.userEmail ? { userEmail: params.userEmail, userId } : undefined,
          }
          // The audio make_beat_loop checked, when it said this line in this voice.
          const { audioBuffer } = await speakBeatLoopLine(line)
          const rawPath = path.join(
            tempDir,
            `tts_${clipIndex + 1}${lineAudioExtension(audioBuffer)}`,
          )
          await fs.promises.writeFile(rawPath, audioBuffer)
          spoken.push({
            clip,
            clipIndex,
            rawPath,
            speech: await measureSpeech(rawPath, line, clip.id),
          })
        }
        const tooLong = spoken.filter((line) => !fitBeatLoopLine(line.speech.seconds).fits)
        if (tooLong.length) throw lineTooLong(tooLong)

        const lines: BeatLoopVoiceLine[] = []
        const linePaths: string[] = []
        for (const { clip, clipIndex, rawPath, speech } of spoken) {
          const { tempo } = fitBeatLoopLine(speech.seconds)
          const linePath = path.join(tempDir, `line_${clipIndex + 1}.wav`)
          await cutLine({ from: speech.start, rawPath, tempo, to: speech.end, toPath: linePath })
          // A delivery tag ([excited]) is the voice's cue, never a word it says or a caption.
          const timing = await timeLine(linePath, stripDeliveryMarkup(clip.narration), clip.id)
          linePaths.push(linePath)
          lines.push({
            clipId: clip.id,
            clipIndex,
            speechSeconds: round(speech.seconds),
            startS: round(clipIndex * BEAT_CLIP_SECONDS + BEAT_LINE_OFFSET_SECONDS),
            tempo,
            timing: {
              ...(timing.fallbackMode ? { fallbackMode: timing.fallbackMode } : {}),
              rejected: timing.rejected,
              source: timing.source,
            },
            words: timing.words,
          })
        }

        const durationSeconds = storyboard.clips.length * BEAT_CLIP_SECONDS
        const voicePath = path.join(tempDir, 'voice_over.mp3')
        await buildVoiceTrack({ durationSeconds, linePaths, outputPath: voicePath, tempDir })

        const chunks = beatLoopCaptionChunks(
          storyboard.clips.map((clip, i) => ({
            caption: clip.caption,
            narration: stripDeliveryMarkup(clip.narration),
            words: lines[i].words,
          })),
          { align: alignTextToWords },
        )
        const storage = createLongTakeStorage(projectId)
        await storage.uploadFile(voicePath, STORY_LOADER_PATHS.audioVoiceoverPath)
        await Promise.all([
          storage.writeJsonFile(STORY_LOADER_PATHS.transformedTranscriptPath, toTranscript(chunks)),
          storage.writeFile(
            STORY_LOADER_PATHS.scriptTxtPath,
            storyboard.clips.map((clip) => clip.narration).join('\n'),
          ),
        ])
        await generateLongTakeVoiceoverM4a(projectId, { skipIfExists: false })
        logger.info(
          `[beat-loop] Voiceover made ${formatLogFields({
            projectId,
            sources: lines.map((line) => line.timing.source),
            tempos: lines.map((line) => round(line.tempo)),
          })}`,
        )
        return {
          durationSeconds,
          lines,
          transcriptPath: STORY_LOADER_PATHS.transformedTranscriptPath,
          ttsProvider: route.provider,
          voiceId: route.voiceId,
          voiceOverPath: STORY_LOADER_PATHS.audioVoiceoverPath,
        }
      } finally {
        await fs.promises.rm(tempDir, { force: true, recursive: true })
      }
    }),
  )
}

/** Where a TTS line's speech starts and ends (its lead-in and tail of silence left out). A
 *  silent or unreadable line is not kept, so the next run says it again. */
async function measureSpeech(
  audioPath: string,
  line: BeatLoopLineInput,
  clipId: string,
): Promise<{ end: number; seconds: number; start: number }> {
  // Unreadable audio throws (a retry asks the voice again: the line is not kept).
  const speech = await measureSpokenLine(line, audioPath)
  if (!speech) {
    throw ApplicationFailure.nonRetryable(
      `The voice came back silent for clip ${clipId}`,
      'BeatLoopSilentLine',
    )
  }
  return speech
}

/** The line from its first word to just after its last, sped up when it must be, as 48 kHz mono WAV. */
async function cutLine(input: {
  from: number
  rawPath: string
  tempo: number
  to: number
  toPath: string
}): Promise<void> {
  const { from, rawPath, tempo, to, toPath } = input
  const filters = [
    `atrim=start=${from.toFixed(4)}:end=${(to + LINE_TAIL_SECONDS).toFixed(4)}`,
    'asetpts=PTS-STARTPTS',
    ...(tempo > 1 ? [`atempo=${tempo.toFixed(6)}`] : []),
    `afade=t=in:d=${LINE_FADE_IN_SECONDS}`,
    `aresample=${SAMPLE_RATE}`,
  ]
  await execFileAsync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    rawPath,
    '-af',
    filters.join(','),
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    toPath,
  ])
}

/** The narration's words on the line's own audio; never fails (the pause fallback is free). */
async function timeLine(
  linePath: string,
  narration: string,
  clipId: string,
): Promise<CaptionTiming> {
  let aligned: null | TimedWord[] = null
  let heard: null | TimedWord[] = null
  try {
    const alignment = await generateForcedAlignment(linePath, narration)
    const words = alignment.words.map((w) => ({ end: w.end, start: w.start, text: w.text }))
    // Whisper's words (laid over the script) and Gemini's transcript get the onset fix and
    // the 40 ms repair; aligners' words, the 80 ms one.
    if (alignment.source === 'local-whisper' || alignment.source === 'google') heard = words
    else aligned = words
  } catch (error) {
    logger.warn(
      `[beat-loop] Could not align a line; timing it from its pauses ${formatLogFields({
        clipId,
        err: formatError(error),
      })}`,
    )
  }
  const timing = await timeCaptionWordsFromAudio(linePath, {
    aligned,
    durationSeconds: await probeDuration(linePath),
    heard,
    text: narration,
  })
  if (timing.source === 'fallback') {
    logger.info(
      `[beat-loop] Line timed by the pause fallback ${formatLogFields({
        clipId,
        fallbackMode: timing.fallbackMode,
        rejected: timing.rejected,
      })}`,
    )
  }
  return timing
}

/**
 * The lines on the beat grid (line k at (k-1) x 4 + 0.15 s), padded to N x 4 s and levelled
 * to -23 LUFS (kept under -1 dBFS), as MP3.
 */
async function buildVoiceTrack(input: {
  durationSeconds: number
  linePaths: string[]
  outputPath: string
  tempDir: string
}): Promise<void> {
  const { durationSeconds, linePaths, outputPath, tempDir } = input
  const track = new Float32Array(Math.round(durationSeconds * SAMPLE_RATE))
  for (const [k, linePath] of linePaths.entries()) {
    const samples = await decodeMono(linePath)
    const offset = Math.round((k * BEAT_CLIP_SECONDS + BEAT_LINE_OFFSET_SECONDS) * SAMPLE_RATE)
    const clipEnd = Math.round((k + 1) * BEAT_CLIP_SECONDS * SAMPLE_RATE)
    track.set(samples.subarray(0, Math.max(0, clipEnd - offset)), offset)
  }
  const wavPath = path.join(tempDir, 'voice_track.wav')
  await fs.promises.writeFile(wavPath, toWav(track))
  const { integratedLufs } = await measureClipLoudness(wavPath)
  if (integratedLufs !== null) {
    const peak = track.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    const gain = Math.min(10 ** ((VOICE_LUFS - integratedLufs) / 20), VOICE_PEAK_LIMIT / peak)
    for (let i = 0; i < track.length; i++) track[i] *= gain
    await fs.promises.writeFile(wavPath, toWav(track))
  }
  await execFileAsync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    wavPath,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    outputPath,
  ])
}

/** The longest a line's speech can be: its time in the clip, at the most it may be sped up. */
const BEAT_LINE_MAX_SPEECH_SECONDS = BEAT_LINE_SECONDS * BEAT_MAX_SPEEDUP

/**
 * The failure for lines too long to fit their clip even sped up: every such line, named, with
 * how much too long it is and about how many of its words that is (at its own pace), the speed
 * it would need and what to aim for, as `make_beat_loop` names them (its check stops these
 * before a run, in the same voice), so the user and the chat's agent can fix exactly those lines.
 */
function lineTooLong(
  lines: {
    clip: BeatLoopStoryboard['clips'][number]
    clipIndex: number
    speech: { seconds: number }
  }[],
): ApplicationFailure {
  const named = lines.map(({ clip, clipIndex, speech }) => {
    const { tempo } = fitBeatLoopLine(speech.seconds)
    const target = narrationTarget(clip.narration, speech.seconds)
    const over = Math.max(0.1, speech.seconds - BEAT_LINE_MAX_SPEECH_SECONDS)
    const words = clip.narration.split(/\s+/).filter(Boolean).length || 1
    const cut = Math.max(1, Math.ceil(over / (speech.seconds / words)))
    return `clip ${clipIndex + 1} (${clip.id}) takes ${speech.seconds.toFixed(1)} s to say, ${over.toFixed(1)} s more than fits (cut about ${cut} word${cut === 1 ? '' : 's'}; it would need ${tempo.toFixed(2)}x, aim for ${target}): "${clip.narration}"`
  })
  return ApplicationFailure.nonRetryable(
    `Narration too long for its clip even at ${BEAT_MAX_SPEEDUP}x speed: ${named.join('; ')}. Each line has ${BEAT_LINE_SECONDS.toFixed(2)} s, ${BEAT_LINE_MAX_SPEECH_SECONDS.toFixed(1)} s at most sped up.`,
    'BeatLoopLineTooLong',
  )
}

/** The audio as 48 kHz mono samples. */
async function decodeMono(audioPath: string): Promise<Float32Array> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    ['-v', 'error', '-i', audioPath, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'],
    { encoding: 'buffer', maxBuffer: PCM_MAX_BUFFER_BYTES },
  )
  // Copy into an aligned buffer: Float32Array needs a 4-byte-aligned offset.
  const samples = new Float32Array(Math.floor(stdout.length / 4))
  new Uint8Array(samples.buffer).set(stdout.subarray(0, samples.length * 4))
  return samples
}

async function probeDuration(mediaPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    mediaPath,
  ])
  const seconds = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(seconds)) throw new Error(`Could not read the length of ${mediaPath}`)
  return seconds
}

/**
 * Caption chunks as the long-take transcript's segments, on the video's clock: each segment is
 * one caption, on screen for the chunk's own window (until the next chunk, never past its
 * clip), with its accent word marked.
 */
function toTranscript(chunks: BeatCaptionChunk[]): TranscriptData {
  return {
    captionWindows: 'segment',
    language: 'en',
    segments: chunks.map((chunk) => ({
      end: chunk.end,
      start: chunk.start,
      text: chunk.text,
      words: chunk.words.map((word, i) => ({
        ...(i === chunk.accentIndex ? { accent: true } : {}),
        end: word.end,
        start: word.start,
        word: word.text,
      })),
    })),
  }
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/** 16-bit PCM WAV, mono, 48 kHz. */
function toWav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
