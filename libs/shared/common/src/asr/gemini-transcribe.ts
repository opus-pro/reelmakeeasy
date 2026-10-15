/**
 * Caption timing on Gemini without an ElevenLabs key: Gemini Transcribe on the
 * Interactions API with word timestamps (`timestamp_granularities: ["word"]`),
 * mapped to the ElevenLabs transcript shape the pipeline reads
 * (`words[{ text, start, end, type: 'word' }]`, in seconds). The audio is first
 * made into small 16 kHz mono MP3 (one known format), sent inline, or through
 * the Files API when large. English only for now.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { type GoogleInteraction, modelOutput, runGoogle } from '@reelmakeeasy/llm'
import { resolveRole } from '@reelmakeeasy/llm/registry'

import type {
  ForcedAlignmentResponseModel,
  SpeechToTextChunkResponseModel,
} from '../elevenlabs/client'
import { runFfmpeg } from '../utils/cmdline'

import { alignTextToWords } from './align-text'

/** Moved to `./align-text`; re-exported for older imports. */
export { alignTextToWords, type TimedWord } from './align-text'

/** Larger audio goes through the Files API instead of inline. */
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024

/**
 * Word timings for known text. Gemini has no forced alignment, so the audio is transcribed and
 * the script's own words are laid over the heard words' timings.
 */
export async function geminiForcedAlignment(
  audioPath: string,
  text: string,
): Promise<ForcedAlignmentResponseModel> {
  const { words } = await geminiTranscribeFile(audioPath)
  const heard = words.map((w) => ({ end: w.end ?? 0, start: w.start ?? 0, text: w.text }))
  return { characters: [], words: alignTextToWords(text, heard) }
}

/** Speech to text with word timings. */
export async function geminiTranscribe(audio: Buffer): Promise<SpeechToTextChunkResponseModel> {
  const mp3 = await toSpeechMp3(audio)
  const input =
    mp3.length > INLINE_LIMIT_BYTES
      ? {
          mime_type: 'audio/mp3',
          type: 'audio',
          uri: (await runGoogle.upload(mp3, 'audio/mp3', 'speech')).uri,
        }
      : { data: mp3.toString('base64'), mime_type: 'audio/mp3', type: 'audio' }
  const interaction = await runGoogle.createInteraction({
    generation_config: {
      transcription_config: {
        language_codes: ['en-US'],
        mode: { timestamp_granularities: ['word'], type: 'verbatim' },
      },
    },
    input: [input],
    model: geminiTranscribeModel(),
    store: false,
  })
  return toTranscription(interaction)
}

export async function geminiTranscribeBlob(file: Blob): Promise<SpeechToTextChunkResponseModel> {
  return geminiTranscribe(Buffer.from(await file.arrayBuffer()))
}

export async function geminiTranscribeFile(
  audioPath: string,
): Promise<SpeechToTextChunkResponseModel> {
  return geminiTranscribe(await readFile(audioPath))
}

export function geminiTranscribeModel(): string {
  const model = resolveRole('speech.align')
  if (model?.provider !== 'google' || !model.model)
    throw new Error(
      'providerRoles.google["speech.align"] in reelmakeeasy.models.json must point at a Gemini transcription model (gemini-transcribe)',
    )
  return model.model
}

/**
 * Maps a finished Gemini Transcribe interaction to the transcript shape ElevenLabs returns. A
 * heard word without both times, or starting before the word ahead of it, is left out of
 * `words` (it stays in `text`): alignment then gives its script word a share of the gap,
 * instead of a caption jumping back to 0 s.
 */
export function toTranscription(interaction: GoogleInteraction): SpeechToTextChunkResponseModel {
  const blocks = modelOutput(interaction).filter((block) => block.type === 'text')
  const timed = blocks.flatMap((block) =>
    (block.annotations ?? []).flatMap((a) => {
      const start = seconds(a.start_offset)
      const end = seconds(a.end_offset)
      return a.type === 'word_info' && a.text && start !== null && end !== null && end >= start
        ? [{ end, start, text: a.text, type: 'word' as const }]
        : []
    }),
  )
  const words: typeof timed = []
  for (const word of timed) if (word.start >= (words.at(-1)?.start ?? 0)) words.push(word)
  const text = blocks
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
  return { languageCode: 'eng', languageProbability: 1, text, words }
}

/** `"0.450s"` as 0.45, or null when Gemini left the time out. */
const seconds = (offset?: string): null | number => {
  const value = Number.parseFloat(offset ?? '')
  return Number.isFinite(value) ? value : null
}

async function toSpeechMp3(audio: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gemini-asr-'))
  try {
    const input = path.join(dir, 'in.bin')
    const output = path.join(dir, 'speech.mp3')
    await writeFile(input, audio)
    await runFfmpeg(
      '-i',
      input,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      output,
    )
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}
